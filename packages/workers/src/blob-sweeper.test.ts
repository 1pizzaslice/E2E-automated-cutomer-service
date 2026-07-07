import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFilesystemBlobSweeper,
  createRecordingBlobSweeper,
} from "./blob-sweeper.js";

describe("createFilesystemBlobSweeper", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "blob-sweeper-test-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("deletes file refs under the base directory", async () => {
    const directory = join(baseDir, "ten_a", "chan_a");
    await mkdir(directory, { recursive: true });
    const filePath = join(directory, "payload.json");
    await writeFile(filePath, "{}");

    const sweeper = createFilesystemBlobSweeper({ baseDir });
    const result = await sweeper.sweep([`file://${filePath}`]);

    expect(result.swept).toEqual([`file://${filePath}`]);
    expect(result.failed).toEqual([]);
    await expect(access(filePath)).rejects.toThrow();
  });

  it("treats an already missing blob as swept (idempotent re-run)", async () => {
    const missing = join(baseDir, "ten_a", "gone.json");

    const sweeper = createFilesystemBlobSweeper({ baseDir });
    const result = await sweeper.sweep([`file://${missing}`]);

    expect(result.swept).toEqual([`file://${missing}`]);
    expect(result.failed).toEqual([]);
  });

  it("fails closed on refs outside the base directory", async () => {
    const outside = await mkdtemp(join(tmpdir(), "blob-sweeper-outside-"));
    const filePath = join(outside, "not-yours.json");
    await writeFile(filePath, "{}");

    try {
      const sweeper = createFilesystemBlobSweeper({ baseDir });
      const result = await sweeper.sweep([`file://${filePath}`]);

      expect(result.swept).toEqual([]);
      expect(result.failed).toEqual([
        { ref: `file://${filePath}`, reason: "outside_base_dir" },
      ]);
      // The blob is untouched.
      await expect(access(filePath)).resolves.toBeUndefined();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("fails closed on path traversal inside a file ref", async () => {
    const outside = await mkdtemp(join(tmpdir(), "blob-sweeper-traverse-"));
    const filePath = join(outside, "escape.json");
    await writeFile(filePath, "{}");

    try {
      const sweeper = createFilesystemBlobSweeper({ baseDir });
      const traversal = `file://${baseDir}/../${outside.split("/").at(-1)}/escape.json`;
      const result = await sweeper.sweep([traversal]);

      expect(result.swept).toEqual([]);
      expect(result.failed).toEqual([
        { ref: traversal, reason: "outside_base_dir" },
      ]);
      await expect(access(filePath)).resolves.toBeUndefined();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("fails closed on foreign ref schemes", async () => {
    const sweeper = createFilesystemBlobSweeper({ baseDir });
    const result = await sweeper.sweep([
      "memory://ten_a/chan_a/1",
      "whatsapp-media:12345",
      "s3://bucket/key.json",
    ]);

    expect(result.swept).toEqual([]);
    expect(result.failed).toEqual([
      { ref: "memory://ten_a/chan_a/1", reason: "unsupported_ref_scheme" },
      { ref: "whatsapp-media:12345", reason: "unsupported_ref_scheme" },
      { ref: "s3://bucket/key.json", reason: "unsupported_ref_scheme" },
    ]);
  });

  it("reports partial outcomes for mixed batches", async () => {
    const directory = join(baseDir, "ten_a", "chan_a");
    await mkdir(directory, { recursive: true });
    const filePath = join(directory, "payload.json");
    await writeFile(filePath, "{}");

    const sweeper = createFilesystemBlobSweeper({ baseDir });
    const result = await sweeper.sweep([
      `file://${filePath}`,
      "memory://ten_a/chan_a/1",
    ]);

    expect(result.swept).toEqual([`file://${filePath}`]);
    expect(result.failed).toEqual([
      { ref: "memory://ten_a/chan_a/1", reason: "unsupported_ref_scheme" },
    ]);
  });
});

describe("createRecordingBlobSweeper", () => {
  it("sweeps everything by default and records the refs", async () => {
    const sweeper = createRecordingBlobSweeper();
    const result = await sweeper.sweep(["file://a", "file://b"]);

    expect(result.swept).toEqual(["file://a", "file://b"]);
    expect(result.failed).toEqual([]);
    expect(sweeper.sweptRefs).toEqual(["file://a", "file://b"]);
  });

  it("fails the configured refs", async () => {
    const sweeper = createRecordingBlobSweeper({
      failRefs: new Set(["file://b"]),
    });
    const result = await sweeper.sweep(["file://a", "file://b"]);

    expect(result.swept).toEqual(["file://a"]);
    expect(result.failed).toEqual([
      { ref: "file://b", reason: "sweep_failed" },
    ]);
  });
});
