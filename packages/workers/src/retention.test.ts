import { describe, expect, it } from "vitest";
import { createRecordingBlobSweeper } from "./blob-sweeper.js";
import {
  computeRetentionCutoffs,
  createInMemoryRetentionStore,
  isLocallyStoredRef,
  runTenantRetentionJob,
} from "./retention.js";

const NOW = new Date("2026-07-04T00:00:00.000Z");
const now = () => NOW;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("retention cutoffs", () => {
  it("computes per-class cutoffs from the tenant policy", () => {
    const cutoffs = computeRetentionCutoffs(
      { raw_payload_days: 30, attachment_days: 60, ai_run_days: 365 },
      NOW,
    );

    expect(cutoffs.rawPayloadCutoff).toEqual(daysAgo(30));
    expect(cutoffs.attachmentCutoff).toEqual(daysAgo(60));
    expect(cutoffs.aiRunCutoff).toEqual(daysAgo(365));
  });

  it("treats absent or null values as retain-forever", () => {
    const cutoffs = computeRetentionCutoffs({ raw_payload_days: null }, NOW);

    expect(cutoffs.rawPayloadCutoff).toBeNull();
    expect(cutoffs.attachmentCutoff).toBeNull();
    expect(cutoffs.aiRunCutoff).toBeNull();
  });
});

describe("isLocallyStoredRef", () => {
  it("recognizes file refs as local and provider refs as external", () => {
    expect(isLocallyStoredRef("file:///data/raw/a.json")).toBe(true);
    expect(isLocallyStoredRef("whatsapp-media:12345")).toBe(false);
    expect(isLocallyStoredRef("https://provider.example/media/1")).toBe(false);
  });
});

describe("tenant retention job", () => {
  it("sweeps blobs, clears expired raw payload refs, keeps fresh ones, and audits the purge", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { raw_payload_days: 30 },
      messages: [
        {
          messageId: "msg_old",
          rawPayloadRef: "file://raw/old.json",
          attachmentRefs: [],
          createdAt: daysAgo(45),
        },
        {
          messageId: "msg_fresh",
          rawPayloadRef: "file://raw/fresh.json",
          attachmentRefs: [],
          createdAt: daysAgo(5),
        },
        {
          messageId: "msg_already_cleared",
          rawPayloadRef: null,
          attachmentRefs: [],
          createdAt: daysAgo(90),
        },
      ],
    });
    const blobSweeper = createRecordingBlobSweeper();

    const result = await runTenantRetentionJob(
      { store, blobSweeper, now },
      { tenantId: "ten_retention" },
    );

    expect(result.applied).toBe(true);
    expect(result.rawPayloadsCleared).toBe(1);
    expect(result.clearedRawPayloadRefs).toEqual(["file://raw/old.json"]);
    expect(result.blobSweepFailures).toEqual([]);
    expect(result.skippedReason).toBeNull();
    expect(blobSweeper.sweptRefs).toEqual(["file://raw/old.json"]);

    const messages = store.listMessages();
    expect(
      messages.find((message) => message.messageId === "msg_old")
        ?.rawPayloadRef,
    ).toBeNull();
    expect(
      messages.find((message) => message.messageId === "msg_fresh")
        ?.rawPayloadRef,
    ).toBe("file://raw/fresh.json");

    const audits = store.listAuditEvents();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      tenantId: "ten_retention",
      action: "retention.applied",
      metadata: { raw_payloads_cleared: 1, blob_sweep_failures: 0 },
    });
  });

  it("fails closed on sweep failures: the database ref stays for the next run", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { raw_payload_days: 30 },
      messages: [
        {
          messageId: "msg_sweepable",
          rawPayloadRef: "file://raw/sweepable.json",
          attachmentRefs: [],
          createdAt: daysAgo(45),
        },
        {
          messageId: "msg_stuck",
          rawPayloadRef: "file://raw/stuck.json",
          attachmentRefs: [],
          createdAt: daysAgo(45),
        },
      ],
    });
    const blobSweeper = createRecordingBlobSweeper({
      failRefs: new Set(["file://raw/stuck.json"]),
    });

    const result = await runTenantRetentionJob(
      { store, blobSweeper, now },
      { tenantId: "ten_retention" },
    );

    expect(result.rawPayloadsCleared).toBe(1);
    expect(result.clearedRawPayloadRefs).toEqual(["file://raw/sweepable.json"]);
    expect(result.blobSweepFailures).toEqual([
      { ref: "file://raw/stuck.json", reason: "sweep_failed" },
    ]);

    // The failed ref keeps its row so the next run retries the blob.
    expect(
      store.listMessages().find((message) => message.messageId === "msg_stuck")
        ?.rawPayloadRef,
    ).toBe("file://raw/stuck.json");
  });

  it("purges expired attachments: local blobs swept, provider refs metadata-only", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { attachment_days: 30 },
      messages: [
        {
          messageId: "msg_local_attach",
          rawPayloadRef: null,
          attachmentRefs: ["file://attachments/a.pdf"],
          createdAt: daysAgo(60),
        },
        {
          messageId: "msg_provider_attach",
          rawPayloadRef: null,
          attachmentRefs: ["whatsapp-media:123"],
          createdAt: daysAgo(60),
        },
        {
          messageId: "msg_fresh_attach",
          rawPayloadRef: null,
          attachmentRefs: ["file://attachments/fresh.pdf"],
          createdAt: daysAgo(5),
        },
      ],
    });
    const blobSweeper = createRecordingBlobSweeper();

    const result = await runTenantRetentionJob(
      { store, blobSweeper, now },
      { tenantId: "ten_retention" },
    );

    expect(result.applied).toBe(true);
    expect(result.attachmentMessagesPurged).toBe(2);
    expect(result.purgedAttachmentRefs).toEqual([
      "file://attachments/a.pdf",
      "whatsapp-media:123",
    ]);
    // Only the locally stored blob went to the sweeper.
    expect(blobSweeper.sweptRefs).toEqual(["file://attachments/a.pdf"]);

    const messages = store.listMessages();
    expect(
      messages.find((message) => message.messageId === "msg_local_attach")
        ?.attachmentRefs,
    ).toEqual([]);
    expect(
      messages.find((message) => message.messageId === "msg_provider_attach")
        ?.attachmentRefs,
    ).toEqual([]);
    expect(
      messages.find((message) => message.messageId === "msg_fresh_attach")
        ?.attachmentRefs,
    ).toEqual(["file://attachments/fresh.pdf"]);
  });

  it("keeps attachment metadata when a local blob fails to sweep", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { attachment_days: 30 },
      messages: [
        {
          messageId: "msg_stuck_attach",
          rawPayloadRef: null,
          attachmentRefs: ["file://attachments/stuck.pdf", "whatsapp-media:9"],
          createdAt: daysAgo(60),
        },
      ],
    });
    const blobSweeper = createRecordingBlobSweeper({
      failRefs: new Set(["file://attachments/stuck.pdf"]),
    });

    const result = await runTenantRetentionJob(
      { store, blobSweeper, now },
      { tenantId: "ten_retention" },
    );

    expect(result.attachmentMessagesPurged).toBe(0);
    expect(result.applied).toBe(false);
    expect(result.blobSweepFailures).toEqual([
      { ref: "file://attachments/stuck.pdf", reason: "sweep_failed" },
    ]);
    expect(store.listMessages()[0]?.attachmentRefs).toEqual([
      "file://attachments/stuck.pdf",
      "whatsapp-media:9",
    ]);
    expect(store.listAuditEvents()).toHaveLength(0);
  });

  it("anonymizes expired ai runs once and keeps fresh ones", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { ai_run_days: 365 },
      aiRuns: [
        { aiRunId: "run_old", createdAt: daysAgo(400) },
        { aiRunId: "run_fresh", createdAt: daysAgo(10) },
        {
          aiRunId: "run_done",
          createdAt: daysAgo(500),
          anonymizedAt: daysAgo(30),
        },
      ],
    });

    const first = await runTenantRetentionJob(
      { store, now },
      { tenantId: "ten_retention" },
    );
    const second = await runTenantRetentionJob(
      { store, now },
      { tenantId: "ten_retention" },
    );

    expect(first.aiRunsAnonymized).toBe(1);
    expect(first.applied).toBe(true);
    expect(second.aiRunsAnonymized).toBe(0);
    expect(second.applied).toBe(false);

    const runs = store.listAiRuns();
    expect(runs.find((run) => run.aiRunId === "run_old")?.anonymizedAt).toEqual(
      NOW,
    );
    expect(
      runs.find((run) => run.aiRunId === "run_fresh")?.anonymizedAt,
    ).toBeNull();
    expect(store.listAuditEvents()).toHaveLength(1);
    expect(store.listAuditEvents()[0]?.metadata).toMatchObject({
      ai_runs_anonymized: 1,
    });
  });

  it("purges every configured class in one run and audits the totals", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: {
        raw_payload_days: 30,
        attachment_days: 30,
        ai_run_days: 30,
      },
      messages: [
        {
          messageId: "msg_both",
          rawPayloadRef: "file://raw/both.json",
          attachmentRefs: ["file://attachments/both.pdf"],
          createdAt: daysAgo(60),
        },
      ],
      aiRuns: [{ aiRunId: "run_old", createdAt: daysAgo(60) }],
    });
    const blobSweeper = createRecordingBlobSweeper();

    const result = await runTenantRetentionJob(
      { store, blobSweeper, now },
      { tenantId: "ten_retention" },
    );

    expect(result.rawPayloadsCleared).toBe(1);
    expect(result.attachmentMessagesPurged).toBe(1);
    expect(result.aiRunsAnonymized).toBe(1);
    expect(store.listAuditEvents()).toHaveLength(1);
    expect(store.listAuditEvents()[0]?.metadata).toMatchObject({
      raw_payloads_cleared: 1,
      attachment_messages_purged: 1,
      ai_runs_anonymized: 1,
      blob_sweep_failures: 0,
    });
  });

  it("clears refs without a sweeper and returns them for external sweeping (legacy mode)", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { raw_payload_days: 30 },
      messages: [
        {
          messageId: "msg_old",
          rawPayloadRef: "file://raw/old.json",
          attachmentRefs: [],
          createdAt: daysAgo(45),
        },
      ],
    });

    const result = await runTenantRetentionJob(
      { store, now },
      { tenantId: "ten_retention" },
    );

    expect(result.rawPayloadsCleared).toBe(1);
    expect(result.clearedRawPayloadRefs).toEqual(["file://raw/old.json"]);
    expect(result.blobSweepFailures).toEqual([]);
  });

  it("is idempotent: a second run has nothing left to clear and adds no audit", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { raw_payload_days: 30 },
      messages: [
        {
          messageId: "msg_old",
          rawPayloadRef: "file://raw/old.json",
          attachmentRefs: [],
          createdAt: daysAgo(45),
        },
      ],
    });
    const blobSweeper = createRecordingBlobSweeper();

    const first = await runTenantRetentionJob(
      { store, blobSweeper, now },
      { tenantId: "ten_retention" },
    );
    const second = await runTenantRetentionJob(
      { store, blobSweeper, now },
      { tenantId: "ten_retention" },
    );

    expect(first.rawPayloadsCleared).toBe(1);
    expect(second.rawPayloadsCleared).toBe(0);
    expect(second.applied).toBe(false);
    expect(store.listAuditEvents()).toHaveLength(1);
  });

  it("fails closed when no retention is configured", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: {},
      messages: [
        {
          messageId: "msg_ancient",
          rawPayloadRef: "file://raw/ancient.json",
          attachmentRefs: ["file://attachments/ancient.pdf"],
          createdAt: daysAgo(1000),
        },
      ],
      aiRuns: [{ aiRunId: "run_ancient", createdAt: daysAgo(1000) }],
    });

    const result = await runTenantRetentionJob(
      { store, now },
      { tenantId: "ten_retention" },
    );

    expect(result.applied).toBe(false);
    expect(result.skippedReason).toBe("no_retention_configured");
    expect(store.listMessages()[0]?.rawPayloadRef).toBe(
      "file://raw/ancient.json",
    );
    expect(store.listAiRuns()[0]?.anonymizedAt).toBeNull();
    expect(store.listAuditEvents()).toHaveLength(0);
  });

  it("skips unknown tenants", async () => {
    const store = createInMemoryRetentionStore({ tenantExists: false });

    const result = await runTenantRetentionJob(
      { store, now },
      { tenantId: "ten_missing" },
    );

    expect(result.skippedReason).toBe("tenant_not_found");
  });

  it("bounds each run to the batch limit and reports the hit", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { raw_payload_days: 1 },
      messages: Array.from({ length: 5 }, (_, index) => ({
        messageId: `msg_${index}`,
        rawPayloadRef: `file://raw/${index}.json`,
        attachmentRefs: [],
        createdAt: daysAgo(10),
      })),
    });
    const blobSweeper = createRecordingBlobSweeper();

    const result = await runTenantRetentionJob(
      { store, blobSweeper, now },
      { tenantId: "ten_retention", batchLimit: 2 },
    );

    expect(result.rawPayloadsCleared).toBe(2);
    expect(result.batchLimitHit).toBe(true);
    expect(
      store.listMessages().filter((message) => message.rawPayloadRef !== null),
    ).toHaveLength(3);

    const drained = await runTenantRetentionJob(
      { store, blobSweeper, now },
      { tenantId: "ten_retention", batchLimit: 5 },
    );
    expect(drained.rawPayloadsCleared).toBe(3);
    expect(drained.batchLimitHit).toBe(false);
  });
});
