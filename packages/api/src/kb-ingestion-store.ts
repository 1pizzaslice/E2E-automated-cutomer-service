import {
  createDatabaseFromEnv,
  createKbDocumentQuery,
  deleteKbChunksForDocumentQuery,
  insertKbChunksQuery,
  kbDocumentByIdQuery,
  updateKbDocumentByIdQuery,
  withTenantTransaction,
  type JsonObject,
  type KbDocument,
  type NewKbDocument,
  type PostgresClient,
} from "@support/db";

/** Fields required to create a KB document row (tenant is supplied by scope). */
export type KbDocumentCreateValues = Omit<NewKbDocument, "tenantId">;

/** Partial KB document update; `updatedAt` is managed by the store. */
export type KbDocumentUpdateValues = Partial<
  Pick<
    NewKbDocument,
    "title" | "sourceRef" | "documentType" | "status" | "version"
  >
>;

export interface KbChunkInsert {
  readonly kbChunkId: string;
  readonly kbDocumentId: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly embedding: number[];
  readonly metadata: JsonObject;
  readonly status: KbDocument["status"];
}

/**
 * Persistence boundary for KB ingestion. The DB implementation runs every write
 * under `withTenantTransaction` (row-level security enforces the tenant filter);
 * the in-memory implementation mirrors the same tenant-scoped semantics for unit
 * tests. Chunk replacement is atomic: prior chunks are deleted and the fresh set
 * inserted in one transaction so retrieval never observes a half-ingested state.
 */
export interface KbIngestionStore {
  createDocument(
    tenantId: string,
    values: KbDocumentCreateValues,
  ): Promise<KbDocument>;
  getDocumentById(
    tenantId: string,
    kbDocumentId: string,
  ): Promise<KbDocument | null>;
  updateDocument(
    tenantId: string,
    kbDocumentId: string,
    values: KbDocumentUpdateValues,
  ): Promise<KbDocument | null>;
  replaceChunks(
    tenantId: string,
    kbDocumentId: string,
    chunks: readonly KbChunkInsert[],
  ): Promise<number>;
  close?(): Promise<void>;
}

export function createDatabaseKbIngestionStore(
  database?: ReturnType<typeof createDatabaseFromEnv>,
): KbIngestionStore {
  let handle = database;

  function getClient(): PostgresClient {
    if (!handle) {
      handle = createDatabaseFromEnv();
    }

    return handle.client;
  }

  return {
    async createDocument(tenantId, values) {
      return withTenantTransaction(
        getClient(),
        { tenantId },
        async (scoped) => {
          const [document] = await createKbDocumentQuery(
            scoped,
            { tenantId },
            values,
          );

          return document as KbDocument;
        },
      );
    },
    async getDocumentById(tenantId, kbDocumentId) {
      return withTenantTransaction(
        getClient(),
        { tenantId },
        async (scoped) => {
          const [document] = await kbDocumentByIdQuery(
            scoped,
            { tenantId },
            kbDocumentId,
          );

          return document ?? null;
        },
      );
    },
    async updateDocument(tenantId, kbDocumentId, values) {
      return withTenantTransaction(
        getClient(),
        { tenantId },
        async (scoped) => {
          const [document] = await updateKbDocumentByIdQuery(
            scoped,
            { tenantId },
            kbDocumentId,
            { ...values, updatedAt: new Date() },
          );

          return document ?? null;
        },
      );
    },
    async replaceChunks(tenantId, kbDocumentId, chunks) {
      return withTenantTransaction(
        getClient(),
        { tenantId },
        async (scoped) => {
          await deleteKbChunksForDocumentQuery(
            scoped,
            { tenantId },
            kbDocumentId,
          );

          if (chunks.length === 0) {
            return 0;
          }

          const inserted = await insertKbChunksQuery(
            scoped,
            { tenantId },
            chunks.map((chunk) => ({
              kbChunkId: chunk.kbChunkId,
              kbDocumentId: chunk.kbDocumentId,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              embedding: chunk.embedding,
              metadata: chunk.metadata,
              status: chunk.status,
            })),
          );

          return inserted.length;
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

interface InMemoryChunkRecord extends KbChunkInsert {
  readonly tenantId: string;
  readonly createdAt: Date;
}

/**
 * In-memory KB ingestion store for unit tests. Documents and chunks are keyed by
 * tenant so cross-tenant reads are impossible, matching the RLS guarantee of the
 * database store.
 */
export function createInMemoryKbIngestionStore(): KbIngestionStore & {
  readonly documents: Map<string, KbDocument>;
  readonly chunks: InMemoryChunkRecord[];
} {
  const documents = new Map<string, KbDocument>();
  const chunks: InMemoryChunkRecord[] = [];
  const key = (tenantId: string, kbDocumentId: string): string =>
    `${tenantId}::${kbDocumentId}`;

  return {
    documents,
    chunks,
    async createDocument(tenantId, values) {
      const now = new Date();
      const document: KbDocument = {
        kbDocumentId: values.kbDocumentId,
        tenantId,
        title: values.title,
        sourceType: values.sourceType,
        sourceRef: values.sourceRef ?? null,
        documentType: values.documentType,
        status: values.status ?? "draft",
        version: values.version ?? 1,
        contentHash: values.contentHash,
        createdByUserId: values.createdByUserId ?? null,
        createdAt: values.createdAt ?? now,
        updatedAt: values.updatedAt ?? now,
      };

      documents.set(key(tenantId, values.kbDocumentId), document);
      return document;
    },
    async getDocumentById(tenantId, kbDocumentId) {
      return documents.get(key(tenantId, kbDocumentId)) ?? null;
    },
    async updateDocument(tenantId, kbDocumentId, values) {
      const existing = documents.get(key(tenantId, kbDocumentId));

      if (!existing) {
        return null;
      }

      const updated: KbDocument = {
        ...existing,
        title: values.title ?? existing.title,
        sourceRef:
          values.sourceRef === undefined
            ? existing.sourceRef
            : values.sourceRef,
        documentType: values.documentType ?? existing.documentType,
        status: values.status ?? existing.status,
        version: values.version ?? existing.version,
        updatedAt: new Date(),
      };

      documents.set(key(tenantId, kbDocumentId), updated);
      return updated;
    },
    async replaceChunks(tenantId, kbDocumentId, next) {
      for (let index = chunks.length - 1; index >= 0; index -= 1) {
        const chunk = chunks[index];
        if (
          chunk &&
          chunk.tenantId === tenantId &&
          chunk.kbDocumentId === kbDocumentId
        ) {
          chunks.splice(index, 1);
        }
      }

      const createdAt = new Date();
      for (const chunk of next) {
        chunks.push({ ...chunk, tenantId, createdAt });
      }

      return next.length;
    },
  };
}
