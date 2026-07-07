import { createServer, type Server } from "node:http";
import Fastify from "fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RoleNameSchema, type RoleName } from "@support/shared-schemas";
import {
  createJwksTokenVerifier,
  type AuthenticatedUser,
  type JwtAuthConfig,
  type UserDirectory,
} from "./auth.js";
import { registerErrorHandler } from "./errors.js";
import { registerInternalRoutes } from "./internal-routes.js";
import { registerRequestContext } from "./request-context.js";
import { registerRoutes } from "./routes.js";
import { ROLE_PERMISSIONS, type ApiPermission } from "./rbac.js";
import type { ApiServices } from "./services.js";
import type { ToolExecutor } from "./tool-registry.js";

const ROLES = RoleNameSchema.options;

/**
 * `internal_service` cannot be minted via user tokens (no user row carries
 * it), so the matrix authenticates it with the machine bearer token instead.
 */
const INTERNAL_TEST_TOKEN = "rbac-matrix-internal-token";

/**
 * Milestone 16: the matrix runs under production JWT auth with REAL signed
 * tokens — an RSA key pair generated per suite, served through a local JWKS
 * endpoint, verified by the same `createJwksTokenVerifier` production uses.
 * Header identity is never consulted; each role authenticates as a directory
 * user holding exactly that role in `ten_test`.
 */
const ISSUER = "https://rbac-matrix.test";
const AUDIENCE = "support-platform-api";
const KEY_ID = "rbac-matrix-key-1";

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
    method: "POST",
    url: "/v1/policies",
    routePath: "/v1/policies",
    permission: "policies:write",
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
    url: "/v1/policies/pol_test/versions",
    routePath: "/v1/policies/:policy_id/versions",
    permission: "policies:read",
  },
  {
    method: "POST",
    url: "/v1/policies/pol_test/versions",
    routePath: "/v1/policies/:policy_id/versions",
    permission: "policies:write",
  },
  {
    method: "POST",
    url: "/v1/policy-versions/polv_test/activate",
    routePath: "/v1/policy-versions/:policy_version_id/activate",
    permission: "policies:write",
  },
  {
    method: "POST",
    url: "/v1/policies/pol_test/archive",
    routePath: "/v1/policies/:policy_id/archive",
    permission: "policies:write",
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

/** Catalog routes that read the `x-tenant-id` header (tenant-scoped). */
const TENANT_SCOPED_ENTRIES = ROUTE_PERMISSION_CATALOG.filter((entry) =>
  entry.routePath.startsWith("/v1/"),
);

interface JwtFixture {
  readonly config: JwtAuthConfig;
  readonly jwksServer: Server;
  readonly privateKey: CryptoKey;
  readonly forgedPrivateKey: CryptoKey;
}

let fixture: JwtFixture | undefined;
const roleTokens = new Map<RoleName, string>();
let otherTenantToken = "";
let platformWideToken = "";

/**
 * Directory fixture: one user per user role (member of ten_test, holding
 * exactly that role), one member of a different tenant, and one
 * platform-level user (NULL tenant). Unknown subjects resolve to null, like
 * unprovisioned or non-active users in the database directory.
 */
function makeUserDirectory(): UserDirectory {
  const users = new Map<string, AuthenticatedUser>();

  for (const role of ROLES) {
    if (role === "internal_service") {
      continue;
    }

    users.set(`idp|usr_matrix_${role}`, {
      userId: `usr_matrix_${role}`,
      email: `${role}@matrix.test`,
      tenantId: "ten_test",
      roles: [role],
    });
  }

  users.set("idp|usr_matrix_other_tenant", {
    userId: "usr_matrix_other_tenant",
    tenantId: "ten_other",
    roles: ["ops_admin"],
  });
  users.set("idp|usr_matrix_platform", {
    userId: "usr_matrix_platform",
    tenantId: null,
    roles: ["platform_admin"],
  });

  return {
    async findByIdpSubject(subject) {
      return users.get(subject) ?? null;
    },
  };
}

async function mintToken(
  subject: string,
  options: {
    readonly issuer?: string;
    readonly audience?: string;
    readonly expiresAt?: number;
    readonly omitExpiry?: boolean;
    readonly key?: CryptoKey;
  } = {},
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setSubject(subject)
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt(nowSeconds - 5);

  if (!options.omitExpiry) {
    jwt.setExpirationTime(options.expiresAt ?? nowSeconds + 300);
  }

  return jwt.sign(options.key ?? fixture!.privateKey);
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const { privateKey: forgedPrivateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  const jwks = JSON.stringify({
    keys: [{ ...jwk, kid: KEY_ID, alg: "RS256", use: "sig" }],
  });

  const jwksServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(jwks);
  });
  await new Promise<void>((resolve) =>
    jwksServer.listen(0, "127.0.0.1", resolve),
  );
  const address = jwksServer.address();

  if (address === null || typeof address !== "object") {
    throw new Error("JWKS fixture server did not report a port.");
  }

  fixture = {
    config: {
      mode: "jwt",
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUrl: `http://127.0.0.1:${address.port}/jwks.json`,
      clockToleranceSeconds: 60,
    },
    jwksServer,
    privateKey,
    forgedPrivateKey,
  };

  for (const role of ROLES) {
    if (role === "internal_service") {
      continue;
    }

    roleTokens.set(role, await mintToken(`idp|usr_matrix_${role}`));
  }

  otherTenantToken = await mintToken("idp|usr_matrix_other_tenant");
  platformWideToken = await mintToken("idp|usr_matrix_platform");
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    fixture?.jwksServer.close((error) => (error ? reject(error) : resolve())),
  );
});

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
    auth: {
      mode: "jwt",
      verifier: createJwksTokenVerifier(fixture!.config),
      userDirectory: makeUserDirectory(),
    },
    internalAuth: { token: INTERNAL_TEST_TOKEN },
  });
  registerRoutes(app, makeStubServices());
  registerInternalRoutes(app, { toolExecutor: makeStubToolExecutor() });

  return { app, registered };
}

function headersFor(role: RoleName): Record<string, string> {
  if (role === "internal_service") {
    // The machine principal authenticates with the internal bearer token; it
    // carries no user identity, only tenant context for /v1 routes.
    return {
      authorization: `Bearer ${INTERNAL_TEST_TOKEN}`,
      "x-tenant-id": "ten_test",
    };
  }

  return {
    authorization: `Bearer ${roleTokens.get(role)!}`,
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

  it("keeps policy lifecycle writes restricted to admin roles", () => {
    const writers = ROLES.filter((role) =>
      ROLE_PERMISSIONS[role].has("policies:write"),
    );
    expect(writers.sort()).toEqual(["ops_admin", "platform_admin"]);
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

describe("rbac route enforcement matrix (real JWT fixtures)", () => {
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

  it("rejects absent bearer tokens with 401 on every route", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    for (const entry of ROUTE_PERMISSION_CATALOG) {
      const response = await app.inject({
        method: entry.method,
        url: entry.url,
        headers: { "x-tenant-id": "ten_test" },
        ...(entry.method === "GET" ? {} : { payload: {} }),
      });

      expect(
        response.statusCode,
        `${entry.method} ${entry.url} without a token`,
      ).toBe(401);
    }
  });

  it("rejects expired tokens with 401 on every route", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    const expired = await mintToken("idp|usr_matrix_platform_admin", {
      expiresAt: Math.floor(Date.now() / 1000) - 3600,
    });

    for (const entry of ROUTE_PERMISSION_CATALOG) {
      const response = await app.inject({
        method: entry.method,
        url: entry.url,
        headers: {
          authorization: `Bearer ${expired}`,
          "x-tenant-id": "ten_test",
        },
        ...(entry.method === "GET" ? {} : { payload: {} }),
      });

      expect(
        response.statusCode,
        `${entry.method} ${entry.url} with an expired token`,
      ).toBe(401);
    }
  });

  it("rejects forged tokens (wrong signing key) with 401 on every route", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    const forged = await mintToken("idp|usr_matrix_platform_admin", {
      key: fixture!.forgedPrivateKey,
    });

    for (const entry of ROUTE_PERMISSION_CATALOG) {
      const response = await app.inject({
        method: entry.method,
        url: entry.url,
        headers: {
          authorization: `Bearer ${forged}`,
          "x-tenant-id": "ten_test",
        },
        ...(entry.method === "GET" ? {} : { payload: {} }),
      });

      expect(
        response.statusCode,
        `${entry.method} ${entry.url} with a forged token`,
      ).toBe(401);
    }
  });

  it("rejects wrong-audience tokens with 401 on every route", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    const wrongAudience = await mintToken("idp|usr_matrix_platform_admin", {
      audience: "another-api",
    });

    for (const entry of ROUTE_PERMISSION_CATALOG) {
      const response = await app.inject({
        method: entry.method,
        url: entry.url,
        headers: {
          authorization: `Bearer ${wrongAudience}`,
          "x-tenant-id": "ten_test",
        },
        ...(entry.method === "GET" ? {} : { payload: {} }),
      });

      expect(
        response.statusCode,
        `${entry.method} ${entry.url} with a wrong-audience token`,
      ).toBe(401);
    }
  });

  it("rejects wrong-issuer, expiry-less, and unknown-subject tokens", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    const cases = [
      await mintToken("idp|usr_matrix_platform_admin", {
        issuer: "https://not-the-idp.test",
      }),
      await mintToken("idp|usr_matrix_platform_admin", { omitExpiry: true }),
      // Cryptographically valid, but no platform user exists for the subject
      // (unprovisioned or non-active): still 401.
      await mintToken("idp|usr_matrix_unknown"),
    ];

    for (const token of cases) {
      const response = await app.inject({
        method: "GET",
        url: "/v1/tickets",
        headers: {
          authorization: `Bearer ${token}`,
          "x-tenant-id": "ten_test",
        },
      });

      expect(response.statusCode).toBe(401);
    }
  });

  it("returns 403 for a valid token whose user is not a member of the tenant", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    for (const entry of TENANT_SCOPED_ENTRIES) {
      const response = await app.inject({
        method: entry.method,
        url: entry.url,
        headers: {
          authorization: `Bearer ${otherTenantToken}`,
          "x-tenant-id": "ten_test",
        },
        ...(entry.method === "GET" ? {} : { payload: {} }),
      });

      expect(
        response.statusCode,
        `${entry.method} ${entry.url} as a non-member`,
      ).toBe(403);
    }
  });

  it("lets platform-level users (NULL tenant) operate on any tenant", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/policies",
      headers: {
        authorization: `Bearer ${platformWideToken}`,
        "x-tenant-id": "ten_other",
      },
    });

    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).not.toBe(403);
  });

  it("ignores identity headers under JWT auth: roles come from the directory", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    // A support_agent token decorated with platform_admin headers must still
    // be denied tenant provisioning — header identity is never consulted.
    const response = await app.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: {
        authorization: `Bearer ${roleTokens.get("support_agent")!}`,
        "x-user-id": "usr_matrix_platform_admin",
        "x-user-roles": "platform_admin",
        "x-tenant-id": "ten_test",
      },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it("rejects user tokens on the internal endpoint (machine tokens only)", async () => {
    const built = buildMatrixApp();
    app = built.app;
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      headers: {
        authorization: `Bearer ${roleTokens.get("platform_admin")!}`,
      },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });
});
