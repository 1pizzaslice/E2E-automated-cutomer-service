import { describe, expect, it } from "vitest";
import {
  computeRetentionCutoffs,
  createInMemoryRetentionStore,
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

describe("tenant retention job", () => {
  it("clears expired raw payload refs, keeps fresh ones, and audits the purge", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { raw_payload_days: 30, ai_run_days: 365 },
      messages: [
        {
          messageId: "msg_old",
          rawPayloadRef: "file://raw/old.json",
          attachmentCount: 0,
          createdAt: daysAgo(45),
        },
        {
          messageId: "msg_fresh",
          rawPayloadRef: "file://raw/fresh.json",
          attachmentCount: 0,
          createdAt: daysAgo(5),
        },
        {
          messageId: "msg_already_cleared",
          rawPayloadRef: null,
          attachmentCount: 0,
          createdAt: daysAgo(90),
        },
      ],
      aiRunCreatedAts: [daysAgo(400), daysAgo(10)],
    });

    const result = await runTenantRetentionJob(
      { store, now },
      { tenantId: "ten_retention" },
    );

    expect(result.applied).toBe(true);
    expect(result.rawPayloadsCleared).toBe(1);
    expect(result.clearedRawPayloadRefs).toEqual(["file://raw/old.json"]);
    expect(result.plannedAiRuns).toBe(1);
    expect(result.skippedReason).toBeNull();

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
      metadata: { raw_payloads_cleared: 1 },
    });
  });

  it("is idempotent: a second run has nothing left to clear and adds no audit", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { raw_payload_days: 30 },
      messages: [
        {
          messageId: "msg_old",
          rawPayloadRef: "file://raw/old.json",
          attachmentCount: 0,
          createdAt: daysAgo(45),
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
          attachmentCount: 2,
          createdAt: daysAgo(1000),
        },
      ],
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
    expect(store.listAuditEvents()).toHaveLength(0);
  });

  it("reports attachment and ai-run purges as planned placeholders only", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { attachment_days: 30, ai_run_days: 30 },
      messages: [
        {
          messageId: "msg_attach",
          rawPayloadRef: null,
          attachmentCount: 3,
          createdAt: daysAgo(60),
        },
      ],
      aiRunCreatedAts: [daysAgo(60)],
    });

    const result = await runTenantRetentionJob(
      { store, now },
      { tenantId: "ten_retention" },
    );

    expect(result.plannedAttachmentMessages).toBe(1);
    expect(result.plannedAiRuns).toBe(1);
    expect(result.rawPayloadsCleared).toBe(0);
    // Placeholders are reported, never deleted (BACKEND_SPEC §22).
    expect(store.listMessages()).toHaveLength(1);
  });

  it("skips unknown tenants", async () => {
    const store = createInMemoryRetentionStore({ tenantExists: false });

    const result = await runTenantRetentionJob(
      { store, now },
      { tenantId: "ten_missing" },
    );

    expect(result.skippedReason).toBe("tenant_not_found");
  });

  it("bounds each run to the batch limit", async () => {
    const store = createInMemoryRetentionStore({
      retentionPolicy: { raw_payload_days: 1 },
      messages: Array.from({ length: 5 }, (_, index) => ({
        messageId: `msg_${index}`,
        rawPayloadRef: `file://raw/${index}.json`,
        attachmentCount: 0,
        createdAt: daysAgo(10),
      })),
    });

    const result = await runTenantRetentionJob(
      { store, now },
      { tenantId: "ten_retention", batchLimit: 2 },
    );

    expect(result.rawPayloadsCleared).toBe(2);
    expect(
      store.listMessages().filter((message) => message.rawPayloadRef !== null),
    ).toHaveLength(3);
  });
});
