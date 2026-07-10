import { describe, expect, it } from "vitest";
import { apiRouteKeys } from "@support/api-client";
import { buildApp } from "./app.js";
import { buildOpenApiDocument } from "./openapi.js";
import type { ApiServices } from "./services.js";

// Route↔spec drift guard (Milestone 20). `openapi.ts` is a hand-written
// document and `packages/api-client` is a hand-written client; neither is
// generated from the routes. This test binds all three together so adding a
// route to `routes.ts` without documenting it (or exposing it in the client)
// fails CI instead of silently drifting.
process.env.SUPPORT_AUTH_MODE = "insecure-headers";

// Server-facing routes that API clients never call: the AI-sidecar internal
// endpoint and the provider webhooks (authenticated by signature, not token).
// They must still appear in the OpenAPI document, just not in the client.
const NON_CLIENT_PREFIXES = ["/internal/", "/v1/webhooks/"];

async function collectRegisteredRoutes(): Promise<Set<string>> {
  const app = buildApp({
    services: {} as unknown as ApiServices,
    internalAuth: null,
    cors: null,
    rateLimit: null,
  });
  const routes = new Set<string>();

  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];

    for (const method of methods) {
      // HEAD is auto-added for every GET; OPTIONS only appears with CORS on.
      if (method === "HEAD" || method === "OPTIONS") {
        continue;
      }

      // Normalize Fastify's `:param` to the OpenAPI `{param}` template.
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      routes.add(`${method} ${path}`);
    }
  });

  // Routes register inside a deferred child plugin (see app.ts), so wait for
  // boot before reading the collected set.
  await app.ready();
  await app.close();

  return routes;
}

function documentedRoutes(): Set<string> {
  const doc = buildOpenApiDocument();
  const documented = new Set<string>();

  for (const [path, operations] of Object.entries(doc.paths)) {
    for (const method of Object.keys(operations as Record<string, unknown>)) {
      documented.add(`${method.toUpperCase()} ${path}`);
    }
  }

  return documented;
}

function isClientFacing(routeKey: string): boolean {
  const path = routeKey.slice(routeKey.indexOf(" ") + 1);
  return !NON_CLIENT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

describe("route ↔ OpenAPI ↔ client drift", () => {
  it("documents every registered route in the OpenAPI document (and vice versa)", async () => {
    const registered = await collectRegisteredRoutes();
    const documented = documentedRoutes();

    const undocumented = [...registered]
      .filter((r) => !documented.has(r))
      .sort();
    const orphanedInSpec = [...documented]
      .filter((d) => !registered.has(d))
      .sort();

    expect(undocumented, "routes missing from openapi.ts").toEqual([]);
    expect(orphanedInSpec, "openapi paths with no registered route").toEqual(
      [],
    );
  });

  it("exposes every client-facing route in packages/api-client (and vice versa)", async () => {
    const registered = await collectRegisteredRoutes();
    const clientFacing = new Set([...registered].filter(isClientFacing));
    const manifest = apiRouteKeys();

    const missingFromClient = [...clientFacing]
      .filter((r) => !manifest.has(r))
      .sort();
    const staleInClient = [...manifest]
      .filter((r) => !clientFacing.has(r))
      .sort();

    expect(missingFromClient, "routes missing from api-client").toEqual([]);
    expect(staleInClient, "api-client routes with no server route").toEqual([]);
  });
});
