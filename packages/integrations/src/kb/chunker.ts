/**
 * Pure, deterministic KB chunker. Given a document's raw text it produces an
 * ordered list of overlapping chunks suitable for embedding and retrieval. The
 * function has no I/O and no dependency on wall-clock time or randomness, so the
 * same input always yields the same chunks — a hard requirement for
 * reproducible ingestion, replayable workflow activities, and stable eval
 * fixtures.
 */

export interface ChunkOptions {
  /** Target maximum characters per chunk. Must be > 0. */
  readonly maxChars?: number;
  /** Characters of trailing overlap carried into the next chunk. */
  readonly overlapChars?: number;
}

export interface DocumentChunk {
  readonly chunkIndex: number;
  readonly content: string;
}

export const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = {
  maxChars: 1000,
  overlapChars: 150,
};

function resolveOptions(options: ChunkOptions): Required<ChunkOptions> {
  const maxChars = options.maxChars ?? DEFAULT_CHUNK_OPTIONS.maxChars;
  const overlapChars =
    options.overlapChars ?? DEFAULT_CHUNK_OPTIONS.overlapChars;

  if (maxChars <= 0) {
    throw new Error("chunk maxChars must be greater than 0");
  }

  if (overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error("chunk overlapChars must be >= 0 and < maxChars");
  }

  return { maxChars, overlapChars };
}

/**
 * Split on paragraph boundaries first so semantically related text stays
 * together; paragraphs longer than `maxChars` are hard-wrapped on whitespace,
 * falling back to a raw character cut when a single token exceeds the window.
 */
function splitParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function hardWrap(segment: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let remaining = segment;

  while (remaining.length > maxChars) {
    // Prefer breaking at the last whitespace inside the window so words stay
    // intact; if there is none, cut at the window boundary.
    const window = remaining.slice(0, maxChars);
    const lastBreak = window.lastIndexOf(" ");
    const cut = lastBreak > maxChars * 0.5 ? lastBreak : maxChars;

    pieces.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining.length > 0) {
    pieces.push(remaining);
  }

  return pieces;
}

/**
 * Chunk `content` into overlapping windows. Returns an empty array for
 * blank/whitespace-only input; otherwise every chunk is non-empty and indexed
 * from zero in reading order.
 */
export function chunkDocument(
  content: string,
  options: ChunkOptions = {},
): DocumentChunk[] {
  const { maxChars, overlapChars } = resolveOptions(options);
  const normalized = content.replace(/\r\n/g, "\n").trim();

  if (normalized.length === 0) {
    return [];
  }

  // Build the ordered list of sub-`maxChars` units to pack.
  const units = splitParagraphs(normalized).flatMap((paragraph) =>
    paragraph.length <= maxChars ? [paragraph] : hardWrap(paragraph, maxChars),
  );

  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    if (current.length === 0) {
      current = unit;
      continue;
    }

    if (current.length + 1 + unit.length <= maxChars) {
      current = `${current}\n\n${unit}`;
      continue;
    }

    chunks.push(current);

    if (overlapChars > 0) {
      const tail = current.slice(-overlapChars).trimStart();
      current = `${tail}\n\n${unit}`.slice(0, Math.max(unit.length, maxChars));
    } else {
      current = unit;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks.map((chunkContent, chunkIndex) => ({
    chunkIndex,
    content: chunkContent.trim(),
  }));
}
