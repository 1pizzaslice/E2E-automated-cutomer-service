import Fastify, { type FastifyInstance } from "fastify";
import { registerErrorHandler } from "./errors.js";
import { registerRequestContext } from "./request-context.js";
import { registerRoutes } from "./routes.js";
import { createDatabaseApiServices, type ApiServices } from "./services.js";

export interface BuildAppOptions {
  readonly services?: ApiServices;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });
  const services = options.services ?? createDatabaseApiServices();

  registerErrorHandler(app);
  registerRequestContext(app);
  registerRoutes(app, services);

  app.addHook("onClose", async () => {
    await services.close?.();
  });

  return app;
}
