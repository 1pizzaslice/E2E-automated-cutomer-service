import { buildApp } from "./app.js";

const app = buildApp();
const host = process.env.API_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.API_PORT ?? "3000", 10);

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error({ error }, "api failed to start");
  process.exit(1);
}
