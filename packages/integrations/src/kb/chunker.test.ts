import { describe, expect, it } from "vitest";
import { chunkDocument } from "./chunker.js";

describe("chunkDocument", () => {
  it("returns no chunks for blank content", () => {
    expect(chunkDocument("")).toEqual([]);
    expect(chunkDocument("   \n\n  \t ")).toEqual([]);
  });

  it("returns a single chunk for short content", () => {
    const chunks = chunkDocument("Refunds are processed within 5 days.");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      chunkIndex: 0,
      content: "Refunds are processed within 5 days.",
    });
  });

  it("packs multiple paragraphs into one chunk under the limit", () => {
    const chunks = chunkDocument("First paragraph.\n\nSecond paragraph.", {
      maxChars: 100,
      overlapChars: 0,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("splits content that exceeds the window into ordered chunks", () => {
    const paragraph = "sentence ".repeat(40).trim();
    const content = `${paragraph}\n\n${paragraph}`;

    const chunks = chunkDocument(content, { maxChars: 120, overlapChars: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, index) => {
      expect(chunk.chunkIndex).toBe(index);
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.content.length).toBeLessThanOrEqual(120);
    });
  });

  it("hard-wraps a single oversize paragraph with no paragraph breaks", () => {
    const content = "word ".repeat(200).trim();

    const chunks = chunkDocument(content, { maxChars: 100, overlapChars: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(100);
    }
  });

  it("is deterministic across repeated runs", () => {
    const content = "alpha beta gamma. ".repeat(60);

    const first = chunkDocument(content, { maxChars: 90, overlapChars: 15 });
    const second = chunkDocument(content, { maxChars: 90, overlapChars: 15 });

    expect(first).toEqual(second);
  });

  it("rejects invalid options", () => {
    expect(() => chunkDocument("x", { maxChars: 0 })).toThrow();
    expect(() =>
      chunkDocument("x", { maxChars: 10, overlapChars: 10 }),
    ).toThrow();
  });
});
