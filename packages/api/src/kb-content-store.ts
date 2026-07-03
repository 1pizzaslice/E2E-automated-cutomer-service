import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Stores raw KB document content by reference, keyed by tenant + document id.
 * The full document body is kept out of PostgreSQL (the DB holds only metadata
 * and a `content_hash`); the ingestion pipeline reads the body back from this
 * store to chunk and embed it. Implementations are tenant-scoped by key, so a
 * read for one tenant can never return another tenant's content.
 */
export interface KbContentStore {
  put(params: {
    readonly tenantId: string;
    readonly kbDocumentId: string;
    readonly content: string;
  }): Promise<void>;
  get(params: {
    readonly tenantId: string;
    readonly kbDocumentId: string;
  }): Promise<string | null>;
}

export interface FilesystemKbContentStoreOptions {
  readonly baseDir?: string;
}

const DEFAULT_BASE_DIR = ".data/kb-content";

function contentPath(
  baseDir: string,
  tenantId: string,
  kbDocumentId: string,
): string {
  return join(baseDir, tenantId, `${kbDocumentId}.txt`);
}

/**
 * Filesystem-backed KB content store for local/dev and integration
 * environments. Production swaps this for an object store (for example S3)
 * behind the same interface; the storage layout is an implementation detail.
 */
export function createFilesystemKbContentStore(
  options: FilesystemKbContentStoreOptions = {},
): KbContentStore {
  const baseDir = resolve(
    options.baseDir ?? process.env.KB_CONTENT_STORE_DIR ?? DEFAULT_BASE_DIR,
  );

  return {
    async put({ tenantId, kbDocumentId, content }) {
      const directory = join(baseDir, tenantId);
      await mkdir(directory, { recursive: true });
      await writeFile(contentPath(baseDir, tenantId, kbDocumentId), content, {
        encoding: "utf8",
      });
    },
    async get({ tenantId, kbDocumentId }) {
      try {
        return await readFile(
          contentPath(baseDir, tenantId, kbDocumentId),
          "utf8",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }

        throw error;
      }
    },
  };
}

/**
 * In-memory KB content store for unit tests. Keys content by tenant + document
 * id so tenant isolation is preserved exactly as in the filesystem store.
 */
export function createInMemoryKbContentStore(): KbContentStore & {
  readonly entries: Map<string, string>;
} {
  const entries = new Map<string, string>();
  const key = (tenantId: string, kbDocumentId: string): string =>
    `${tenantId}::${kbDocumentId}`;

  return {
    entries,
    async put({ tenantId, kbDocumentId, content }) {
      entries.set(key(tenantId, kbDocumentId), content);
    },
    async get({ tenantId, kbDocumentId }) {
      return entries.get(key(tenantId, kbDocumentId)) ?? null;
    },
  };
}
