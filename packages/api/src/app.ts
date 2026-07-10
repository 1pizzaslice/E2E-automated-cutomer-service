import Fastify, { type FastifyInstance } from "fastify";
import {
  createOtelSupportMetrics,
  type SupportMetrics,
} from "@support/observability";
import {
  createDatabaseUserDirectory,
  createJwksTokenVerifier,
  loadAuthConfig,
  type AuthConfig,
  type TokenVerifier,
  type UserDirectory,
} from "./auth.js";
import { loadCorsConfig, registerCors, type CorsConfig } from "./cors.js";
import { HttpError, registerErrorHandler } from "./errors.js";
import { createDatabaseInboundWebhookDependencies } from "./inbound-webhook-deps.js";
import {
  loadInternalAuthConfig,
  type InternalAuthConfig,
} from "./internal-auth.js";
import { registerInternalRoutes } from "./internal-routes.js";
import { registerRequestTelemetry } from "./observability.js";
import {
  registerRequestContext,
  type ResolvedAuth,
} from "./request-context.js";
import {
  loadRateLimitConfig,
  registerRateLimit,
  type RateLimitConfig,
} from "./rate-limit.js";
import { registerRoutes } from "./routes.js";
import { createDatabaseApiServices, type ApiServices } from "./services.js";
import type { ToolExecutor } from "./tool-registry.js";
import { createDatabaseToolExecutor } from "./tools/index.js";
import {
  registerWebhookRoutes,
  type InboundWebhookDependencies,
} from "./webhooks.js";

export interface BuildAppOptions {
  readonly services?: ApiServices;
  readonly webhooks?: InboundWebhookDependencies;
  /**
   * Domain metrics recorder. Defaults to the OTel-backed implementation,
   * which is a no-op unless the process started telemetry (server.ts);
   * tests inject a recording implementation.
   */
  readonly metrics?: SupportMetrics;
  /**
   * Governed tool executor behind POST /internal/tools/execute. Defaults to
   * the database-backed first-party executor; tests inject an in-memory one.
   */
  readonly toolExecutor?: ToolExecutor;
  /**
   * Internal machine-token auth. `undefined` loads the configuration from the
   * environment (loadInternalAuthConfig); `null` disables machine auth
   * explicitly. When disabled the platform fails closed: no user role holds
   * `tools:execute_internal`, so the internal route is unreachable.
   */
  readonly internalAuth?: InternalAuthConfig | null;
  /**
   * User auth mode (Milestone 16). Defaults to loading from the environment
   * (loadAuthConfig): JWT verification unless SUPPORT_AUTH_MODE explicitly
   * opts into insecure header auth. A JWT-mode boot missing issuer/audience
   * fails fast — there is no silent fallback to header trust.
   */
  readonly auth?: AuthConfig;
  /**
   * Token verifier override for tests. Ignored outside JWT mode; defaults to
   * the JWKS-backed verifier for the configured issuer.
   */
  readonly tokenVerifier?: TokenVerifier;
  /**
   * Maps verified token subjects to platform users with DB-sourced roles and
   * tenant membership. Ignored outside JWT mode; defaults to the
   * database-backed directory.
   */
  readonly userDirectory?: UserDirectory;
  /**
   * CORS config (Milestone 20). `undefined` loads from the environment (off
   * unless `SUPPORT_CORS_ALLOWED_ORIGINS` is set); `null` forces it off.
   */
  readonly cors?: CorsConfig | null;
  /**
   * Rate-limit config (Milestone 20). `undefined` loads from the environment
   * (off unless `SUPPORT_RATE_LIMIT_ENABLED=true`); `null` forces it off.
   */
  readonly rateLimit?: RateLimitConfig | null;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // DEVELOPMENT_RULES §13: structured logs carry service + environment;
      // trace/request/tenant ids are bound per request by
      // registerRequestTelemetry.
      base: {
        service: "api",
        environment:
          process.env.SUPPORT_ENVIRONMENT ?? process.env.NODE_ENV ?? "local",
      },
      redact: {
        paths: ["req.headers.authorization"],
        censor: "[REDACTED]",
      },
    },
  });
  const services = options.services ?? createDatabaseApiServices();
  const webhooks =
    options.webhooks ?? createDatabaseInboundWebhookDependencies();
  const metrics = options.metrics ?? createOtelSupportMetrics();
  const toolExecutor = options.toolExecutor ?? createDatabaseToolExecutor();
  const internalAuth =
    options.internalAuth === undefined
      ? loadInternalAuthConfig()
      : (options.internalAuth ?? undefined);
  const authConfig = options.auth ?? loadAuthConfig();
  const userDirectory =
    authConfig.mode === "jwt"
      ? (options.userDirectory ?? createDatabaseUserDirectory())
      : undefined;
  const auth: ResolvedAuth =
    authConfig.mode === "jwt"
      ? {
          mode: "jwt",
          verifier:
            options.tokenVerifier ?? createJwksTokenVerifier(authConfig),
          userDirectory: userDirectory!,
        }
      : { mode: "insecure-headers" };
  const corsConfig =
    options.cors === undefined ? loadCorsConfig() : (options.cors ?? undefined);
  const rateLimitConfig =
    options.rateLimit === undefined
      ? loadRateLimitConfig()
      : (options.rateLimit ?? undefined);

  registerRawJsonBodyParser(app);
  registerErrorHandler(app);
  // CORS runs first so a browser preflight (OPTIONS) is answered before auth.
  if (corsConfig) {
    registerCors(app, corsConfig);
  }
  registerRequestContext(app, {
    auth,
    ...(internalAuth ? { internalAuth } : {}),
  });
  registerRequestTelemetry(app, metrics);
  // Rate limiting runs after request-context so the key generator can read the
  // authenticated principal; exempt paths (health, webhooks) are skipped inside.
  if (rateLimitConfig) {
    registerRateLimit(app, rateLimitConfig);
  }
  // Routes register inside a child plugin so they load AFTER the CORS and
  // rate-limit plugins above. Those plugins add their onRequest hooks during
  // `ready()`; a hook added by a deferred plugin does not apply to routes that
  // were already registered synchronously, so the routes must be deferred too
  // for the hooks to cover them. The synchronous request-context/telemetry
  // hooks are on the root instance and reach this child context unchanged.
  app.register(async (instance) => {
    registerRoutes(instance, services);
    registerInternalRoutes(instance, { toolExecutor });
    registerWebhookRoutes(instance, webhooks);
  });

  app.addHook("onClose", async () => {
    await services.close?.();
    await webhooks.close?.();
    await toolExecutor.close?.();
    await userDirectory?.close?.();
  });

  return app;
}

/**
 * Replaces the default JSON body parser with one that retains the exact raw
 * request bytes on `request.rawBody`. Provider webhooks verify HMAC signatures
 * over the raw body, so the bytes must survive parsing unmodified.
 */
function registerRawJsonBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
      request.rawBody = buffer;

      if (buffer.length === 0) {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(buffer.toString("utf8")));
      } catch {
        done(
          new HttpError(
            400,
            "VALIDATION_ERROR",
            "Request body is not valid JSON.",
          ),
          undefined,
        );
      }
    },
  );
}
