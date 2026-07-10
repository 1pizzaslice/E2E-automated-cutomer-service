import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Redis } from "ioredis";

/**
 * Basic per-principal rate limiting on authenticated endpoints (Milestone 20).
 * This is the platform's first production use of the Redis service: when a
 * `REDIS_URL` is configured the counters live in Redis so the limit holds
 * across every API replica; without it the limiter falls back to an in-process
 * store (single-instance dev only).
 *
 * Rate limiting is OFF by default and enabled explicitly per deployment
 * (`SUPPORT_RATE_LIMIT_ENABLED=true`), mirroring CORS — the offline test suites
 * fire many requests as one principal and must not trip a limiter.
 */
export interface RateLimitConfig {
  /** Max requests per principal per window. */
  readonly max: number;
  /** Sliding window length in milliseconds. */
  readonly windowMs: number;
  /**
   * Redis connection URL for the shared counter store. When absent the limiter
   * uses an in-process store (correct only for a single instance).
   */
  readonly redisUrl?: string;
}

export const RATE_LIMIT_ENABLED_ENV = "SUPPORT_RATE_LIMIT_ENABLED";
export const RATE_LIMIT_MAX_ENV = "SUPPORT_RATE_LIMIT_MAX";
export const RATE_LIMIT_WINDOW_MS_ENV = "SUPPORT_RATE_LIMIT_WINDOW_MS";
export const REDIS_URL_ENV = "REDIS_URL";

const DEFAULT_MAX = 300;
const DEFAULT_WINDOW_MS = 60_000;

const HEALTH_PATHS = new Set(["/health", "/ready"]);
const WEBHOOK_PATH_PREFIX = "/v1/webhooks/";

/**
 * Loads the rate-limit config from the environment. Returns `undefined` when
 * disabled (the default) so the caller skips registration. A configured but
 * non-numeric / non-positive limit is a deployment error and fails fast rather
 * than silently reverting to a default.
 */
export function loadRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): RateLimitConfig | undefined {
  if (env[RATE_LIMIT_ENABLED_ENV] !== "true") {
    return undefined;
  }

  const max = readPositiveInt(env, RATE_LIMIT_MAX_ENV, DEFAULT_MAX);
  const windowMs = readPositiveInt(
    env,
    RATE_LIMIT_WINDOW_MS_ENV,
    DEFAULT_WINDOW_MS,
  );
  const redisUrl = env[REDIS_URL_ENV];

  return {
    max,
    windowMs,
    ...(redisUrl ? { redisUrl } : {}),
  };
}

/**
 * Registers global rate limiting. Health/readiness probes and provider
 * webhooks are exempt: probes must never be throttled, and webhooks are
 * high-volume, signature-authenticated, and arrive from a small set of
 * provider IPs that per-IP limiting would wrongly starve.
 */
export function registerRateLimit(
  app: FastifyInstance,
  config: RateLimitConfig,
): void {
  const redis = config.redisUrl
    ? new Redis(config.redisUrl, {
        // Fail open on a Redis outage: @fastify/rate-limit skips limiting on a
        // store error rather than blocking, and these options make that error
        // fast instead of hanging the request.
        connectTimeout: 500,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
      })
    : undefined;

  if (redis) {
    // lazyConnect defers the socket until first use; surface connection errors
    // as logs instead of unhandled rejections.
    redis.on("error", (error: unknown) => {
      app.log.warn({ err: error }, "rate-limit redis store error");
    });
    void redis.connect().catch((error: unknown) => {
      app.log.warn({ err: error }, "rate-limit redis connect failed");
    });
  }

  app.register(fastifyRateLimit, {
    global: true,
    max: config.max,
    timeWindow: config.windowMs,
    ...(redis ? { redis } : {}),
    keyGenerator: rateLimitKey,
    allowList: (request) => isRateLimitExempt(request),
  });

  if (redis) {
    app.addHook("onClose", async () => {
      redis.disconnect();
    });
  }
}

/**
 * Limits by authenticated principal so a single reviewer's burst cannot starve
 * others behind a shared NAT, falling back to the client IP for requests that
 * reach the limiter unauthenticated.
 */
function rateLimitKey(request: FastifyRequest): string {
  const userId = request.requestContext?.actor?.userId;

  return userId ? `user:${userId}` : `ip:${request.ip}`;
}

function isRateLimitExempt(request: FastifyRequest): boolean {
  const path = getPathname(request.url);

  return HEALTH_PATHS.has(path) || path.startsWith(WEBHOOK_PATH_PREFIX);
}

function readPositiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];

  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer; got "${raw}".`);
  }

  return parsed;
}

function getPathname(url: string): string {
  return new URL(url, "http://localhost").pathname;
}
