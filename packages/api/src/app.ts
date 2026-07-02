import Fastify, { type FastifyInstance } from "fastify";
import { HttpError, registerErrorHandler } from "./errors.js";
import { createDatabaseInboundWebhookDependencies } from "./inbound-webhook-deps.js";
import { registerRequestContext } from "./request-context.js";
import { registerRoutes } from "./routes.js";
import { createDatabaseApiServices, type ApiServices } from "./services.js";
import {
  registerWebhookRoutes,
  type InboundWebhookDependencies,
} from "./webhooks.js";

export interface BuildAppOptions {
  readonly services?: ApiServices;
  readonly webhooks?: InboundWebhookDependencies;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });
  const services = options.services ?? createDatabaseApiServices();
  const webhooks =
    options.webhooks ?? createDatabaseInboundWebhookDependencies();

  registerRawJsonBodyParser(app);
  registerErrorHandler(app);
  registerRequestContext(app);
  registerRoutes(app, services);
  registerWebhookRoutes(app, webhooks);

  app.addHook("onClose", async () => {
    await services.close?.();
    await webhooks.close?.();
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
