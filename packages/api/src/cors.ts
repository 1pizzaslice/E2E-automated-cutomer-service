import fastifyCors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

/**
 * CORS support for the reviewer console (Milestone 20, ADR-0026). The console
 * runs on its own origin, so the API must opt specific origins into
 * cross-origin access. This is OFF by default: with no configured origins the
 * plugin is never registered and the browser same-origin policy applies (only
 * the API's own origin may call it from a browser). Server-to-server callers
 * are unaffected either way — CORS is a browser mechanism.
 */
export interface CorsConfig {
  /** Exact origins allowed to make cross-origin browser requests. */
  readonly allowedOrigins: readonly string[];
  /**
   * Whether to reflect credentials (cookies / TLS client certs). Bearer tokens
   * in the Authorization header do NOT require this; it defaults off and is
   * only enabled for deployments that genuinely use cookie auth.
   */
  readonly allowCredentials: boolean;
}

/** Comma-separated exact origins, e.g. `https://console.example.com`. */
export const CORS_ALLOWED_ORIGINS_ENV = "SUPPORT_CORS_ALLOWED_ORIGINS";
/** `true` reflects credentials; anything else (incl. unset) keeps them off. */
export const CORS_ALLOW_CREDENTIALS_ENV = "SUPPORT_CORS_ALLOW_CREDENTIALS";

/**
 * Request headers the console is allowed to send cross-origin. These mirror
 * what `registerRequestContext` reads (`authorization`, `x-tenant-id`, the
 * request/correlation ids) plus conditional-request headers for the
 * `updated_since`/ETag freshness contract.
 */
const ALLOWED_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "x-tenant-id",
  "x-request-id",
  "x-correlation-id",
  "if-none-match",
] as const;

/**
 * Response headers the browser is allowed to read cross-origin. The console
 * needs the correlation ids for support/debugging and `etag` for polling.
 */
const EXPOSED_RESPONSE_HEADERS = [
  "x-request-id",
  "x-correlation-id",
  "etag",
] as const;

/**
 * Loads the CORS config from the environment. Returns `undefined` when no
 * origins are configured — the caller then skips CORS registration entirely
 * (off by default). Origins are exact-match; the wildcard `*` is intentionally
 * unsupported because it cannot coexist with credentials and would defeat the
 * allowlist.
 */
export function loadCorsConfig(
  env: NodeJS.ProcessEnv = process.env,
): CorsConfig | undefined {
  const raw = env[CORS_ALLOWED_ORIGINS_ENV];

  if (!raw) {
    return undefined;
  }

  const allowedOrigins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (allowedOrigins.length === 0) {
    return undefined;
  }

  for (const origin of allowedOrigins) {
    if (origin === "*") {
      throw new Error(
        `${CORS_ALLOWED_ORIGINS_ENV} must list exact origins; the "*" ` +
          `wildcard is not allowed (it cannot be combined with credentials ` +
          `and would defeat the allowlist).`,
      );
    }
  }

  return {
    allowedOrigins,
    allowCredentials: env[CORS_ALLOW_CREDENTIALS_ENV] === "true",
  };
}

/**
 * Registers CORS with an exact-origin allowlist. A request whose `Origin` is
 * not in the list simply receives no CORS headers (the browser blocks the
 * response); the request itself is still processed and subject to auth, so
 * this is a browser guard, not an authorization mechanism.
 */
export function registerCors(app: FastifyInstance, config: CorsConfig): void {
  const allowed = new Set(config.allowedOrigins);

  app.register(fastifyCors, {
    origin: (origin, callback) => {
      // No Origin header (same-origin, curl, server-to-server): allow without
      // emitting CORS headers.
      if (!origin) {
        callback(null, false);
        return;
      }

      callback(null, allowed.has(origin));
    },
    credentials: config.allowCredentials,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [...ALLOWED_REQUEST_HEADERS],
    exposedHeaders: [...EXPOSED_RESPONSE_HEADERS],
    maxAge: 600,
  });
}
