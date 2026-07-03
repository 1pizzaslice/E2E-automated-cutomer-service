import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  createDeterministicEmbedder,
} from "./embedder.js";

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

describe("createDeterministicEmbedder", () => {
  it("produces vectors of the configured dimensionality", async () => {
    const embedder = createDeterministicEmbedder();
    const vector = (await embedder.embed(["shipping policy"]))[0]!;

    expect(embedder.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("is deterministic for identical input", async () => {
    const embedder = createDeterministicEmbedder({ dimensions: 64 });

    const first = (await embedder.embed(["refund within 30 days"]))[0]!;
    const second = (await embedder.embed(["refund within 30 days"]))[0]!;

    expect(first).toEqual(second);
  });

  it("returns unit vectors so dot product is cosine similarity", async () => {
    const embedder = createDeterministicEmbedder({ dimensions: 128 });
    const vector = (
      await embedder.embed(["cancellation eligibility rules"])
    )[0]!;

    expect(dot(vector, vector)).toBeCloseTo(1, 6);
  });

  it("scores shared-token texts higher than unrelated texts", async () => {
    const embedder = createDeterministicEmbedder({ dimensions: 256 });
    const vectors = await embedder.embed([
      "how do I request a refund for my order",
      "refunds for an order are issued to the original payment method",
      "our office is closed on public holidays",
    ]);
    const query = vectors[0]!;
    const related = vectors[1]!;
    const unrelated = vectors[2]!;

    expect(dot(query, related)).toBeGreaterThan(dot(query, unrelated));
  });

  it("preserves batch order", async () => {
    const embedder = createDeterministicEmbedder({ dimensions: 32 });
    const batch = await embedder.embed(["alpha", "beta"]);
    const alpha = (await embedder.embed(["alpha"]))[0]!;
    const beta = (await embedder.embed(["beta"]))[0]!;

    expect(batch[0]).toEqual(alpha);
    expect(batch[1]).toEqual(beta);
  });

  it("returns a zero vector for token-less input", async () => {
    const embedder = createDeterministicEmbedder({ dimensions: 16 });
    const vector = (await embedder.embed(["   --- +++   "]))[0]!;

    expect(vector.every((value) => value === 0)).toBe(true);
  });

  it("rejects invalid dimensions", () => {
    expect(() => createDeterministicEmbedder({ dimensions: 0 })).toThrow();
    expect(() => createDeterministicEmbedder({ dimensions: 1.5 })).toThrow();
  });
});
