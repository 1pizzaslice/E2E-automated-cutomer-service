import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, Connection } from "@temporalio/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aiRuns,
  channels,
  conversations,
  createDatabaseFromEnv,
  customers,
  messages,
  migrateDatabase,
  tenants,
  tickets,
  type PostgresClient,
  type SupportDatabase,
} from "@support/db";
import { createRecordingSupportMetrics } from "@support/observability";
import { connectNatsEventBus, loadNatsEventBusConfig } from "./event-bus.js";
import { bootstrapJobSchedules } from "./job-schedules.js";
import { deterministicQaReviewId } from "./qa-sampling.js";
import {
  loadTicketLifecycleWorkerRuntimeConfig,
  startTicketLifecycleWorkerRuntime,
  type RunningTicketLifecycleWorkerRuntime,
} from "./worker-runtime.js";
import {
  qaSamplingScheduleId,
  retentionScheduleId,
} from "./workflows/scheduled-jobs-types.js";

/**
 * Live scheduled-jobs coverage (Milestone 17): against real local Temporal,
 * PostgreSQL, and NATS JetStream, the per-tenant Schedules are bootstrapped
 * create-if-missing, fire the job workflows on the production worker
 * composition, and prove the acceptance criteria — a retention run clears
 * refs, sweeps blobs, purges attachments, anonymizes AI runs, and audits
 * `retention.applied`; QA sampling queues a review and emits
 * `support.qa.review_created.v1`; re-runs stay idempotent.
 *
 * Opt-in: RUN_SCHEDULED_JOBS_LIVE_TESTS=true pnpm --filter @support/workers
 * test:jobs (requires `pnpm infra:up` + DATABASE_URL).
 */
const describeLive =
  process.env.RUN_SCHEDULED_JOBS_LIVE_TESTS === "true" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

const prefix = `jobs_it_${process.pid}_${Date.now()}`;
const ids = {
  tenant: `${prefix}_ten`,
  customer: `${prefix}_cus`,
  channel: `${prefix}_chn`,
  conversation: `${prefix}_cnv`,
  ticket: `${prefix}_tic`,
  expiredMessage: `${prefix}_msg_old`,
  freshMessage: `${prefix}_msg_new`,
  expiredAiRun: `${prefix}_air_old`,
  candidateAiRun: `${prefix}_air_qa`,
};

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

async function until<T>(
  probe: () => Promise<T | null>,
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await probe();

    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for live condition");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describeLive("live scheduled jobs on temporal schedules", () => {
  let ownerClient: PostgresClient | undefined;
  let ownerDb: SupportDatabase;
  let runtime: RunningTicketLifecycleWorkerRuntime | undefined;
  let temporalConnection: Connection | undefined;
  let temporalClient: Client | undefined;
  let blobDir: string;
  let rawBlobPath: string;
  let attachmentBlobPath: string;

  beforeAll(async () => {
    // localhost can resolve to ::1 where NATS listens on IPv4 only.
    process.env.NATS_URL ??= "nats://127.0.0.1:4222";
    // Isolate this run's task queue so schedules only reach our worker.
    process.env.TEMPORAL_TASK_QUEUE = `${prefix}-queue`;

    // Real blobs on disk for the filesystem sweeper.
    blobDir = await mkdtemp(join(tmpdir(), "jobs-it-blobs-"));
    process.env.RAW_PAYLOAD_STORE_DIR = blobDir;
    const tenantBlobDir = join(blobDir, ids.tenant);
    await mkdir(tenantBlobDir, { recursive: true });
    rawBlobPath = join(tenantBlobDir, "raw-old.json");
    attachmentBlobPath = join(tenantBlobDir, "attachment-old.pdf");
    await writeFile(rawBlobPath, JSON.stringify({ raw: true }));
    await writeFile(attachmentBlobPath, "pdf-bytes");

    const database = createDatabaseFromEnv();
    ownerClient = database.client;
    ownerDb = database.db;
    await migrateDatabase(ownerClient);

    await ownerDb.insert(tenants).values({
      tenantId: ids.tenant,
      name: `${prefix} Tenant`,
      retentionPolicy: {
        raw_payload_days: 30,
        attachment_days: 30,
        ai_run_days: 30,
      },
    });
    await ownerDb.insert(customers).values({
      customerId: ids.customer,
      tenantId: ids.tenant,
      displayName: "Jobs IT Customer",
      email: `${prefix}@example.test`,
    });
    await ownerDb.insert(channels).values({
      channelId: ids.channel,
      tenantId: ids.tenant,
      type: "email",
      provider: "mailgun",
      status: "active",
      config: {},
    });
    await ownerDb.insert(conversations).values({
      conversationId: ids.conversation,
      tenantId: ids.tenant,
      customerId: ids.customer,
      channelId: ids.channel,
      status: "open",
    });
    await ownerDb.insert(tickets).values({
      ticketId: ids.ticket,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      customerId: ids.customer,
      status: "waiting_human",
      priority: "p2",
      openedAt: new Date(NOW - 60 * DAY_MS),
    });

    // Expired message: raw payload blob + attachment metadata (one local
    // blob, one provider-side ref) both past the 30-day windows.
    await ownerDb.insert(messages).values({
      messageId: ids.expiredMessage,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      ticketId: ids.ticket,
      channelId: ids.channel,
      direction: "inbound",
      bodyText: "old inbound",
      attachments: [
        {
          filename: "invoice.pdf",
          content_type: "application/pdf",
          size_bytes: 9,
          object_ref: `file://${attachmentBlobPath}`,
        },
        {
          filename: "photo.jpg",
          content_type: "image/jpeg",
          size_bytes: null,
          object_ref: "whatsapp-media:12345",
        },
      ],
      rawPayloadRef: `file://${rawBlobPath}`,
      createdByType: "customer",
      createdAt: new Date(NOW - 45 * DAY_MS),
    });
    // Fresh message: inside every window, must remain untouched.
    await ownerDb.insert(messages).values({
      messageId: ids.freshMessage,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      ticketId: ids.ticket,
      channelId: ids.channel,
      direction: "inbound",
      bodyText: "fresh inbound",
      attachments: [
        {
          filename: "fresh.pdf",
          content_type: "application/pdf",
          size_bytes: 3,
          object_ref: "whatsapp-media:67890",
        },
      ],
      rawPayloadRef: `file://${join(tenantBlobDir, "raw-fresh.json")}`,
      createdByType: "customer",
      createdAt: new Date(NOW - 1 * DAY_MS),
    });

    // Expired AI run: PII-bearing columns populated, past the window.
    // high_risk makes it a MANDATORY sampling candidate too, so the QA
    // outcome below is deterministic (no random-bucket dependence on the
    // time-derived test ids).
    await ownerDb.insert(aiRuns).values({
      aiRunId: ids.expiredAiRun,
      tenantId: ids.tenant,
      ticketId: ids.ticket,
      conversationId: ids.conversation,
      runType: "full_graph",
      promptVersion: "support_graph.v1",
      modelProvider: "deterministic",
      modelId: "deterministic-support-v1",
      structuredOutput: { draft: { draft_text: "PII-bearing draft" } },
      guardrailResults: { passed: true },
      status: "succeeded",
      automationRecommendation: "human_approve",
      riskLevel: "high",
      createdAt: new Date(NOW - 45 * DAY_MS),
    });
    // Fresh auto-send run: the QA sampling candidate (mandatory reason) —
    // also inside the ai_run window, so retention must not touch it.
    await ownerDb.insert(aiRuns).values({
      aiRunId: ids.candidateAiRun,
      tenantId: ids.tenant,
      ticketId: ids.ticket,
      conversationId: ids.conversation,
      runType: "full_graph",
      promptVersion: "support_graph.v1",
      modelProvider: "deterministic",
      modelId: "deterministic-support-v1",
      structuredOutput: { draft: { draft_text: "candidate draft" } },
      guardrailResults: { passed: true },
      status: "succeeded",
      automationRecommendation: "auto_send",
      riskLevel: "low",
      createdAt: new Date(NOW - 1 * DAY_MS),
    });

    // The production worker composition: database stores, filesystem blob
    // sweeper (RAW_PAYLOAD_STORE_DIR), NATS publisher, deterministic AI.
    runtime = await startTicketLifecycleWorkerRuntime(
      loadTicketLifecycleWorkerRuntimeConfig(process.env),
      { metrics: createRecordingSupportMetrics() },
    );
    void runtime.run();

    temporalConnection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    });
    temporalClient = new Client({
      connection: temporalConnection,
      namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    });
  }, 120_000);

  afterAll(async () => {
    for (const scheduleId of [
      qaSamplingScheduleId(ids.tenant),
      retentionScheduleId(ids.tenant),
    ]) {
      try {
        await temporalClient?.schedule.getHandle(scheduleId).delete();
      } catch {
        // Schedule was never created; nothing to clean up.
      }
    }
    await temporalConnection?.close();
    await runtime?.shutdown();

    if (ownerClient) {
      try {
        const client = ownerClient;
        for (const table of [
          "qa_reviews",
          "audit_events",
          "ai_runs",
          "messages",
          "tickets",
          "conversations",
          "channels",
          "customers",
          "tenants",
        ]) {
          await client.unsafe(`delete from ${table} where tenant_id = $1`, [
            ids.tenant,
          ]);
        }
      } finally {
        await ownerClient.end();
      }
    }

    await rm(blobDir, { recursive: true, force: true });
  }, 60_000);

  it(
    "bootstraps schedules idempotently, fires both jobs, purges and audits, and re-runs stay idempotent",
    { timeout: 180_000 },
    async () => {
      // --- Bootstrap: create-if-missing, twice (worker restart shape). ---
      const first = await bootstrapJobSchedules({
        env: process.env,
        tenantLister: {
          async listActiveTenantIds() {
            return [ids.tenant];
          },
        },
      });
      expect(first.created).toEqual([
        qaSamplingScheduleId(ids.tenant),
        retentionScheduleId(ids.tenant),
      ]);
      expect(first.existing).toEqual([]);

      const second = await bootstrapJobSchedules({
        env: process.env,
        tenantLister: {
          async listActiveTenantIds() {
            return [ids.tenant];
          },
        },
      });
      expect(second.created).toEqual([]);
      expect(second.existing).toEqual([
        qaSamplingScheduleId(ids.tenant),
        retentionScheduleId(ids.tenant),
      ]);

      const scheduleClient = temporalClient!.schedule;
      const retentionHandle = scheduleClient.getHandle(
        retentionScheduleId(ids.tenant),
      );
      const qaHandle = scheduleClient.getHandle(
        qaSamplingScheduleId(ids.tenant),
      );

      // Both schedules exist on the server with a next daily fire time.
      const retentionDescription = await retentionHandle.describe();
      expect(retentionDescription.info.nextActionTimes.length).toBeGreaterThan(
        0,
      );

      // --- Fire the schedules (manual trigger = the schedule mechanism
      // starting its configured workflow action on the real task queue). ---
      await retentionHandle.trigger();
      await qaHandle.trigger();

      const retentionWorkflowId = await until(async () => {
        const description = await retentionHandle.describe();
        return (
          description.info.recentActions.at(0)?.action.workflow.workflowId ??
          null
        );
      });
      const qaWorkflowId = await until(async () => {
        const description = await qaHandle.describe();
        return (
          description.info.recentActions.at(0)?.action.workflow.workflowId ??
          null
        );
      });

      const retentionResult = await temporalClient!.workflow
        .getHandle(retentionWorkflowId)
        .result();
      expect(retentionResult).toMatchObject({
        tenant_id: ids.tenant,
        raw_payloads_cleared: 1,
        attachment_messages_purged: 1,
        ai_runs_anonymized: 1,
        blob_sweep_failures: 0,
        skipped_reason: null,
      });

      const qaResult = await temporalClient!.workflow
        .getHandle(qaWorkflowId)
        .result();
      expect(qaResult).toMatchObject({
        tenant_id: ids.tenant,
        // Both runs are mandatory candidates (auto_send + high_risk); the
        // anonymized expired run remains a legitimate candidate.
        sampled: 2,
      });

      // --- Retention outcomes in the database and on disk. ---
      const expiredMessage = await ownerClient!.unsafe(
        `select raw_payload_ref, attachments from messages where message_id = $1`,
        [ids.expiredMessage],
      );
      expect(expiredMessage[0]?.raw_payload_ref).toBeNull();
      expect(expiredMessage[0]?.attachments).toEqual([]);
      await expect(access(rawBlobPath)).rejects.toThrow();
      await expect(access(attachmentBlobPath)).rejects.toThrow();

      const freshMessage = await ownerClient!.unsafe(
        `select raw_payload_ref, attachments from messages where message_id = $1`,
        [ids.freshMessage],
      );
      expect(freshMessage[0]?.raw_payload_ref).toContain("raw-fresh.json");
      expect(freshMessage[0]?.attachments).toHaveLength(1);

      const expiredRun = await ownerClient!.unsafe(
        `select structured_output, guardrail_results, anonymized_at, status
         from ai_runs where ai_run_id = $1`,
        [ids.expiredAiRun],
      );
      expect(expiredRun[0]?.structured_output).toBeNull();
      expect(expiredRun[0]?.guardrail_results).toEqual({});
      expect(expiredRun[0]?.anonymized_at).not.toBeNull();
      // Run metadata is retained for reporting.
      expect(expiredRun[0]?.status).toBe("succeeded");

      const candidateRun = await ownerClient!.unsafe(
        `select structured_output, anonymized_at from ai_runs where ai_run_id = $1`,
        [ids.candidateAiRun],
      );
      expect(candidateRun[0]?.structured_output).not.toBeNull();
      expect(candidateRun[0]?.anonymized_at).toBeNull();

      const audits = await ownerClient!.unsafe(
        `select audit_event_id, action, metadata from audit_events
         where tenant_id = $1 and action = 'retention.applied'`,
        [ids.tenant],
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]?.metadata).toMatchObject({
        raw_payloads_cleared: 1,
        attachment_messages_purged: 1,
        ai_runs_anonymized: 1,
        blob_sweep_failures: 0,
      });

      // --- QA sampling outcomes: review row + domain event. ---
      const reviews = await ownerClient!.unsafe(
        `select qa_review_id, ai_run_id, sample_reason from qa_reviews
         where tenant_id = $1 order by ai_run_id`,
        [ids.tenant],
      );
      expect(reviews).toHaveLength(2);
      expect(
        reviews.find((review) => review.ai_run_id === ids.candidateAiRun)
          ?.sample_reason,
      ).toBe("auto_send_candidate");

      const eventBus = await connectNatsEventBus(
        loadNatsEventBusConfig(process.env),
      );
      try {
        const storedEvent = await eventBus.jetStreamManager.streams.getMessage(
          "SUPPORT_EVENTS",
          {
            last_by_subj: `support.events.tenant.${ids.tenant}.qa.review_created.v1`,
          },
        );
        expect(storedEvent).not.toBeNull();
        const envelope = JSON.parse(
          new TextDecoder().decode(storedEvent!.data),
        ) as {
          event_name: string;
          tenant_id: string;
          payload: { qa_review_id: string };
        };
        expect(envelope.event_name).toBe("support.qa.review_created.v1");
        expect(envelope.tenant_id).toBe(ids.tenant);
        expect([
          deterministicQaReviewId(ids.tenant, ids.candidateAiRun),
          deterministicQaReviewId(ids.tenant, ids.expiredAiRun),
        ]).toContain(envelope.payload.qa_review_id);
      } finally {
        await eventBus.close();
      }

      // --- Idempotent re-runs: trigger both again, nothing changes. ---
      await retentionHandle.trigger();
      await qaHandle.trigger();

      const secondRetentionWorkflowId = await until(async () => {
        const description = await retentionHandle.describe();
        const actions = description.info.recentActions;
        const latest = actions.at(-1)?.action.workflow.workflowId ?? null;
        return latest !== null && latest !== retentionWorkflowId
          ? latest
          : null;
      });
      const secondQaWorkflowId = await until(async () => {
        const description = await qaHandle.describe();
        const latest =
          description.info.recentActions.at(-1)?.action.workflow.workflowId ??
          null;
        return latest !== null && latest !== qaWorkflowId ? latest : null;
      });

      const secondRetentionResult = await temporalClient!.workflow
        .getHandle(secondRetentionWorkflowId)
        .result();
      expect(secondRetentionResult).toMatchObject({
        raw_payloads_cleared: 0,
        attachment_messages_purged: 0,
        ai_runs_anonymized: 0,
      });

      const secondQaResult = await temporalClient!.workflow
        .getHandle(secondQaWorkflowId)
        .result();
      expect(secondQaResult).toMatchObject({ scanned: 0, sampled: 0 });

      const auditsAfterRerun = await ownerClient!.unsafe(
        `select audit_event_id from audit_events
         where tenant_id = $1 and action = 'retention.applied'`,
        [ids.tenant],
      );
      expect(auditsAfterRerun).toHaveLength(1);

      const reviewsAfterRerun = await ownerClient!.unsafe(
        `select qa_review_id from qa_reviews where tenant_id = $1`,
        [ids.tenant],
      );
      expect(reviewsAfterRerun).toHaveLength(2);
    },
  );
});
