import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "@support/api";
import {
  aiRunsListQuery,
  approvalsListQuery,
  auditEventsListQuery,
  channels,
  conversationsListQuery,
  createDatabaseFromEnv,
  messageByExternalIdQuery,
  messagesListQuery,
  migrateDatabase,
  slaPolicies,
  tenants,
  ticketByIdQuery,
  ticketEventsForTicketQuery,
  users,
  type PostgresClient,
  type SupportDatabase,
} from "@support/db";
import { createHttpOutboundChannelSender } from "@support/integrations";
import { createRecordingSupportMetrics } from "@support/observability";
import { Client as TemporalClient, Connection } from "@temporalio/client";
import { deterministicAiRunId } from "./activities/ticket-lifecycle-persistence.js";
import {
  SUPPORT_EVENTS_STREAM,
  connectNatsEventBus,
  loadNatsEventBusConfig,
  type NatsEventBusRuntime,
} from "./event-bus.js";
import {
  loadTicketLifecycleWorkerRuntimeConfig,
  startTicketLifecycleWorkerRuntime,
  type RunningTicketLifecycleWorkerRuntime,
} from "./worker-runtime.js";

/**
 * Milestone 13 live end-to-end drive (Compose services: PostgreSQL, Temporal,
 * NATS): a signed webhook fixture flows through the real API intake into the
 * production worker entrypoint composition — persisted ticket, deterministic
 * AI draft, approval decided over the API, outbound send through the HTTP
 * sender (stubbed fetch), and the complete audit/ticket-event/domain-event
 * trail — including a worker restart mid-workflow with no duplicate sends.
 *
 * Run: pnpm --filter @support/workers test:e2e
 * (requires `pnpm infra:up`, DATABASE_URL, and on IPv6-localhost hosts
 * NATS_URL=nats://127.0.0.1:4222)
 */
const describeLive =
  process.env.RUN_E2E_TICKET_LIFECYCLE_TESTS === "true" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

const prefix = `e2e_${process.pid}_${Date.now()}`;
const TENANT = `${prefix}_ten`;
const SCOPE = { tenantId: TENANT };
const CHANNEL = `${prefix}_chn`;
const SLA_POLICY = `${prefix}_sla`;
const REVIEWER = `${prefix}_usr`;
const SIGNING_SECRET = "e2e-webhook-signing-secret";
const SEND_CREDENTIAL = "e2e-mailgun-api-key";
const THREAD_ID = `<thread-${prefix}@mail.example>`;
const SENDING_DOMAIN = "mg.e2e.example.test";

function mailgunPayload(messageId: string, text: string): string {
  const timestamp = "1783180800";
  const token = `token-${messageId}`;
  const signature = createHmac("sha256", SIGNING_SECRET)
    .update(`${timestamp}${token}`)
    .digest("hex");

  return JSON.stringify({
    message_id: messageId,
    thread_id: THREAD_ID,
    from: { email: `${prefix}.buyer@example.test`, name: "E2E Buyer" },
    subject: "Where is my order?",
    text,
    received_at: "2026-07-04T12:00:00.000Z",
    signature: { timestamp, token, signature },
  });
}

async function pollUntil<T>(
  read: () => Promise<T | null | undefined>,
  label: string,
  timeoutMs = 30_000,
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();

    if (value !== null && value !== undefined) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

describeLive(
  "live end-to-end ticket lifecycle through the worker entrypoint",
  () => {
    let ownerClient: PostgresClient | undefined;
    let ownerDb: SupportDatabase;
    let runtime: RunningTicketLifecycleWorkerRuntime | undefined;
    let app: ReturnType<typeof buildApp> | undefined;
    let eventBus: NatsEventBusRuntime | undefined;
    const providerCalls: {
      url: string;
      authorization: string;
      body: string;
    }[] = [];

    const stubFetch: typeof fetch = async (input, init) => {
      providerCalls.push({
        url: String(input),
        authorization: String(
          (init?.headers as Record<string, string> | undefined)?.authorization,
        ),
        body: String(init?.body),
      });

      return new Response(
        JSON.stringify({ id: `<mailgun-${prefix}@${SENDING_DOMAIN}>` }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    async function startWorker(): Promise<RunningTicketLifecycleWorkerRuntime> {
      const started = await startTicketLifecycleWorkerRuntime(
        loadTicketLifecycleWorkerRuntimeConfig(process.env),
        {
          outboundSender: createHttpOutboundChannelSender({
            fetchImpl: stubFetch,
          }),
          metrics: createRecordingSupportMetrics(),
        },
      );
      void started.run();
      return started;
    }

    beforeAll(async () => {
      process.env[`E2E_SIGNING_SECRET_${process.pid}`] = SIGNING_SECRET;
      process.env[`E2E_SEND_CREDENTIAL_${process.pid}`] = SEND_CREDENTIAL;
      // `localhost` resolves to IPv6 on some hosts while the Compose NATS
      // listener binds IPv4 — pin the loopback address unless overridden.
      process.env.NATS_URL ??= "nats://127.0.0.1:4222";

      const database = createDatabaseFromEnv();
      ownerClient = database.client;
      ownerDb = database.db;
      await migrateDatabase(ownerClient);

      await ownerDb.insert(tenants).values({
        tenantId: TENANT,
        name: `${prefix} Tenant`,
      });
      await ownerDb.insert(users).values({
        userId: REVIEWER,
        tenantId: TENANT,
        email: `${prefix}.reviewer@example.test`,
        displayName: "E2E Reviewer",
      });
      await ownerDb.insert(channels).values({
        channelId: CHANNEL,
        tenantId: TENANT,
        type: "email",
        provider: "mailgun",
        status: "active",
        config: {
          sending_domain: SENDING_DOMAIN,
          from_address: "support@e2e.example.test",
          from_name: "E2E Support",
          signature_secret_ref: `E2E_SIGNING_SECRET_${process.pid}`,
          send_credential_ref: `E2E_SEND_CREDENTIAL_${process.pid}`,
        },
      });
      await ownerDb.insert(slaPolicies).values({
        slaPolicyId: SLA_POLICY,
        tenantId: TENANT,
        name: `${prefix} SLA`,
        priority: "p2",
        firstResponseMinutes: 60,
        nextResponseMinutes: 240,
        resolutionMinutes: 1440,
        status: "active",
      });

      eventBus = await connectNatsEventBus(loadNatsEventBusConfig(process.env));
      await eventBus.ensureStreams();

      runtime = await startWorker();
      // The e2e drives the lifecycle, not the IdP: reviewer actions use the
      // explicit insecure-header mode (Milestone 16 JWT coverage lives in the
      // API package's auth suites).
      app = buildApp({ auth: { mode: "insecure-headers" } });
      await app.ready();
    }, 120_000);

    afterAll(async () => {
      try {
        await app?.close();
        await runtime?.shutdown();
        await eventBus?.close();

        if (ownerClient) {
          for (const table of [
            "qa_reviews",
            "messages",
            "approvals",
            "tool_calls",
            "ai_runs",
            "audit_events",
            "ticket_events",
            "tickets",
            "conversations",
            "customer_identities",
            "customers",
            "sla_policies",
            "channels",
            "user_roles",
            "users",
            "tenants",
          ]) {
            await ownerClient.unsafe(
              `delete from ${table} where tenant_id = $1`,
              [TENANT],
            );
          }
        }
      } finally {
        await ownerClient?.end();
      }
    }, 120_000);

    it("drives webhook -> ticket -> AI draft -> approval -> send -> audit trail across a worker restart", async () => {
      const initialMessageId = `<initial-${prefix}@mail.example>`;

      // 1. Signed provider webhook accepted by the real intake path.
      const webhookResponse = await app!.inject({
        method: "POST",
        url: `/v1/webhooks/email/mailgun?channel_id=${CHANNEL}`,
        headers: { "content-type": "application/json" },
        payload: mailgunPayload(
          initialMessageId,
          "Where is my order? Please send the tracking number.",
        ),
      });

      expect(webhookResponse.statusCode).toBe(202);
      const webhookBody = webhookResponse.json();
      expect(webhookBody.accepted).toBe(1);
      expect(webhookBody.results[0]).toMatchObject({ deduplicated: false });

      const conversation = await pollUntil(
        async () =>
          (await conversationsListQuery(ownerDb, SCOPE, { limit: 10 }))[0],
        "intake conversation",
      );
      const conversationId = conversation.conversationId;
      const ticketId = `tkt_${conversationId}`;
      const workflowId = `ticket-lifecycle:${TENANT}:${conversationId}`;

      // 2. The worker persists the ticket, triage, deterministic AI run, and
      //    the pending approval. The waiting_human transition is the last
      //    pre-approval-wait activity, so polling on it settles the whole
      //    sequence.
      const ticketRow = await pollUntil(async () => {
        const rows = await ticketByIdQuery(ownerDb, SCOPE, ticketId);
        return rows[0]?.status === "waiting_human" ? rows[0] : null;
      }, "ticket in waiting_human");

      const approval = (
        await approvalsListQuery(ownerDb, SCOPE, { limit: 10, ticketId })
      ).find((row) => row.status === "pending")!;
      expect(approval).toBeDefined();
      expect(ticketRow).toMatchObject({
        status: "waiting_human",
        priority: "p2",
        topic: "order_status",
        subtopic: "tracking",
        language: "en",
        slaPolicyId: SLA_POLICY,
        automationMode: "human_approve",
      });
      expect(ticketRow.firstResponseDueAt).not.toBeNull();

      // Intake-persisted inbound message reconciled onto the ticket.
      const inboundRows = await messagesListQuery(
        ownerDb,
        SCOPE,
        conversationId,
        {
          limit: 20,
          direction: "inbound",
        },
      );
      expect(inboundRows).toHaveLength(1);
      expect(inboundRows[0]?.ticketId).toBe(ticketId);

      // Deterministic AI run persisted with the approval linked to it.
      const aiRunRows = await aiRunsListQuery(ownerDb, SCOPE, {
        limit: 10,
        ticketId,
      });
      expect(aiRunRows).toHaveLength(1);
      expect(aiRunRows[0]).toMatchObject({
        status: "succeeded",
        modelProvider: "deterministic",
        automationRecommendation: "human_approve",
      });
      expect(approval.aiRunId).toBe(aiRunRows[0]!.aiRunId);

      // Ticket events per BACKEND_SPEC section 6.2/6.3.
      const eventsBeforeDecision = await ticketEventsForTicketQuery(
        ownerDb,
        SCOPE,
        ticketId,
      );
      expect(
        eventsBeforeDecision.map((event) => [event.fromStatus, event.toStatus]),
      ).toEqual([
        [null, "new"],
        ["new", "triaged"],
        ["triaged", "waiting_ai"],
        ["waiting_ai", "waiting_human"],
      ]);

      // 3. A follow-up inbound message on the same thread reconciles onto the
      //    same ticket (no duplicate conversation/ticket/workflow).
      const followUpMessageId = `<followup-${prefix}@mail.example>`;
      const followUpResponse = await app!.inject({
        method: "POST",
        url: `/v1/webhooks/email/mailgun?channel_id=${CHANNEL}`,
        headers: { "content-type": "application/json" },
        payload: mailgunPayload(followUpMessageId, "Any update on this?"),
      });
      expect(followUpResponse.statusCode).toBe(202);
      expect(followUpResponse.json().accepted).toBe(1);

      await pollUntil(async () => {
        const rows = await messageByExternalIdQuery(
          ownerDb,
          SCOPE,
          CHANNEL,
          followUpMessageId,
        );
        return rows[0]?.ticketId === ticketId ? rows[0] : null;
      }, "follow-up message reconciliation");

      const conversationRows = await conversationsListQuery(ownerDb, SCOPE, {
        limit: 10,
      });
      expect(conversationRows).toHaveLength(1);

      // 4. A duplicate provider delivery dedups at intake: no new rows.
      const duplicateResponse = await app!.inject({
        method: "POST",
        url: `/v1/webhooks/email/mailgun?channel_id=${CHANNEL}`,
        headers: { "content-type": "application/json" },
        payload: mailgunPayload(
          initialMessageId,
          "Where is my order? Please send the tracking number.",
        ),
      });
      expect(duplicateResponse.statusCode).toBe(202);
      expect(duplicateResponse.json().deduplicated).toBe(1);

      // 5. Restart the worker mid-workflow (acceptance: restart-safe, no
      //    duplicate messages/approvals/sends).
      await runtime!.shutdown();
      runtime = await startWorker();

      // 6. Approve the draft through the real API decide endpoint, which
      //    signals the Temporal workflow.
      const decideResponse = await app!.inject({
        method: "POST",
        url: `/v1/approvals/${approval.approvalId}/approve`,
        headers: {
          "content-type": "application/json",
          authorization: "Bearer e2e-placeholder-token",
          "x-tenant-id": TENANT,
          "x-user-id": REVIEWER,
          "x-user-roles": "support_agent",
        },
        payload: { review_notes: "Looks good." },
      });
      expect(decideResponse.statusCode).toBe(200);
      expect(decideResponse.json().workflow_signal).toMatchObject({
        delivered: true,
      });

      // 7. The workflow completes: deterministic draft sent exactly once.
      const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
      });

      try {
        const client = new TemporalClient({ connection });
        const result = (await client.workflow
          .getHandle(workflowId)
          .result()) as Record<string, unknown>;

        expect(result.phase).toBe("responded");
        expect(result.approval_status).toBe("approved");
        expect(result.outbound_message_id).toBeTruthy();
      } finally {
        await connection.close();
      }

      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0]?.url).toBe(
        `https://api.mailgun.net/v3/${SENDING_DOMAIN}/messages`,
      );
      expect(providerCalls[0]?.authorization).toBe(
        `Basic ${Buffer.from(`api:${SEND_CREDENTIAL}`).toString("base64")}`,
      );

      const outboundRow = (
        await messagesListQuery(ownerDb, SCOPE, conversationId, {
          limit: 20,
          direction: "outbound",
        })
      )[0]!;
      expect(outboundRow).toMatchObject({
        ticketId,
        sendStatus: "sent",
        sentByType: "human",
        approvalId: approval.approvalId,
        aiRunId: deterministicAiRunId(TENANT, ticketId, initialMessageId),
        providerMessageId: `<mailgun-${prefix}@${SENDING_DOMAIN}>`,
      });
      expect(outboundRow.bodyText).toContain("tracking");

      // 8. The response moves the ticket to waiting_customer, visible through
      //    the existing read APIs.
      const ticketRead = await app!.inject({
        method: "GET",
        url: `/v1/tickets/${ticketId}`,
        headers: {
          authorization: "Bearer e2e-placeholder-token",
          "x-tenant-id": TENANT,
          "x-user-id": REVIEWER,
          "x-user-roles": "support_agent",
        },
      });
      expect(ticketRead.statusCode).toBe(200);
      expect(ticketRead.json().ticket).toMatchObject({
        ticket_id: ticketId,
        status: "waiting_customer",
        topic: "order_status",
      });

      const auditRead = await app!.inject({
        method: "GET",
        url: `/v1/tickets/${ticketId}/audit-events?limit=50`,
        headers: {
          authorization: "Bearer e2e-placeholder-token",
          "x-tenant-id": TENANT,
          "x-user-id": REVIEWER,
          "x-user-roles": "support_agent",
        },
      });
      expect(auditRead.statusCode).toBe(200);

      const allAuditActions = (
        await auditEventsListQuery(ownerDb, SCOPE, { limit: 100 })
      ).map((event) => event.action);
      for (const action of [
        "ticket.created",
        "ticket.updated",
        "approval.requested",
        "approval.approved",
        "approval.completed",
        "message.sent",
      ]) {
        expect(allAuditActions).toContain(action);
      }

      // 9. Domain events landed on the JetStream support-events stream,
      //    including the new ai_run.completed emission.
      for (const eventSuffix of [
        "ticket.created.v1",
        "ticket.triaged.v1",
        "ai_run.completed.v1",
        "message.sent.v1",
      ]) {
        const subject = `support.events.tenant.${TENANT}.${eventSuffix}`;
        const stored = await eventBus!.jetStreamManager.streams.getMessage(
          SUPPORT_EVENTS_STREAM,
          { last_by_subj: subject },
        );
        expect(stored, subject).toBeTruthy();
      }

      // 10. The pending-approval race is closed: nothing else is pending and
      //     exactly one approval exists for the ticket.
      const approvalRows = await approvalsListQuery(ownerDb, SCOPE, {
        limit: 10,
        ticketId,
      });
      expect(approvalRows).toHaveLength(1);
      expect(approvalRows[0]?.status).toBe("approved");
    }, 180_000);
  },
);
