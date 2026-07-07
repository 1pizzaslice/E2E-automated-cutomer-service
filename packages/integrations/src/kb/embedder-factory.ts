/**
 * Env-selected production `Embedder` factory (Milestone 15, ADR-0020).
 *
 * `SUPPORT_EMBEDDING_PROVIDER` selects the implementation:
 *
 * - unset or `deterministic` — the offline deterministic embedder (the test
 *   and local default; real embeddings activate only by explicit config);
 * - `openai` — `createOpenAiEmbedder` with `SUPPORT_EMBEDDING_MODEL`
 *   (pilot default `text-embedding-3-small`; only 1536-dim-capable models
 *   are accepted) and the API key resolved from `SUPPORT_EMBEDDING_API_KEY_REF`
 *   (default ref `OPENAI_API_KEY`, SecretResolver conventions).
 *
 * One factory-built instance must be shared by KB ingestion AND retrieval so
 * query and chunk vectors live in the same embedding space (ADR-0014); the
 * API composition (`createDatabaseApiServices`) does exactly that. Switching
 * embedding providers changes the space, so it requires re-ingesting every
 * KB document — retrieval enforces the recorded model id at query time and
 * fails closed on a mismatch rather than returning garbage rankings.
 */

import { isValidSecretRef, SECRET_REF_PATTERN } from "../secrets.js";
import { createDeterministicEmbedder, type Embedder } from "./embedder.js";
import {
  createOpenAiEmbedder,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
} from "./embedder-openai.js";

export const DEFAULT_EMBEDDING_API_KEY_REF = "OPENAI_API_KEY";

export interface CreateEmbedderFromEnvOptions {
  readonly fetchImpl?: typeof fetch;
}

export function createEmbedderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateEmbedderFromEnvOptions = {},
): Embedder {
  const provider = (env.SUPPORT_EMBEDDING_PROVIDER ?? "").trim().toLowerCase();

  if (provider === "" || provider === "deterministic") {
    return createDeterministicEmbedder();
  }

  if (provider !== "openai") {
    throw new Error(
      `SUPPORT_EMBEDDING_PROVIDER must be "openai" or "deterministic" (got "${provider}").`,
    );
  }

  const ref =
    env.SUPPORT_EMBEDDING_API_KEY_REF ?? DEFAULT_EMBEDDING_API_KEY_REF;

  if (!isValidSecretRef(ref)) {
    throw new Error(
      `SUPPORT_EMBEDDING_API_KEY_REF must name an environment variable matching ` +
        `${SECRET_REF_PATTERN} (got "${ref}").`,
    );
  }

  const apiKey = env[ref]?.trim();

  if (!apiKey) {
    throw new Error(
      `Secret ${ref} (referenced by SUPPORT_EMBEDDING_API_KEY_REF) is required when ` +
        "SUPPORT_EMBEDDING_PROVIDER=openai but is not set.",
    );
  }

  const timeoutMs = parsePositiveInt(
    env.SUPPORT_EMBEDDING_TIMEOUT_MS,
    "SUPPORT_EMBEDDING_TIMEOUT_MS",
  );

  return createOpenAiEmbedder({
    apiKey,
    model:
      env.SUPPORT_EMBEDDING_MODEL?.trim() || DEFAULT_OPENAI_EMBEDDING_MODEL,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

function parsePositiveInt(
  raw: string | undefined,
  name: string,
): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}").`);
  }

  return value;
}
