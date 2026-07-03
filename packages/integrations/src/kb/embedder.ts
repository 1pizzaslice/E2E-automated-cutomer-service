/**
 * Embedding pipeline port plus a deterministic local implementation.
 *
 * The v1 KB embedding column is `vector(1536)` (see BACKEND_SPEC §20 notes). A
 * real embedding model is a network dependency that is non-deterministic across
 * versions and unavailable in unit/CI runs, so retrieval is built against an
 * `Embedder` port. Production wires a hosted-model implementation behind this
 * same interface; tests and local ingestion use the deterministic embedder
 * below, which maps text to a stable unit vector so cosine similarity is
 * meaningful (documents sharing tokens score higher) without any I/O.
 */

export const EMBEDDING_DIMENSIONS = 1536;

export interface Embedder {
  /** Vector dimensionality; must match the `kb_chunks.embedding` column. */
  readonly dimensions: number;
  /** Embed a batch of texts, preserving input order. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface DeterministicEmbedderOptions {
  readonly dimensions?: number;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a hash. Deterministic and dependency-free. */
function fnv1a(token: string): number {
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  // Coerce to an unsigned 32-bit integer.
  return hash >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Deterministic bag-of-tokens embedder. Each token is hashed into a bucket and
 * contributes a signed weight (a second hash bit picks the sign, spreading mass
 * across the vector). The resulting vector is L2-normalized so dot product
 * equals cosine similarity. Empty/token-less input yields a zero vector.
 */
export function createDeterministicEmbedder(
  options: DeterministicEmbedderOptions = {},
): Embedder {
  const dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("embedder dimensions must be a positive integer");
  }

  function embedOne(text: string): number[] {
    const vector = new Array<number>(dimensions).fill(0);

    for (const token of tokenize(text)) {
      const hash = fnv1a(token);
      const bucket = hash % dimensions;
      const sign = (hash & 0x100) === 0 ? 1 : -1;
      vector[bucket] = (vector[bucket] ?? 0) + sign;
    }

    let magnitude = 0;
    for (const value of vector) {
      magnitude += value * value;
    }
    magnitude = Math.sqrt(magnitude);

    if (magnitude === 0) {
      return vector;
    }

    for (let index = 0; index < dimensions; index += 1) {
      vector[index] = (vector[index] ?? 0) / magnitude;
    }

    return vector;
  }

  return {
    dimensions,
    async embed(texts) {
      return texts.map((text) => embedOne(text));
    },
  };
}
