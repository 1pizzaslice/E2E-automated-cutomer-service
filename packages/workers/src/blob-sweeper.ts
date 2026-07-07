import { unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Blob sweeper for content stored by reference (Milestone 17, BACKEND_SPEC
 * section 22). The retention job hands it the refs it is about to purge from
 * the database (raw payload refs, locally stored attachment refs); the
 * sweeper deletes the underlying blobs and reports per-ref outcomes so the
 * job can fail closed — a ref whose blob could not be deleted keeps its
 * database row untouched and is retried on the next run.
 *
 * The filesystem implementation matches the `file://` refs written by the
 * API's filesystem raw-payload store. A production object-store sweeper
 * (S3/MinIO) lands behind the same port with Milestone 18's hardened
 * deployment; unknown ref schemes always fail closed.
 */

export interface BlobSweepFailure {
  readonly ref: string;
  readonly reason: string;
}

export interface BlobSweepResult {
  /** Refs whose blobs are gone (deleted now, or already absent). */
  readonly swept: readonly string[];
  /** Refs that must not be purged from the database this run. */
  readonly failed: readonly BlobSweepFailure[];
}

export interface BlobSweeper {
  sweep(refs: readonly string[]): Promise<BlobSweepResult>;
}

export interface FilesystemBlobSweeperOptions {
  /**
   * The only directory tree the sweeper may delete from; refs resolving
   * outside it fail closed. Defaults to the filesystem raw-payload store's
   * base directory (`RAW_PAYLOAD_STORE_DIR`, falling back to
   * `.data/raw-payloads`).
   */
  readonly baseDir?: string;
}

const DEFAULT_BASE_DIR = ".data/raw-payloads";

/**
 * Deletes `file://` blobs under a single allowed base directory. An already
 * missing file counts as swept so retention re-runs stay idempotent; every
 * other outcome (foreign scheme, path outside the base directory, filesystem
 * error) is a per-ref failure the caller must treat as "do not purge".
 */
export function createFilesystemBlobSweeper(
  options: FilesystemBlobSweeperOptions = {},
): BlobSweeper {
  const baseDir = resolve(
    options.baseDir ?? process.env.RAW_PAYLOAD_STORE_DIR ?? DEFAULT_BASE_DIR,
  );

  return {
    async sweep(refs) {
      const swept: string[] = [];
      const failed: BlobSweepFailure[] = [];

      for (const ref of refs) {
        if (!ref.startsWith("file://")) {
          failed.push({ ref, reason: "unsupported_ref_scheme" });
          continue;
        }

        let filePath: string;

        try {
          filePath = resolve(fileURLToPath(new URL(ref)));
        } catch {
          failed.push({ ref, reason: "invalid_file_ref" });
          continue;
        }

        if (filePath !== baseDir && !filePath.startsWith(`${baseDir}${sep}`)) {
          failed.push({ ref, reason: "outside_base_dir" });
          continue;
        }

        try {
          await unlink(filePath);
          swept.push(ref);
        } catch (error) {
          if (isErrnoException(error) && error.code === "ENOENT") {
            // Already gone: a previous run deleted the blob before the
            // database purge landed. Idempotent success.
            swept.push(ref);
            continue;
          }

          failed.push({
            ref,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return { swept, failed };
    },
  };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export interface RecordingBlobSweeper extends BlobSweeper {
  /** Every ref passed to `sweep`, in call order. */
  readonly sweptRefs: string[];
}

/**
 * Test double: sweeps everything except the configured failures and records
 * the refs it was asked to delete.
 */
export function createRecordingBlobSweeper(options?: {
  readonly failRefs?: ReadonlySet<string>;
  readonly failReason?: string;
}): RecordingBlobSweeper {
  const sweptRefs: string[] = [];
  const failRefs = options?.failRefs ?? new Set<string>();
  const failReason = options?.failReason ?? "sweep_failed";

  return {
    sweptRefs,
    async sweep(refs) {
      const swept: string[] = [];
      const failed: BlobSweepFailure[] = [];

      for (const ref of refs) {
        if (failRefs.has(ref)) {
          failed.push({ ref, reason: failReason });
          continue;
        }

        sweptRefs.push(ref);
        swept.push(ref);
      }

      return { swept, failed };
    },
  };
}
