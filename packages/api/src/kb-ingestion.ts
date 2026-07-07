import { createHash, randomUUID } from "node:crypto";
import type { KbDocument } from "@support/db";
import {
  chunkDocument,
  createDeterministicEmbedder,
  type ChunkOptions,
  type Embedder,
} from "@support/integrations";
import type {
  KbDocumentCreateRequest,
  KbDocumentUpdateRequest,
  KbIngestionResult,
} from "@support/shared-schemas";
import { createFilesystemKbContentStore } from "./kb-content-store.js";
import type { KbContentStore } from "./kb-content-store.js";
import {
  createDatabaseKbIngestionStore,
  type KbDocumentUpdateValues,
  type KbIngestionStore,
} from "./kb-ingestion-store.js";

export interface CreateKbDocumentParams {
  readonly tenantId: string;
  readonly createdByUserId: string | null;
  readonly input: KbDocumentCreateRequest;
}

export interface UpdateKbDocumentParams {
  readonly tenantId: string;
  readonly kbDocumentId: string;
  readonly input: KbDocumentUpdateRequest;
}

export interface IngestKbDocumentParams {
  readonly tenantId: string;
  readonly kbDocumentId: string;
}

/**
 * Orchestrates KB document ingestion: it stores raw content by reference,
 * persists document metadata, and (on ingest) chunks + embeds the content and
 * writes an active chunk set for tenant-scoped retrieval. Chunking and embedding
 * are pure/deterministic (see `@support/integrations`) so ingestion is
 * reproducible and replay-safe when a Temporal `KbIngestionWorkflow` later drives
 * these same steps as activities.
 */
export interface KbIngestionService {
  createDocument(params: CreateKbDocumentParams): Promise<KbDocument>;
  updateDocument(params: UpdateKbDocumentParams): Promise<KbDocument | null>;
  ingestDocument(
    params: IngestKbDocumentParams,
  ): Promise<KbIngestionResult | null>;
  close?(): Promise<void>;
}

export interface KbIngestionServiceDeps {
  readonly store: KbIngestionStore;
  readonly contentStore: KbContentStore;
  readonly embedder?: Embedder;
  readonly chunkOptions?: ChunkOptions;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function definedUpdateValues(
  input: KbDocumentUpdateRequest,
): KbDocumentUpdateValues {
  const values: KbDocumentUpdateValues = {};

  if (input.title !== undefined) {
    values.title = input.title;
  }
  if (input.source_ref !== undefined) {
    values.sourceRef = input.source_ref;
  }
  if (input.document_type !== undefined) {
    values.documentType = input.document_type;
  }
  if (input.status !== undefined) {
    values.status = input.status;
  }

  return values;
}

export function createKbIngestionService(
  deps: KbIngestionServiceDeps,
): KbIngestionService {
  const embedder = deps.embedder ?? createDeterministicEmbedder();

  return {
    async createDocument({ tenantId, createdByUserId, input }) {
      const kbDocumentId = input.kb_document_id ?? `kbd_${randomUUID()}`;

      await deps.contentStore.put({
        tenantId,
        kbDocumentId,
        content: input.content,
      });

      return deps.store.createDocument(tenantId, {
        kbDocumentId,
        title: input.title,
        sourceType: input.source_type,
        sourceRef: input.source_ref ?? null,
        documentType: input.document_type,
        status: "draft",
        version: 1,
        contentHash: contentHash(input.content),
        createdByUserId,
      });
    },
    async updateDocument({ tenantId, kbDocumentId, input }) {
      return deps.store.updateDocument(
        tenantId,
        kbDocumentId,
        definedUpdateValues(input),
      );
    },
    async ingestDocument({ tenantId, kbDocumentId }) {
      const document = await deps.store.getDocumentById(tenantId, kbDocumentId);

      if (!document) {
        return null;
      }

      const content = await deps.contentStore.get({ tenantId, kbDocumentId });

      if (content === null) {
        throw new Error(
          `KB document ${kbDocumentId} has no stored content to ingest.`,
        );
      }

      const chunks = chunkDocument(content, deps.chunkOptions ?? {});
      const embeddings = await embedder.embed(
        chunks.map((chunk) => chunk.content),
      );

      const inserts = chunks.map((chunk, index) => ({
        kbChunkId: `kbc_${randomUUID()}`,
        kbDocumentId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        embedding: embeddings[index] ?? [],
        metadata: {
          document_type: document.documentType,
          source_type: document.sourceType,
          // Which embedding space produced this vector (Milestone 15).
          // Retrieval enforces a match at query time: a provider swap means
          // re-ingesting every document, never mixing spaces (ADR-0014).
          embedding_model_id: embedder.modelId,
        },
        status: "active" as const,
      }));

      const embeddedCount = await deps.store.replaceChunks(
        tenantId,
        kbDocumentId,
        inserts,
      );

      // A re-ingest of an already-active document keeps it active; a draft
      // becomes active once its chunks are embedded and searchable.
      const updated = await deps.store.updateDocument(tenantId, kbDocumentId, {
        status: "active",
      });

      return {
        kb_document_id: kbDocumentId,
        status: updated?.status ?? "active",
        version: updated?.version ?? document.version,
        content_hash: document.contentHash,
        chunk_count: chunks.length,
        embedded_count: embeddedCount,
      };
    },
    async close() {
      await deps.store.close?.();
    },
  };
}

export interface DatabaseKbIngestionServiceOptions {
  /**
   * The shared production embedder (Milestone 15): the SAME instance must be
   * wired into retrieval so chunk and query vectors share an embedding space.
   * Defaults to the deterministic embedder.
   */
  readonly embedder?: Embedder;
}

/**
 * Default production KB ingestion service: a lazily-connected PostgreSQL store,
 * a filesystem content store, and the supplied (default deterministic)
 * embedder. Constructing this opens no connections; the database connects on
 * the first write.
 */
export function createDatabaseKbIngestionService(
  options: DatabaseKbIngestionServiceOptions = {},
): KbIngestionService {
  return createKbIngestionService({
    store: createDatabaseKbIngestionStore(),
    contentStore: createFilesystemKbContentStore(),
    ...(options.embedder ? { embedder: options.embedder } : {}),
  });
}
