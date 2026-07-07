import { createRecordingSupportMetrics } from "@support/observability";
import { describe, expect, it } from "vitest";
import { createRecordingBlobSweeper } from "../blob-sweeper.js";
import type { DomainEventPublisher } from "../event-publisher.js";
import { createInMemoryQaSamplingStore } from "../qa-sampling.js";
import {
  createInMemoryRetentionStore,
  type RetentionStore,
} from "../retention.js";
import { createScheduledJobsActivities } from "./scheduled-jobs-activities.js";

const NOW = new Date("2026-07-04T00:00:00.000Z");
const now = () => NOW;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function createRecordingPublisher(): DomainEventPublisher & {
  readonly eventTypes: string[];
} {
  const eventTypes: string[] = [];

  return {
    eventTypes,
    async publish(event) {
      eventTypes.push(event.event_name);
      return {
        event_id: event.event_id,
        subject: `support.events.tenant.${event.tenant_id}.qa.review_created.v1`,
        stream: "SUPPORT_EVENTS",
        sequence: eventTypes.length,
        duplicate: false,
      };
    },
  };
}

describe("runRetentionJob activity", () => {
  it("runs the retention job with the blob sweeper and records job + purge metrics", async () => {
    const retentionStore = createInMemoryRetentionStore({
      retentionPolicy: { raw_payload_days: 30, ai_run_days: 30 },
      messages: [
        {
          messageId: "msg_old",
          rawPayloadRef: "file://raw/old.json",
          attachmentRefs: [],
          createdAt: daysAgo(45),
        },
      ],
      aiRuns: [{ aiRunId: "run_old", createdAt: daysAgo(45) }],
    });
    const blobSweeper = createRecordingBlobSweeper();
    const metrics = createRecordingSupportMetrics();
    const activities = createScheduledJobsActivities({
      retentionStore,
      qaSamplingStore: createInMemoryQaSamplingStore(),
      blobSweeper,
      domainEventPublisher: createRecordingPublisher(),
      metrics,
      now,
    });

    const result = await activities.runRetentionJob({ tenant_id: "ten_a" });

    expect(result).toEqual({
      applied: true,
      raw_payloads_cleared: 1,
      attachment_messages_purged: 0,
      ai_runs_anonymized: 1,
      blob_sweep_failures: 0,
      batch_limit_hit: false,
      skipped_reason: null,
    });
    expect(blobSweeper.sweptRefs).toEqual(["file://raw/old.json"]);
    expect(metrics.jobRuns).toEqual([
      {
        job: "retention",
        outcome: "succeeded",
        tenantId: "ten_a",
        durationMs: 0,
      },
    ]);
    expect(metrics.retentionPurges).toEqual([
      { retentionClass: "raw_payload", tenantId: "ten_a", count: 1 },
      { retentionClass: "attachment", tenantId: "ten_a", count: 0 },
      { retentionClass: "ai_run", tenantId: "ten_a", count: 1 },
    ]);
  });

  it("records the retention_sweep_failed critical failure when blobs stay unswept", async () => {
    const retentionStore = createInMemoryRetentionStore({
      retentionPolicy: { raw_payload_days: 30 },
      messages: [
        {
          messageId: "msg_stuck",
          rawPayloadRef: "file://raw/stuck.json",
          attachmentRefs: [],
          createdAt: daysAgo(45),
        },
      ],
    });
    const metrics = createRecordingSupportMetrics();
    const activities = createScheduledJobsActivities({
      retentionStore,
      qaSamplingStore: createInMemoryQaSamplingStore(),
      blobSweeper: createRecordingBlobSweeper({
        failRefs: new Set(["file://raw/stuck.json"]),
      }),
      domainEventPublisher: createRecordingPublisher(),
      metrics,
      now,
    });

    const result = await activities.runRetentionJob({ tenant_id: "ten_a" });

    expect(result.blob_sweep_failures).toBe(1);
    expect(result.raw_payloads_cleared).toBe(0);
    expect(metrics.criticalFailures).toEqual(["retention_sweep_failed"]);
    // The run itself did not throw: the schedule keeps its daily cadence.
    expect(metrics.jobRuns[0]?.outcome).toBe("succeeded");
  });

  it("records a skipped outcome when the tenant has no retention configured", async () => {
    const metrics = createRecordingSupportMetrics();
    const activities = createScheduledJobsActivities({
      retentionStore: createInMemoryRetentionStore({ retentionPolicy: {} }),
      qaSamplingStore: createInMemoryQaSamplingStore(),
      blobSweeper: createRecordingBlobSweeper(),
      domainEventPublisher: createRecordingPublisher(),
      metrics,
      now,
    });

    const result = await activities.runRetentionJob({ tenant_id: "ten_a" });

    expect(result.skipped_reason).toBe("no_retention_configured");
    expect(metrics.jobRuns).toEqual([
      {
        job: "retention",
        outcome: "skipped",
        tenantId: "ten_a",
        durationMs: 0,
      },
    ]);
  });

  it("records a failed run and rethrows so Temporal retries", async () => {
    const failingStore: RetentionStore = {
      async getTenantRetentionPolicy() {
        throw new Error("database unavailable");
      },
      async listExpiredRawPayloadMessages() {
        return [];
      },
      async clearRawPayloadRefs() {
        return 0;
      },
      async listExpiredAttachmentMessages() {
        return [];
      },
      async clearMessageAttachments() {
        return 0;
      },
      async listExpiredAiRunIds() {
        return [];
      },
      async anonymizeAiRuns() {
        return 0;
      },
      async recordRetentionAudit() {},
    };
    const metrics = createRecordingSupportMetrics();
    const activities = createScheduledJobsActivities({
      retentionStore: failingStore,
      qaSamplingStore: createInMemoryQaSamplingStore(),
      blobSweeper: createRecordingBlobSweeper(),
      domainEventPublisher: createRecordingPublisher(),
      metrics,
      now,
    });

    await expect(
      activities.runRetentionJob({ tenant_id: "ten_a" }),
    ).rejects.toThrow("database unavailable");
    expect(metrics.jobRuns).toEqual([
      { job: "retention", outcome: "failed", tenantId: "ten_a", durationMs: 0 },
    ]);
  });
});

describe("runQaSamplingJob activity", () => {
  it("runs the sampling job, emits events, and records the job metric", async () => {
    const qaSamplingStore = createInMemoryQaSamplingStore([
      {
        tenantId: "ten_a",
        aiRunId: "run_auto",
        ticketId: "tkt_1",
        status: "succeeded",
        automationRecommendation: "auto_send",
        riskLevel: "low",
        createdAt: daysAgo(1),
      },
    ]);
    const publisher = createRecordingPublisher();
    const metrics = createRecordingSupportMetrics();
    const activities = createScheduledJobsActivities({
      retentionStore: createInMemoryRetentionStore(),
      qaSamplingStore,
      blobSweeper: createRecordingBlobSweeper(),
      domainEventPublisher: publisher,
      metrics,
      now,
    });

    const result = await activities.runQaSamplingJob({ tenant_id: "ten_a" });

    expect(result).toEqual({
      scanned: 1,
      sampled: 1,
      skipped: 0,
      by_reason: { auto_send_candidate: 1 },
      batch_limit_hit: false,
    });
    expect(publisher.eventTypes).toEqual(["support.qa.review_created.v1"]);
    expect(metrics.jobRuns).toEqual([
      {
        job: "qa_sampling",
        outcome: "succeeded",
        tenantId: "ten_a",
        durationMs: 0,
      },
    ]);
  });

  it("reports a batch-limit hit when the scan fills the batch", async () => {
    const qaSamplingStore = createInMemoryQaSamplingStore(
      Array.from({ length: 3 }, (_, index) => ({
        tenantId: "ten_a",
        aiRunId: `run_${index}`,
        ticketId: `tkt_${index}`,
        status: "succeeded",
        automationRecommendation: "auto_send",
        riskLevel: "low",
        createdAt: daysAgo(1),
      })),
    );
    const activities = createScheduledJobsActivities({
      retentionStore: createInMemoryRetentionStore(),
      qaSamplingStore,
      blobSweeper: createRecordingBlobSweeper(),
      domainEventPublisher: createRecordingPublisher(),
      now,
      batchLimit: 2,
    });

    const first = await activities.runQaSamplingJob({ tenant_id: "ten_a" });
    const second = await activities.runQaSamplingJob({ tenant_id: "ten_a" });

    expect(first.batch_limit_hit).toBe(true);
    expect(first.sampled).toBe(2);
    expect(second.batch_limit_hit).toBe(false);
    expect(second.sampled).toBe(1);
  });

  it("records a failed run and rethrows", async () => {
    const metrics = createRecordingSupportMetrics();
    const activities = createScheduledJobsActivities({
      retentionStore: createInMemoryRetentionStore(),
      qaSamplingStore: {
        async listCandidates() {
          throw new Error("database unavailable");
        },
        async createQaReview() {
          return { created: false };
        },
      },
      blobSweeper: createRecordingBlobSweeper(),
      domainEventPublisher: createRecordingPublisher(),
      metrics,
      now,
    });

    await expect(
      activities.runQaSamplingJob({ tenant_id: "ten_a" }),
    ).rejects.toThrow("database unavailable");
    expect(metrics.jobRuns).toEqual([
      {
        job: "qa_sampling",
        outcome: "failed",
        tenantId: "ten_a",
        durationMs: 0,
      },
    ]);
  });
});
