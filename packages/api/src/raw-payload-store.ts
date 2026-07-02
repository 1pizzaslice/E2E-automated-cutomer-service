import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

/**
 * Parameters for storing a raw inbound provider payload before it is parsed by
 * a channel adapter. The raw bytes are the exact request body the provider
 * sent, so they remain available for reprocessing, audit, and signature
 * forensics after normalization.
 */
export interface RawPayloadPutParams {
  readonly tenantId: string;
  readonly channelId: string;
  readonly provider: string;
  readonly channelType: "email" | "whatsapp";
  readonly contentType: string | null;
  readonly body: Buffer;
}

export interface RawPayloadPutResult {
  readonly ref: string;
}

/**
 * Stores raw inbound provider payloads by reference. Implementations return an
 * opaque `ref` that is persisted on the normalized message (`raw_payload_ref`);
 * the bytes themselves live in the store, never inline in the database.
 */
export interface RawPayloadStore {
  put(params: RawPayloadPutParams): Promise<RawPayloadPutResult>;
}

export interface FilesystemRawPayloadStoreOptions {
  readonly baseDir?: string;
}

const DEFAULT_BASE_DIR = ".data/raw-payloads";

/**
 * Filesystem-backed raw payload store used for local/dev and integration
 * environments. It writes each payload under
 * `${baseDir}/${tenant}/${channel}/${uuid}.json` and returns a `file://` ref.
 * Production deployments swap this for an object-store implementation (for
 * example S3) behind the same interface; the ref scheme is opaque to callers.
 */
export function createFilesystemRawPayloadStore(
  options: FilesystemRawPayloadStoreOptions = {},
): RawPayloadStore {
  const baseDir = resolve(
    options.baseDir ?? process.env.RAW_PAYLOAD_STORE_DIR ?? DEFAULT_BASE_DIR,
  );

  return {
    async put(params) {
      const directory = join(baseDir, params.tenantId, params.channelId);
      await mkdir(directory, { recursive: true });

      const filePath = join(directory, `${randomUUID()}.json`);
      await writeFile(filePath, params.body);

      return { ref: `file://${filePath}` };
    },
  };
}

/**
 * In-memory raw payload store for tests. Retains payloads keyed by ref so tests
 * can assert the exact bytes stored by reference.
 */
export function createInMemoryRawPayloadStore(): RawPayloadStore & {
  readonly entries: Map<string, RawPayloadPutParams>;
} {
  const entries = new Map<string, RawPayloadPutParams>();
  let counter = 0;

  return {
    entries,
    async put(params) {
      counter += 1;
      const ref = `memory://${params.tenantId}/${params.channelId}/${counter}`;
      entries.set(ref, params);
      return { ref };
    },
  };
}
