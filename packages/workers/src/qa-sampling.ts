import { createHash } from "node:crypto";
import {
  createDatabaseFromEnv,
  createQaReviewQuery,
  qaSamplingCandidatesQuery,
  withTenantTransaction,
} from "@support/db";
import type { StructuredLogger } from "@support/observability";
import type { QaSampleReason } from "@support/shared-schemas";
import { emitQaReviewCreatedEvent } from "./domain-events.js";
import type { DomainEventPublisher } from "./event-publisher.js";

/**
 * QA sampling job (SOPS §10). Walks completed AI runs that have no QA
 * review yet and queues reviews by rule:
 *
 * - auto-send recommendations are sampled at 100% (`auto_send_candidate`)
 * - high-risk runs are sampled at 100% (`high_risk`)
 * - everything else is sampled at the configured random rate
 *   (`random_sample`, default 25% — the SOP's 20-30% pilot band)
 *
 * Selection is deterministic: the "random" bucket hashes the run id, so
 * re-running the job over the same backlog picks the same runs, and the
 * deterministic `qa_review_id` + conflict-safe insert make requeueing a
 * no-op instead of a duplicate review.
 */

export interface QaSamplingCandidate {
  readonly aiRunId: string;
  readonly ticketId: string;
  readonly status: string;
  readonly automationRecommendation: string | null;
  readonly riskLevel: string | null;
  readonly createdAt: Date;
}

export interface QaSamplingStore {
  listCandidates(params: {
    readonly tenantId: string;
    readonly since?: Date;
    readonly limit: number;
  }): Promise<readonly QaSamplingCandidate[]>;
  createQaReview(params: {
    readonly tenantId: string;
    readonly qaReviewId: string;
    readonly ticketId: string;
    readonly aiRunId: string;
    readonly sampleReason: QaSampleReason;
  }): Promise<{ created: boolean }>;
  close?(): Promise<void>;
}

export interface QaSamplingRules {
  /** Fraction of non-mandatory runs sampled at random; 0..1. */
  readonly randomSampleRate: number;
}

export const DEFAULT_QA_SAMPLING_RULES: QaSamplingRules = {
  randomSampleRate: 0.25,
};

export interface QaSamplingJobOptions {
  readonly tenantId: string;
  readonly since?: Date;
  readonly limit?: number;
  readonly rules?: QaSamplingRules;
}

export interface QaSamplingJobDependencies {
  readonly store: QaSamplingStore;
  /** When provided, a `support.qa.review_created.v1` event per new review. */
  readonly publisher?: DomainEventPublisher;
  readonly logger?: StructuredLogger;
  readonly now?: () => Date;
}

export interface QaSamplingJobResult {
  readonly scanned: number;
  readonly sampled: number;
  readonly skipped: number;
  readonly byReason: Readonly<Record<string, number>>;
}

export function deterministicQaReviewId(
  tenantId: string,
  aiRunId: string,
): string {
  return `qa_${hash24([tenantId, aiRunId])}`;
}

/**
 * Deterministic percentage bucket for the random-sample rule: hash the
 * tenant + run id into [0, 100). No RNG, so job runs are reproducible.
 */
export function samplingBucket(tenantId: string, aiRunId: string): number {
  const digest = createHash("sha256").update(`${tenantId}|${aiRunId}`).digest();

  return digest.readUInt32BE(0) % 100;
}

/** SOP rules that mandate review regardless of the random sample rate. */
export function classifyMandatorySampleReason(
  candidate: QaSamplingCandidate,
): QaSampleReason | null {
  if (candidate.automationRecommendation === "auto_send") {
    return "auto_send_candidate";
  }

  if (candidate.riskLevel === "high") {
    return "high_risk";
  }

  return null;
}

export async function runQaSamplingJob(
  dependencies: QaSamplingJobDependencies,
  options: QaSamplingJobOptions,
): Promise<QaSamplingJobResult> {
  const now = dependencies.now ?? (() => new Date());
  const rules = options.rules ?? DEFAULT_QA_SAMPLING_RULES;
  const limit = options.limit ?? 200;

  const candidates = await dependencies.store.listCandidates({
    tenantId: options.tenantId,
    since: options.since,
    limit,
  });

  let sampled = 0;
  const byReason: Record<string, number> = {};

  for (const candidate of candidates) {
    const mandatoryReason = classifyMandatorySampleReason(candidate);
    const reason: QaSampleReason | null =
      mandatoryReason ??
      (samplingBucket(options.tenantId, candidate.aiRunId) <
      Math.round(rules.randomSampleRate * 100)
        ? "random_sample"
        : null);

    if (reason === null) {
      continue;
    }

    const qaReviewId = deterministicQaReviewId(
      options.tenantId,
      candidate.aiRunId,
    );
    const { created } = await dependencies.store.createQaReview({
      tenantId: options.tenantId,
      qaReviewId,
      ticketId: candidate.ticketId,
      aiRunId: candidate.aiRunId,
      sampleReason: reason,
    });

    if (!created) {
      continue;
    }

    sampled += 1;
    byReason[reason] = (byReason[reason] ?? 0) + 1;

    dependencies.logger?.info("qa review queued", {
      tenant_id: options.tenantId,
      qa_review_id: qaReviewId,
      ticket_id: candidate.ticketId,
      ai_run_id: candidate.aiRunId,
      sample_reason: reason,
    });

    if (dependencies.publisher) {
      await emitQaReviewCreatedEvent(dependencies.publisher, {
        event_id: `evt:${options.tenantId}:${qaReviewId}:qa.review_created`,
        tenant_id: options.tenantId,
        correlation_id: qaReviewId,
        causation_id: candidate.aiRunId,
        occurred_at: now().toISOString(),
        actor: { type: "system", id: "qa-sampling-job" },
        payload: {
          qa_review_id: qaReviewId,
          ticket_id: candidate.ticketId,
        },
      });
    }
  }

  const result: QaSamplingJobResult = {
    scanned: candidates.length,
    sampled,
    skipped: candidates.length - sampled,
    byReason,
  };

  dependencies.logger?.info("qa sampling job completed", {
    tenant_id: options.tenantId,
    ...result,
  });

  return result;
}

/**
 * Database-backed sampling store: candidate discovery and review inserts
 * run under `withTenantTransaction`/RLS; the deterministic review id makes
 * the insert conflict-safe across repeated job runs.
 */
export function createDatabaseQaSamplingStore(): QaSamplingStore {
  let database: ReturnType<typeof createDatabaseFromEnv> | undefined;

  function getDatabase() {
    database ??= createDatabaseFromEnv();
    return database;
  }

  return {
    async listCandidates(params) {
      const scope = { tenantId: params.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await qaSamplingCandidatesQuery(db, scope, {
          limit: params.limit,
          since: params.since,
        });

        return rows.map((row) => ({
          aiRunId: row.aiRunId,
          ticketId: row.ticketId,
          status: row.status,
          automationRecommendation: row.automationRecommendation,
          riskLevel: row.riskLevel,
          createdAt: row.createdAt,
        }));
      });
    },

    async createQaReview(params) {
      const scope = { tenantId: params.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const inserted = await createQaReviewQuery(db, scope, {
          qaReviewId: params.qaReviewId,
          ticketId: params.ticketId,
          aiRunId: params.aiRunId,
          sampleReason: params.sampleReason,
        });

        return { created: inserted[0] !== undefined };
      });
    },

    async close() {
      await database?.client.end();
    },
  };
}

export interface InMemoryQaSamplingStore extends QaSamplingStore {
  listReviews(): readonly {
    tenantId: string;
    qaReviewId: string;
    ticketId: string;
    aiRunId: string;
    sampleReason: QaSampleReason;
  }[];
}

export function createInMemoryQaSamplingStore(
  candidates: readonly ({ tenantId: string } & QaSamplingCandidate)[] = [],
): InMemoryQaSamplingStore {
  const reviews = new Map<
    string,
    {
      tenantId: string;
      qaReviewId: string;
      ticketId: string;
      aiRunId: string;
      sampleReason: QaSampleReason;
    }
  >();

  return {
    async listCandidates(params) {
      return candidates
        .filter(
          (candidate) =>
            candidate.tenantId === params.tenantId &&
            (params.since === undefined ||
              candidate.createdAt >= params.since) &&
            ![...reviews.values()].some(
              (review) =>
                review.tenantId === params.tenantId &&
                review.aiRunId === candidate.aiRunId,
            ),
        )
        .slice(0, params.limit);
    },

    async createQaReview(params) {
      const key = `${params.tenantId}:${params.qaReviewId}`;

      if (reviews.has(key)) {
        return { created: false };
      }

      reviews.set(key, { ...params });

      return { created: true };
    },

    listReviews() {
      return [...reviews.values()];
    },
  };
}

function hash24(parts: readonly string[]): string {
  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 24);
}
