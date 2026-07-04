import { describe, expect, it } from "vitest";
import type { DomainEventEnvelope } from "@support/shared-schemas";
import {
  classifyMandatorySampleReason,
  createInMemoryQaSamplingStore,
  deterministicQaReviewId,
  runQaSamplingJob,
  samplingBucket,
  type QaSamplingCandidate,
} from "./qa-sampling.js";
import type { DomainEventPublisher } from "./event-publisher.js";

const TENANT = "ten_test";
const NOW = () => new Date("2026-07-04T12:00:00.000Z");

function candidate(
  overrides: Partial<{ tenantId: string } & QaSamplingCandidate> & {
    aiRunId: string;
  },
): { tenantId: string } & QaSamplingCandidate {
  return {
    tenantId: TENANT,
    ticketId: `tkt_${overrides.aiRunId}`,
    status: "succeeded",
    automationRecommendation: "human_approve",
    riskLevel: "low",
    createdAt: new Date("2026-07-03T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRecordingPublisher(): {
  publisher: DomainEventPublisher;
  events: DomainEventEnvelope[];
} {
  const events: DomainEventEnvelope[] = [];

  return {
    events,
    publisher: {
      async publish(event) {
        events.push(event);
        return {
          event_id: event.event_id,
          subject: `support.events.tenant.${event.tenant_id}.qa.review_created.v1`,
          stream: "SUPPORT_EVENTS",
          sequence: events.length,
          duplicate: false,
        };
      },
    },
  };
}

describe("classifyMandatorySampleReason", () => {
  it("always samples auto-send candidates and high-risk runs", () => {
    expect(
      classifyMandatorySampleReason(
        candidate({ aiRunId: "air_a", automationRecommendation: "auto_send" }),
      ),
    ).toBe("auto_send_candidate");
    expect(
      classifyMandatorySampleReason(
        candidate({ aiRunId: "air_b", riskLevel: "high" }),
      ),
    ).toBe("high_risk");
    expect(
      classifyMandatorySampleReason(candidate({ aiRunId: "air_c" })),
    ).toBeNull();
  });
});

describe("runQaSamplingJob", () => {
  it("queues mandatory reviews and emits qa.review_created events", async () => {
    const store = createInMemoryQaSamplingStore([
      candidate({ aiRunId: "air_auto", automationRecommendation: "auto_send" }),
      candidate({ aiRunId: "air_risky", riskLevel: "high" }),
    ]);
    const { publisher, events } = makeRecordingPublisher();

    const result = await runQaSamplingJob(
      { store, publisher, now: NOW },
      { tenantId: TENANT, rules: { randomSampleRate: 0 } },
    );

    expect(result).toMatchObject({ scanned: 2, sampled: 2, skipped: 0 });
    expect(result.byReason).toEqual({
      auto_send_candidate: 1,
      high_risk: 1,
    });
    const reviews = store.listReviews();
    expect(reviews).toHaveLength(2);
    expect(reviews[0]?.qaReviewId).toBe(
      deterministicQaReviewId(TENANT, "air_auto"),
    );
    expect(events).toHaveLength(2);
    expect(events[0]?.event_name).toBe("support.qa.review_created.v1");
    expect(events[0]?.payload).toMatchObject({
      qa_review_id: deterministicQaReviewId(TENANT, "air_auto"),
    });
  });

  it("samples the random bucket deterministically", async () => {
    const candidates = Array.from({ length: 40 }, (_, index) =>
      candidate({ aiRunId: `air_${index}` }),
    );
    const expected = candidates.filter(
      (entry) => samplingBucket(TENANT, entry.aiRunId) < 25,
    );
    const store = createInMemoryQaSamplingStore(candidates);

    const result = await runQaSamplingJob(
      { store, now: NOW },
      { tenantId: TENANT, rules: { randomSampleRate: 0.25 } },
    );

    expect(result.sampled).toBe(expected.length);
    expect(result.byReason).toEqual(
      expected.length > 0 ? { random_sample: expected.length } : {},
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(40);
  });

  it("is idempotent across repeated runs over the same backlog", async () => {
    const store = createInMemoryQaSamplingStore([
      candidate({ aiRunId: "air_auto", automationRecommendation: "auto_send" }),
    ]);

    const first = await runQaSamplingJob(
      { store, now: NOW },
      { tenantId: TENANT },
    );
    const second = await runQaSamplingJob(
      { store, now: NOW },
      { tenantId: TENANT },
    );

    expect(first.sampled).toBe(1);
    // The candidate query excludes already-reviewed runs entirely.
    expect(second.scanned).toBe(0);
    expect(second.sampled).toBe(0);
    expect(store.listReviews()).toHaveLength(1);
  });

  it("scopes candidates to the requested tenant", async () => {
    const store = createInMemoryQaSamplingStore([
      candidate({ aiRunId: "air_auto", automationRecommendation: "auto_send" }),
      {
        ...candidate({
          aiRunId: "air_other",
          automationRecommendation: "auto_send",
        }),
        tenantId: "ten_other",
      },
    ]);

    const result = await runQaSamplingJob(
      { store, now: NOW },
      { tenantId: TENANT },
    );

    expect(result.scanned).toBe(1);
    expect(store.listReviews()).toHaveLength(1);
    expect(store.listReviews()[0]?.tenantId).toBe(TENANT);
  });
});
