import Fastify, { type FastifyInstance } from "fastify";
import { createHealthResponse } from "@support/shared-schemas";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  app.get("/health", async () => createHealthResponse("api"));
  app.get("/ready", async () => createHealthResponse("api"));

  return app;
}
