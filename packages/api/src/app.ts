import Fastify, { type FastifyInstance } from "fastify";
import {
  createOtelSupportMetrics,
  type SupportMetrics,
} from "@support/observability";
import { HttpError, registerErrorHandler } from "./errors.js";
import { createDatabaseInboundWebhookDependencies } from "./inbound-webhook-deps.js";
import {
  loadInternalAuthConfig,
  type InternalAuthConfig,
} from "./internal-auth.js";
import { registerInternalRoutes } from "./internal-routes.js";
import { registerRequestTelemetry } from "./observability.js";
import { registerRequestContext } from "./request-context.js";
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

  registerRawJsonBodyParser(app);
  registerErrorHandler(app);
  registerRequestContext(app, { ...(internalAuth ? { internalAuth } : {}) });
  registerRequestTelemetry(app, metrics);
  registerRoutes(app, services);
  registerInternalRoutes(app, { toolExecutor });
  registerWebhookRoutes(app, webhooks);

  app.addHook("onClose", async () => {
    await services.close?.();
    await webhooks.close?.();
    await toolExecutor.close?.();
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
