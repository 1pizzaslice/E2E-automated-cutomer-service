import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { defineReadOnlyTool } from "@support/integrations";
import {
  ApiErrorResponseSchema,
  InternalToolExecuteResponseSchema,
  KbSearchResponseSchema,
} from "@support/shared-schemas";
import { z } from "zod";
import { buildApp } from "./app.js";
import {
  DEFAULT_INTERNAL_API_TOKEN_REF,
  INTERNAL_API_TOKEN_REF_ENV,
  INTERNAL_SERVICE_USER_ID,
  isInternalServiceToken,
  loadInternalAuthConfig,
} from "./internal-auth.js";
import {
  createInMemoryToolRegistryStore,
  createToolExecutor,
  defineTool,
  type InMemoryToolRegistryStore,
} from "./tool-registry.js";
import type { ApiServices } from "./services.js";

const INTERNAL_TOKEN = "internal-test-token";
const TENANT_ID = "ten_internal";

const machineHeaders = {
  authorization: `Bearer ${INTERNAL_TOKEN}`,
};

const supportAgentHeaders = {
  authorization: "Bearer user-gateway-token",
  "x-user-id": "usr_agent",
  "x-user-roles": "support_agent",
};

function executeBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tenant_id: TENANT_ID,
    ticket_id: "tkt_1",
    ai_run_id: "air_1",
    granted_permissions: ["order_read"],
    request: {
      tool_name: "echo_tool",
      arguments: { value: "hello" },
    },
    ...overrides,
  };
}

/** An echo tool + in-memory registry store, mirroring the tool-registry tests. */
function makeToolExecutorFixture() {
  const store: InMemoryToolRegistryStore = createInMemoryToolRegistryStore([
    {
      toolDefinitionId: "tdf_echo_tool",
      tenantId: null,
      name: "echo_tool",
      sideEffectClass: "read_only",
      status: "active",
    },
  ]);
  const echoTool = defineTool({
    definition: defineReadOnlyTool({
      name: "echo_tool",
      description: "Echoes its argument back (test fixture).",
      permission: "order_read",
      timeoutMs: 1000,
    }),
    argsSchema: z.object({ value: z.string() }).strict(),
    resultSchema: z.object({ value: z.string() }).strict(),
    handler: async (args) => ({ value: args.value }),
  });
  const executor = createToolExecutor({ store, tools: [echoTool] });

  return { executor, store };
}

/**
 * Stub services in the app.test.ts in-memory style, trimmed to what the
 * machine-actor tests reach: kb search succeeds, everything else resolves
 * undefined (the permission gate rejects before those stubs matter).
 */
function makeStubServices(): ApiServices {
  const domainStub = new Proxy(
    {},
    {
      get: () => async () => undefined,
    },
  );
  const kbDocuments = new Proxy(
    {},
    {
      get: (_target, property) =>
        property === "search"
          ? async (_context: unknown, input: { limit?: number }) => ({
              results: [],
              page: { count: 0, limit: input.limit ?? 8 },
            })
          : async () => undefined,
    },
  );

  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === "close") {
          return undefined;
        }
        return property === "kbDocuments" ? kbDocuments : domainStub;
      },
    },
  ) as unknown as ApiServices;
}

function makeApp(options: { readonly internalAuthDisabled?: boolean } = {}) {
  const fixture = makeToolExecutorFixture();
  const app = buildApp({
    services: makeStubServices(),
    toolExecutor: fixture.executor,
    internalAuth: options.internalAuthDisabled
      ? null
      : { token: INTERNAL_TOKEN },
  });

  return { app, store: fixture.store };
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("internal auth configuration", () => {
  it("returns undefined when the token env var is unset (machine auth disabled)", () => {
    expect(loadInternalAuthConfig({})).toBeUndefined();
    expect(
      loadInternalAuthConfig({ [DEFAULT_INTERNAL_API_TOKEN_REF]: "" }),
    ).toBeUndefined();
  });

  it("reads the token through the default secret ref", () => {
    const config = loadInternalAuthConfig({
      [DEFAULT_INTERNAL_API_TOKEN_REF]: "sekret",
    });

    expect(config).toEqual({ token: "sekret" });
  });

  it("honors a custom secret ref naming another env var", () => {
    const config = loadInternalAuthConfig({
      [INTERNAL_API_TOKEN_REF_ENV]: "CUSTOM_INTERNAL_TOKEN",
      CUSTOM_INTERNAL_TOKEN: "other-sekret",
    });

    expect(config).toEqual({ token: "other-sekret" });
  });

  it("fails fast on an invalid secret ref, naming the variable", () => {
    expect(() =>
      loadInternalAuthConfig({
        [INTERNAL_API_TOKEN_REF_ENV]: "not-a-valid-ref",
      }),
    ).toThrow(INTERNAL_API_TOKEN_REF_ENV);
  });

  it("compares tokens in constant time without throwing on length mismatch", () => {
    const config = { token: "correct-token" };

    expect(isInternalServiceToken(config, "correct-token")).toBe(true);
    expect(isInternalServiceToken(config, "wrong-token")).toBe(false);
    expect(isInternalServiceToken(config, "")).toBe(false);
    expect(
      isInternalServiceToken(config, "much-longer-token-of-other-length"),
    ).toBe(false);
  });
});

describe("POST /internal/tools/execute", () => {
  it("executes a tool for the machine actor and returns the succeeded envelope", async () => {
    const built = makeApp();
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      headers: machineHeaders,
      payload: executeBody(),
    });

    expect(response.statusCode).toBe(200);
    const result = InternalToolExecuteResponseSchema.parse(response.json());
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.tool_name).toBe("echo_tool");
    expect(result.output).toEqual({ value: "hello" });
    expect(result.idempotent_replay).toBe(false);

    // The audit row is anchored to the ids from the request body.
    expect(built.store.listCalls()).toHaveLength(1);
    expect(built.store.listCalls()[0]).toMatchObject({
      tenantId: TENANT_ID,
      ticketId: "tkt_1",
      aiRunId: "air_1",
      status: "succeeded",
    });
  });

  it("returns a blocked envelope over HTTP 200 when granted permissions lack the tool's class", async () => {
    const built = makeApp();
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      headers: machineHeaders,
      payload: executeBody({ granted_permissions: ["kb_read"] }),
    });

    expect(response.statusCode).toBe(200);
    const result = InternalToolExecuteResponseSchema.parse(response.json());
    expect(result.status).toBe("blocked");
    if (result.status === "succeeded") return;
    expect(result.error.code).toBe("unauthorized");

    // Blocked attempts are audited too.
    expect(built.store.listCalls()[0]).toMatchObject({
      tenantId: TENANT_ID,
      status: "blocked",
    });
  });

  it("rejects requests without a bearer token", async () => {
    const built = makeApp();
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      payload: executeBody(),
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(built.store.listCalls()).toHaveLength(0);
  });

  it("rejects a wrong bearer token without user identity headers", async () => {
    const built = makeApp();
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      headers: { authorization: "Bearer not-the-internal-token" },
      payload: executeBody(),
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(built.store.listCalls()).toHaveLength(0);
  });

  it("rejects internal_service claimed via the x-user-roles header as unauthenticated", async () => {
    const built = makeApp();
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      headers: {
        authorization: "Bearer some-user-token",
        "x-user-id": INTERNAL_SERVICE_USER_ID,
        "x-user-roles": "internal_service",
      },
      payload: executeBody(),
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(built.store.listCalls()).toHaveLength(0);
  });

  it("denies user roles on the internal route (no user role holds the permission)", async () => {
    const built = makeApp();
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      headers: supportAgentHeaders,
      payload: executeBody(),
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(built.store.listCalls()).toHaveLength(0);
  });

  it("rejects invalid request bodies with 400 before executing anything", async () => {
    const built = makeApp();
    app = built.app;

    for (const payload of [
      {},
      executeBody({ tenant_id: "" }),
      executeBody({ granted_permissions: ["not_a_class"] }),
      executeBody({ unexpected: true }),
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/internal/tools/execute",
        headers: machineHeaders,
        payload,
      });
      const body = ApiErrorResponseSchema.parse(response.json());

      expect(response.statusCode).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    }

    expect(built.store.listCalls()).toHaveLength(0);
  });

  it("fails closed when internal auth is disabled: the token authenticates nobody", async () => {
    const built = makeApp({ internalAuthDisabled: true });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      headers: machineHeaders,
      payload: executeBody(),
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(built.store.listCalls()).toHaveLength(0);
  });
});

describe("machine actor on /v1 routes", () => {
  it("allows the machine actor to search the KB with tenant context from headers", async () => {
    const built = makeApp();
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/v1/kb/search",
      headers: { ...machineHeaders, "x-tenant-id": TENANT_ID },
      payload: { query: "refund policy", limit: 5 },
    });

    expect(response.statusCode).toBe(200);
    const body = KbSearchResponseSchema.parse(response.json());
    expect(body.page).toEqual({ count: 0, limit: 5 });
  });

  it("denies the machine actor every /v1 permission it does not hold", async () => {
    const built = makeApp();
    app = built.app;

    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets",
      headers: { ...machineHeaders, "x-tenant-id": TENANT_ID },
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
