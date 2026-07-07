/**
 * OpenAI embeddings behind the `Embedder` port (Milestone 15, ADR-0020).
 *
 * The pilot default embedding model is `text-embedding-3-small`; the platform
 * standard embedding space is `vector(1536)` (ADR-0014), so only models that
 * can produce 1536-dimensional vectors are accepted. `text-embedding-3-*`
 * models take an explicit `dimensions` parameter; `text-embedding-ada-002` is
 * natively 1536-dimensional and rejects the parameter, so it is omitted there.
 *
 * The client is a plain `fetch` call (injectable for tests) with bounded
 * retries on 429/5xx/transport failures. Vectors come back order-preserving
 * (re-sorted by the response `index` defensively) and are validated to the
 * expected dimensionality — a wrong-sized vector is a hard error, never a
 * silently truncated write.
 */

export const OPENAI_EMBEDDING_BASE_URL = "https://api.openai.com/v1";

export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * OpenAI models capable of producing the platform's 1536-dim vectors, mapped
 * to whether the request must carry an explicit `dimensions` parameter.
 */
export const OPENAI_EMBEDDING_MODELS: Readonly<Record<string, boolean>> = {
  "text-embedding-3-small": true,
  "text-embedding-3-large": true,
  "text-embedding-ada-002": false,
};

import { EMBEDDING_DIMENSIONS, type Embedder } from "./embedder.js";

export interface OpenAiEmbedderOptions {
  readonly apiKey: string;
  /** Must be a key of `OPENAI_EMBEDDING_MODELS`. */
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Total attempts for transient failures (429/5xx/transport). */
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

interface OpenAiEmbeddingItem {
  readonly index: number;
  readonly embedding: number[];
}

export function createOpenAiEmbedder(options: OpenAiEmbedderOptions): Embedder {
  const model = options.model ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
  const needsDimensionsParam = OPENAI_EMBEDDING_MODELS[model];

  if (needsDimensionsParam === undefined) {
    throw new Error(
      `Unsupported OpenAI embedding model "${model}": the platform embedding space is ` +
        `vector(${EMBEDDING_DIMENSIONS}) and only ${Object.keys(OPENAI_EMBEDDING_MODELS).join(", ")} ` +
        "are known to produce it.",
    );
  }

  const baseUrl = (options.baseUrl ?? OPENAI_EMBEDDING_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function requestEmbeddings(
    texts: readonly string[],
  ): Promise<number[][]> {
    const body = JSON.stringify({
      model,
      input: texts,
      encoding_format: "float",
      ...(needsDimensionsParam ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
    });

    let lastFailure = "no attempt made";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        await sleep(retryDelayMs * 2 ** (attempt - 2));
      }

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastFailure = `transport failure: ${error instanceof Error ? error.message : String(error)}`;
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        lastFailure = `HTTP ${response.status}`;
        continue;
      }

      if (!response.ok) {
        // 4xx other than 429 is permanent (bad key, bad model, bad request).
        throw new Error(
          `OpenAI embeddings request failed permanently with HTTP ${response.status}.`,
        );
      }

      const payload = (await response.json()) as {
        data?: OpenAiEmbeddingItem[];
      };
      const items = payload.data;

      if (!Array.isArray(items) || items.length !== texts.length) {
        throw new Error(
          `OpenAI embeddings response is malformed: expected ${texts.length} vectors, ` +
            `got ${Array.isArray(items) ? items.length : "none"}.`,
        );
      }

      const ordered = [...items].sort(
        (left, right) => left.index - right.index,
      );

      return ordered.map((item) => {
        if (
          !Array.isArray(item.embedding) ||
          item.embedding.length !== EMBEDDING_DIMENSIONS
        ) {
          throw new Error(
            `OpenAI embeddings response vector has ${item.embedding?.length ?? 0} dimensions; ` +
              `the platform requires exactly ${EMBEDDING_DIMENSIONS}.`,
          );
        }

        return item.embedding;
      });
    }

    throw new Error(
      `OpenAI embeddings request failed after ${maxAttempts} attempts (${lastFailure}).`,
    );
  }

  return {
    modelId: `openai:${model}`,
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts) {
      if (texts.length === 0) {
        return [];
      }

      return requestEmbeddings(texts);
    },
  };
}
