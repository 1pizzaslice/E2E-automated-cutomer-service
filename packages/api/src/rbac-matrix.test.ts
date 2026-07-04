import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { RoleNameSchema, type RoleName } from "@support/shared-schemas";
import { registerErrorHandler } from "./errors.js";
import { registerInternalRoutes } from "./internal-routes.js";
import { registerRequestContext } from "./request-context.js";
import { registerRoutes } from "./routes.js";
import { ROLE_PERMISSIONS, type ApiPermission } from "./rbac.js";
import type { ApiServices } from "./services.js";
import type { ToolExecutor } from "./tool-registry.js";

const ROLES = RoleNameSchema.options;

/**
 * `internal_service` cannot be minted via `x-user-roles` (a claim there is
 * 401), so the matrix authenticates it with the machine bearer token instead.
 */
const INTERNAL_TEST_TOKEN = "rbac-matrix-internal-token";

/**
 * Every RBAC-guarded route with the permission it must enforce and concrete
 * params for injection. The coverage assertion below fails when a route is
 * registered without an entry here, so adding an endpoint forces an explicit
 * decision about its permission.
 */
const ROUTE_PERMISSION_CATALOG: ReadonlyArray<{
  readonly method: "GET" | "POST" | "PATCH";
  readonly url: string;
  readonly routePath: string;
  readonly permission: ApiPermission;
}> = [
  {
    method: "GET",
    url: "/openapi.json",
    routePath: "/openapi.json",
    permission: "openapi:read",
  },
  {
    method: "GET",
    url: "/v1/tenants",
    routePath: "/v1/tenants",
    permission: "tenants:list",
  },
  {
    method: "POST",
    url: "/v1/tenants",
    routePath: "/v1/tenants",
    permission: "tenants:create",
  },
  {
    method: "GET",
    url: "/v1/tenants/ten_test",
    routePath: "/v1/tenants/:tenant_id",
    permission: "tenants:read",
  },
  {
    method: "PATCH",
    url: "/v1/tenants/ten_test",
    routePath: "/v1/tenants/:tenant_id",
    permission: "tenants:update",
  },
  {
    method: "GET",
    url: "/v1/customers",
    routePath: "/v1/customers",
    permission: "customers:read",
  },
  {
    method: "POST",
    url: "/v1/customers",
    routePath: "/v1/customers",
    permission: "customers:create",
  },
  {
    method: "GET",
    url: "/v1/customers/cus_test",
    routePath: "/v1/customers/:customer_id",
    permission: "customers:read",
  },
  {
    method: "PATCH",
    url: "/v1/customers/cus_test",
    routePath: "/v1/customers/:customer_id",
    permission: "customers:update",
  },
  {
    method: "GET",
    url: "/v1/conversations",
    routePath: "/v1/conversations",
    permission: "conversations:read",
  },
  {
    method: "GET",
    url: "/v1/conversations/cnv_test",
    routePath: "/v1/conversations/:conversation_id",
    permission: "conversations:read",
  },
  {
    method: "GET",
    url: "/v1/conversations/cnv_test/messages",
    routePath: "/v1/conversations/:conversation_id/messages",
    permission: "messages:read",
  },
  {
    method: "GET",
    url: "/v1/conversations/cnv_test/messages/msg_test",
    routePath: "/v1/conversations/:conversation_id/messages/:message_id",
    permission: "messages:read",
  },
  {
    method: "GET",
    url: "/v1/policies",
    routePath: "/v1/policies",
    permission: "policies:read",
  },
  {
    method: "GET",
    url: "/v1/policies/automation",
    routePath: "/v1/policies/automation",
    permission: "policies:read",
  },
  {
    method: "GET",
    url: "/v1/policies/pol_test",
    routePath: "/v1/policies/:policy_id",
    permission: "policies:read",
  },
  {
    method: "GET",
    url: "/v1/reports/pilot-weekly",
    routePath: "/v1/reports/pilot-weekly",
    permission: "reports:read",
  },
  {
    method: "GET",
    url: "/v1/kb/documents",
    routePath: "/v1/kb/documents",
    permission: "kb_documents:read",
  },
  {
    method: "POST",
    url: "/v1/kb/documents",
    routePath: "/v1/kb/documents",
    permission: "kb_documents:write",
  },
  {
    method: "GET",
    url: "/v1/kb/documents/kbd_test",
    routePath: "/v1/kb/documents/:kb_document_id",
    permission: "kb_documents:read",
  },
  {
    method: "PATCH",
    url: "/v1/kb/documents/kbd_test",
    routePath: "/v1/kb/documents/:kb_document_id",
    permission: "kb_documents:write",
  },
  {
    method: "POST",
    url: "/v1/kb/documents/kbd_test/ingest",
    routePath: "/v1/kb/documents/:kb_document_id/ingest",
    permission: "kb_documents:write",
  },
  {
    method: "POST",
    url: "/v1/kb/search",
    routePath: "/v1/kb/search",
    permission: "kb:search",
  },
  {
    method: "GET",
    url: "/v1/approvals",
    routePath: "/v1/approvals",
    permission: "approvals:read",
  },
  {
    method: "GET",
    url: "/v1/approvals/apr_test",
    routePath: "/v1/approvals/:approval_id",
    permission: "approvals:read",
  },
  {
    method: "POST",
    url: "/v1/approvals/apr_test/approve",
    routePath: "/v1/approvals/:approval_id/approve",
    permission: "approvals:review",
  },
  {
    method: "POST",
    url: "/v1/approvals/apr_test/edit",
    routePath: "/v1/approvals/:approval_id/edit",
    permission: "approvals:review",
  },
  {
    method: "POST",
    url: "/v1/approvals/apr_test/reject",
    routePath: "/v1/approvals/:approval_id/reject",
    permission: "approvals:review",
  },
  {
    method: "POST",
    url: "/v1/approvals/apr_test/escalate",
    routePath: "/v1/approvals/:approval_id/escalate",
    permission: "approvals:review",
  },
  {
    method: "GET",
    url: "/v1/ai-runs",
    routePath: "/v1/ai-runs",
    permission: "ai_runs:read",
  },
  {
    method: "GET",
    url: "/v1/ai-runs/air_test",
    routePath: "/v1/ai-runs/:ai_run_id",
    permission: "ai_runs:read",
  },
  {
    method: "GET",
    url: "/v1/qa-reviews",
    routePath: "/v1/qa-reviews",
    permission: "qa_reviews:read",
  },
  {
    method: "POST",
    url: "/v1/qa-reviews",
    routePath: "/v1/qa-reviews",
    permission: "qa_reviews:write",
  },
  {
    method: "GET",
    url: "/v1/qa-reviews/qa_test",
    routePath: "/v1/qa-reviews/:qa_review_id",
    permission: "qa_reviews:read",
  },
  {
    method: "POST",
    url: "/v1/qa-reviews/qa_test/complete",
    routePath: "/v1/qa-reviews/:qa_review_id/complete",
    permission: "qa_reviews:write",
  },
  {
    method: "GET",
    url: "/v1/qa-reviews/qa_test/evidence",
    routePath: "/v1/qa-reviews/:qa_review_id/evidence",
    permission: "qa_reviews:read",
  },
  {
    method: "GET",
    url: "/v1/audit-events",
    routePath: "/v1/audit-events",
    permission: "audit_events:read",
  },
  {
    method: "GET",
    url: "/v1/audit-events/aud_test",
    routePath: "/v1/audit-events/:audit_event_id",
    permission: "audit_events:read",
  },
  {
    method: "GET",
    url: "/v1/tickets",
    routePath: "/v1/tickets",
    permission: "tickets:read",
  },
  {
    method: "POST",
    url: "/v1/tickets",
    routePath: "/v1/tickets",
    permission: "tickets:create",
  },
  {
    method: "GET",
    url: "/v1/tickets/tic_test",
    routePath: "/v1/tickets/:ticket_id",
    permission: "tickets:read",
  },
  {
    method: "GET",
    url: "/v1/tickets/tic_test/audit-events",
    routePath: "/v1/tickets/:ticket_id/audit-events",
    permission: "audit_events:read",
  },
  {
    method: "PATCH",
    url: "/v1/tickets/tic_test",
    routePath: "/v1/tickets/:ticket_id",
    permission: "tickets:update",
  },
  {
    method: "POST",
    url: "/internal/tools/execute",
    routePath: "/internal/tools/execute",
    permission: "tools:execute_internal",
  },
];

const UNGUARDED_ROUTES = new Set(["GET /health", "GET /ready"]);

/**
 * Every service method resolves to undefined: routes that pass the
 * permission gate then fail with 400/404/500 — anything but 401/403 —
 * which is exactly what the matrix assertions need.
 */
function makeStubServices(): ApiServices {
  const domainStub = new Proxy(
    {},
    {
      get: () => async () => undefined,
    },
  );

  return new Proxy(
    {},
    {
      get: (_target, property) =>
        property === "close" ? undefined : domainStub,
    },
  ) as unknown as ApiServices;
}

/**
 * The matrix only exercises the permission gate: requests that pass it fail
 * later on body validation (400), so the executor is never reached.
 */
function makeStubToolExecutor(): ToolExecutor {
  return {
    async execute() {
      throw new Error("tool executor must not be reached by the rbac matrix");
    },
    listTools() {
      return [];
    },
  };
}

function buildMatrixApp() {
  const app = Fastify({ logger: false });
  const registered = new Set<string>();

  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "HEAD") {
        continue;
      }
      registered.add(`${method} ${route.path}`);
    }
  });

  registerErrorHandler(app);
  registerRequestContext(app, {
    internalAuth: { token: INTERNAL_TEST_TOKEN },
  });
  registerRoutes(app, makeStubServices());
  registerInternalRoutes(app, { toolExecutor: makeStubToolExecutor() });

  return { app, registered };
}

function headersFor(role: RoleName): Record<string, string> {
  if (role === "internal_service") {
    // The machine principal authenticates with the internal bearer token; it
    // carries no user identity headers, only tenant context for /v1 routes.
    return {
      authorization: `Bearer ${INTERNAL_TEST_TOKEN}`,
      "x-tenant-id": "ten_test",
    };
  }

  return {
    authorization: "Bearer rbac-matrix-test-token",
    "x-user-id": "usr_rbac_matrix",
    "x-user-roles": role,
    "x-tenant-id": "ten_test",
  };
}

describe("rbac role permission matrix", () => {
  it("keeps tenant provisioning restricted to platform_admin", () => {
    for (const role of ROLES) {
      const permissions = ROLE_PERMISSIONS[role];
      if (role === "platform_admin") {
        expect(permissions.has("tenants:create")).toBe(true);
        expect(permissions.has("tenants:list")).toBe(true);
      } else {
        expect(permissions.has("tenants:create")).toBe(false);
        expect(permissions.has("tenants:list")).toBe(false);
      }
    }
  });

  it("keeps approval review restricted to operational reviewer roles", () => {
    const reviewers = ROLES.filter((role) =>
      ROLE_PERMISSIONS[role].has("approvals:review"),
    );
    expect(reviewers.sort()).toEqual([
      "ops_admin",
      "platform_admin",
      "support_agent",
    ]);
  });

  it("keeps client_viewer strictly read-only", () => {
    for (const permission of ROLE_PERMISSIONS.client_viewer) {
      expect(permission).not.toMatch(/:(create|update|write|review)$/);
    }
  });

  it("keeps integration_admin at openapi:read only until integration APIs exist", () => {
    expect([...ROLE_PERMISSIONS.integration_admin]).toEqual(["openapi:read"]);
  });

  it("grants every user role openapi:read and nothing implicitly", () => {
    for (const role of ROLES) {
      if (role === "internal_service") {
        continue;
      }
      expect(ROLE_PERMISSIONS[role].has("openapi:read")).toBe(true);
    }
  });

  it("scopes internal_service to exactly kb search and internal tool execution", () => {
    expect([...ROLE_PERMISSIONS.internal_service].sort()).toEqual([
      "kb:search",
      "tools:execute_internal",
    ]);

    for (const role of ROLES) {
      if (role === "internal_service") {
        continue;
      }
      expect(
        ROLE_PERMISSIONS[role].has("tools:execute_internal"),
        `${role} must not hold tools:execute_internal`,
      ).toBe(false);
    }
  });
});

describe("rbac route enforcement matrix", () => {
  let app: ReturnType<typeof buildMatrixApp>["app"] | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("covers every registered route with a permission catalog entry", () => {
    const built = buildMatrixApp();
    app = built.app;

    const uncovered = [...built.registered].filter(
      (route) =>
        !UNGUARDED_ROUTES.has(route) &&
        !ROUTE_PERMISSION_CATALOG.some(
          (entry) => `${entry.method} ${entry.routePath}` === route,
        ),
    );

    expect(uncovered).toEqual([]);

    for (const entry of ROUTE_PERMISSION_CATALOG) {
      expect(built.registered.has(`${entry.method} ${entry.routePath}`)).toBe(
        true,
      );
    }
  });

  it("enforces the documented permission for every route and role", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    for (const entry of ROUTE_PERMISSION_CATALOG) {
      for (const role of ROLES) {
        const response = await app.inject({
          method: entry.method,
          url: entry.url,
          headers: headersFor(role),
          ...(entry.method === "GET" ? {} : { payload: {} }),
        });

        const allowed = ROLE_PERMISSIONS[role].has(entry.permission);
        const label = `${entry.method} ${entry.url} as ${role}`;

        if (allowed) {
          expect(
            response.statusCode,
            `${label} should pass the permission gate`,
          ).not.toBe(403);
          expect(
            response.statusCode,
            `${label} should be authenticated`,
          ).not.toBe(401);
        } else {
          expect(response.statusCode, `${label} should be denied by RBAC`).toBe(
            403,
          );
        }
      }
    }
  });

  it("denies every guarded route without roles (deny-by-default)", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    for (const entry of ROUTE_PERMISSION_CATALOG) {
      const response = await app.inject({
        method: entry.method,
        url: entry.url,
        headers: {
          authorization: "Bearer rbac-matrix-test-token",
          "x-user-id": "usr_rbac_matrix",
          "x-tenant-id": "ten_test",
        },
        ...(entry.method === "GET" ? {} : { payload: {} }),
      });

      expect(
        response.statusCode,
        `${entry.method} ${entry.url} without roles`,
      ).toBe(401);
    }
  });

  it("rejects internal_service claimed via the x-user-roles header on every route", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    for (const entry of ROUTE_PERMISSION_CATALOG) {
      const response = await app.inject({
        method: entry.method,
        url: entry.url,
        headers: {
          authorization: "Bearer rbac-matrix-test-token",
          "x-user-id": "usr_rbac_matrix",
          "x-user-roles": "internal_service",
          "x-tenant-id": "ten_test",
        },
        ...(entry.method === "GET" ? {} : { payload: {} }),
      });

      expect(
        response.statusCode,
        `${entry.method} ${entry.url} claiming internal_service via headers`,
      ).toBe(401);
    }
  });
});
