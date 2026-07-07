import {
  createDatabaseFromEnv,
  searchKbChunksQuery,
  withTenantTransaction,
  type JsonObject,
  type KbDocument,
  type PostgresClient,
} from "@support/db";
import {
  createDeterministicEmbedder,
  DETERMINISTIC_EMBEDDER_MODEL_ID,
  type Embedder,
} from "@support/integrations";
import type { KbSearchResult } from "@support/shared-schemas";

/** Default number of chunks a retrieval call returns when none is requested. */
export const DEFAULT_KB_SEARCH_LIMIT = 8;

/**
 * Default similarity floor: 0 keeps every non-negative-scoring hit, which is
 * the safe default for the deterministic lexical embedder. Real embedding
 * providers should configure a floor per environment (SUPPORT_KB_MIN_SIMILARITY;
 * `.env.example` documents the pilot value) so barely-related chunks never
 * reach the AI runtime as "evidence".
 */
export const DEFAULT_KB_MIN_SIMILARITY = 0;

/**
 * Default cumulative content budget (in characters) across the returned hits
 * — a max-context cap applied before results enter the AI runtime
 * (ADR-0015 follow-up). Generous enough that the default 8-chunk page is
 * unaffected for typical KB chunks; tighten per environment with
 * SUPPORT_KB_MAX_CONTEXT_CHARS.
 */
export const DEFAULT_KB_MAX_CONTEXT_CHARS = 24_000;

/**
 * Thrown when retrieval encounters chunks embedded by a different model than
 * the active embedder (Milestone 15). Cosine distance across embedding spaces
 * is meaningless, so this fails closed: the operator must re-ingest the KB
 * with the active provider (or restore the previous provider config) instead
 * of serving garbage rankings. Chunks ingested before model-id recording are
 * treated as deterministic-embedder chunks.
 */
export class EmbeddingModelMismatchError extends Error {
  constructor(
    readonly expectedModelId: string,
    readonly foundModelId: string,
  ) {
    super(
      `KB chunks were embedded with "${foundModelId}" but the active embedder is ` +
        `"${expectedModelId}". Re-ingest the knowledge base with the active embedding ` +
        "provider before searching (provider swap = full re-embed).",
    );
    this.name = "EmbeddingModelMismatchError";
  }
}

export interface KbRetrievalSearchParams {
  /** Query embedding; produced by the same `Embedder` used at ingestion. */
  readonly embedding: number[];
  readonly limit: number;
  readonly documentType?: KbDocument["documentType"];
  readonly sourceType?: KbDocument["sourceType"];
}

/**
 * A normalized retrieval hit: the matched chunk plus its relevance `score`
 * (cosine similarity in [-1, 1]; higher is more relevant) and the document-level
 * citation fields joined at query time.
 */
export interface KbChunkSearchHit {
  readonly kbChunkId: string;
  readonly tenantId: string;
  readonly kbDocumentId: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly status: KbDocument["status"];
  readonly metadata: JsonObject;
  readonly createdAt: Date;
  readonly score: number;
  readonly documentTitle: string;
  readonly documentType: KbDocument["documentType"];
  readonly sourceType: KbDocument["sourceType"];
  readonly sourceRef: string | null;
}

/**
 * Persistence boundary for KB retrieval. The DB implementation runs the vector
 * search under `withTenantTransaction` (RLS enforces the tenant filter and the
 * query itself restricts to active chunks of active documents); the in-memory
 * implementation mirrors those exact semantics over the ingestion store's data
 * for unit tests.
 */
export interface KbRetrievalStore {
  search(
    tenantId: string,
    params: KbRetrievalSearchParams,
  ): Promise<KbChunkSearchHit[]>;
  close?(): Promise<void>;
}

export interface SearchKbParams {
  readonly tenantId: string;
  readonly query: string;
  readonly limit?: number;
  readonly documentType?: KbDocument["documentType"];
  readonly sourceType?: KbDocument["sourceType"];
}

/**
 * Tenant-scoped KB retrieval. It embeds the query with the same `Embedder` used
 * at ingestion, runs a cosine nearest-neighbour search over the tenant's active
 * chunks (excluding stale/inactive documents), and returns citation-bearing
 * results. Retrieval is read-only and treats chunk content as untrusted data:
 * adversarial ("prompt injection") text in a chunk is returned verbatim as
 * evidence and never interpreted as an instruction here.
 */
export interface KbRetrievalService {
  search(params: SearchKbParams): Promise<KbSearchResult[]>;
  close?(): Promise<void>;
}

export interface KbRetrievalServiceDeps {
  readonly store: KbRetrievalStore;
  readonly embedder?: Embedder;
  readonly defaultLimit?: number;
  /** Hits scoring below this cosine similarity are dropped (floor). */
  readonly minScore?: number;
  /** Cumulative content budget (chars) across returned hits (context cap). */
  readonly maxContextChars?: number;
}

/**
 * Env-driven retrieval bounds (Milestone 15): the similarity floor and the
 * max-context cap applied before results enter the AI runtime.
 */
export interface KbRetrievalEnvConfig {
  readonly minScore: number;
  readonly maxContextChars: number;
}

export function loadKbRetrievalEnvConfig(
  env: NodeJS.ProcessEnv = process.env,
): KbRetrievalEnvConfig {
  return {
    minScore: parseNumberEnv(
      env.SUPPORT_KB_MIN_SIMILARITY,
      "SUPPORT_KB_MIN_SIMILARITY",
      DEFAULT_KB_MIN_SIMILARITY,
    ),
    maxContextChars: parseNumberEnv(
      env.SUPPORT_KB_MAX_CONTEXT_CHARS,
      "SUPPORT_KB_MAX_CONTEXT_CHARS",
      DEFAULT_KB_MAX_CONTEXT_CHARS,
    ),
  };
}

function parseNumberEnv(
  raw: string | undefined,
  name: string,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number (got "${raw}").`);
  }

  return value;
}

function mapHit(hit: KbChunkSearchHit): KbSearchResult {
  return {
    kb_chunk_id: hit.kbChunkId,
    tenant_id: hit.tenantId,
    kb_document_id: hit.kbDocumentId,
    chunk_index: hit.chunkIndex,
    content: hit.content,
    status: hit.status,
    metadata: hit.metadata,
    created_at: hit.createdAt.toISOString(),
    score: hit.score,
    document_title: hit.documentTitle,
    document_type: hit.documentType,
    source_type: hit.sourceType,
    source_ref: hit.sourceRef,
  };
}

export function createKbRetrievalService(
  deps: KbRetrievalServiceDeps,
): KbRetrievalService {
  const embedder = deps.embedder ?? createDeterministicEmbedder();
  const defaultLimit = deps.defaultLimit ?? DEFAULT_KB_SEARCH_LIMIT;
  const minScore = deps.minScore ?? DEFAULT_KB_MIN_SIMILARITY;
  const maxContextChars = deps.maxContextChars ?? DEFAULT_KB_MAX_CONTEXT_CHARS;

  return {
    async search({ tenantId, query, limit, documentType, sourceType }) {
      const [embedding] = await embedder.embed([query]);

      if (!embedding) {
        return [];
      }

      const hits = await deps.store.search(tenantId, {
        embedding,
        limit: limit ?? defaultLimit,
        documentType,
        sourceType,
      });

      // Ingestion/retrieval embedding-space match is enforced at query time
      // (Milestone 15): a chunk embedded by a different model makes the whole
      // search fail closed instead of ranking across incompatible spaces.
      // Pre-Milestone-15 chunks carry no id and were deterministic-embedded.
      for (const hit of hits) {
        const recorded =
          typeof hit.metadata["embedding_model_id"] === "string"
            ? (hit.metadata["embedding_model_id"] as string)
            : DETERMINISTIC_EMBEDDER_MODEL_ID;

        if (recorded !== embedder.modelId) {
          throw new EmbeddingModelMismatchError(embedder.modelId, recorded);
        }
      }

      // Similarity floor, then the max-context cap: keep hits (highest score
      // first, the store's order) until the cumulative content budget is
      // spent. The top hit is always kept so a single long chunk can never
      // starve retrieval entirely.
      const results: KbSearchResult[] = [];
      let budget = maxContextChars;

      for (const hit of hits) {
        if (hit.score < minScore) {
          continue;
        }

        if (results.length > 0 && hit.content.length > budget) {
          break;
        }

        results.push(mapHit(hit));
        budget -= hit.content.length;
      }

      return results;
    },
    async close() {
      await deps.store.close?.();
    },
  };
}

export function createDatabaseKbRetrievalStore(
  database?: ReturnType<typeof createDatabaseFromEnv>,
): KbRetrievalStore {
  let handle = database;

  function getClient(): PostgresClient {
    if (!handle) {
      handle = createDatabaseFromEnv();
    }

    return handle.client;
  }

  return {
    async search(tenantId, params) {
      return withTenantTransaction(
        getClient(),
        { tenantId },
        async (scoped) => {
          const rows = await searchKbChunksQuery(scoped, { tenantId }, params);

          return rows.map((row) => ({
            kbChunkId: row.kbChunkId,
            tenantId: row.tenantId,
            kbDocumentId: row.kbDocumentId,
            chunkIndex: row.chunkIndex,
            content: row.content,
            status: row.status,
            metadata: row.metadata ?? {},
            createdAt: row.createdAt,
            // pgvector `<=>` returns cosine distance; similarity = 1 - distance.
            score: 1 - Number(row.distance),
            documentTitle: row.documentTitle,
            documentType: row.documentType,
            sourceType: row.sourceType,
            sourceRef: row.sourceRef,
          }));
        },
      );
    },
    async close() {
      if (handle) {
        await handle.client.end();
      }
    },
  };
}

export interface DatabaseKbRetrievalServiceOptions {
  /**
   * The shared production embedder (Milestone 15) — the SAME instance wired
   * into ingestion, so query and chunk vectors share an embedding space.
   * Defaults to the deterministic embedder.
   */
  readonly embedder?: Embedder;
  readonly minScore?: number;
  readonly maxContextChars?: number;
}

/**
 * Default production KB retrieval service: a lazily-connected PostgreSQL
 * store, the supplied (default deterministic) embedder, and the env-driven
 * similarity floor / max-context cap. Constructing it opens no connections.
 */
export function createDatabaseKbRetrievalService(
  options: DatabaseKbRetrievalServiceOptions = {},
): KbRetrievalService {
  const envConfig = loadKbRetrievalEnvConfig();

  return createKbRetrievalService({
    store: createDatabaseKbRetrievalStore(),
    ...(options.embedder ? { embedder: options.embedder } : {}),
    minScore: options.minScore ?? envConfig.minScore,
    maxContextChars: options.maxContextChars ?? envConfig.maxContextChars,
  });
}

/** Minimal read model the in-memory retrieval store needs from a chunk row. */
interface InMemoryChunkView {
  readonly tenantId: string;
  readonly kbChunkId: string;
  readonly kbDocumentId: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly embedding: number[];
  readonly metadata: JsonObject;
  readonly status: KbDocument["status"];
  readonly createdAt: Date;
}

export interface InMemoryKbSource {
  readonly documents: ReadonlyMap<string, KbDocument>;
  readonly chunks: ReadonlyArray<InMemoryChunkView>;
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    magA += left * left;
    magB += right * right;
  }

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * In-memory KB retrieval store for unit tests. It reads the same document/chunk
 * state produced by `createInMemoryKbIngestionStore`, so a test can ingest and
 * then retrieve. It mirrors the DB store's filters exactly: tenant scope, active
 * chunk, active document (stale-document exclusion), and optional type filters,
 * ranked by cosine similarity.
 */
export function createInMemoryKbRetrievalStore(
  source: InMemoryKbSource,
): KbRetrievalStore {
  const documentKey = (tenantId: string, kbDocumentId: string): string =>
    `${tenantId}::${kbDocumentId}`;

  return {
    async search(tenantId, params) {
      const hits: KbChunkSearchHit[] = [];

      for (const chunk of source.chunks) {
        if (chunk.tenantId !== tenantId || chunk.status !== "active") {
          continue;
        }

        const document = source.documents.get(
          documentKey(tenantId, chunk.kbDocumentId),
        );

        // Stale/inactive/draft documents are excluded even if their chunk rows
        // are still marked active.
        if (!document || document.status !== "active") {
          continue;
        }

        if (
          params.documentType &&
          document.documentType !== params.documentType
        ) {
          continue;
        }

        if (params.sourceType && document.sourceType !== params.sourceType) {
          continue;
        }

        hits.push({
          kbChunkId: chunk.kbChunkId,
          tenantId: chunk.tenantId,
          kbDocumentId: chunk.kbDocumentId,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          status: chunk.status,
          metadata: chunk.metadata,
          createdAt: chunk.createdAt,
          score: cosineSimilarity(params.embedding, chunk.embedding),
          documentTitle: document.title,
          documentType: document.documentType,
          sourceType: document.sourceType,
          sourceRef: document.sourceRef,
        });
      }

      hits.sort((left, right) => right.score - left.score);
      return hits.slice(0, params.limit);
    },
  };
}
