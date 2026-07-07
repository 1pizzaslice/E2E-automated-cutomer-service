import { createServer, type Server } from "node:http";
import type { FastifyInstance } from "fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRecordingSupportMetrics } from "@support/observability";
import {
  ApiErrorResponseSchema,
  AuditEventListResponseSchema,
  EffectiveAutomationPolicyResponseSchema,
  PolicyActivationResponseSchema,
  PolicyCreateResponseSchema,
  PolicyResourceResponseSchema,
  PolicyVersionListResponseSchema,
  PolicyVersionResourceResponseSchema,
  TenantResourceResponseSchema,
} from "@support/shared-schemas";
import {
  createDatabase,
  createPostgresClient,
  migrateDatabase,
  roles,
  tenants,
  userRoles,
  users,
  type PostgresClient,
} from "@support/db";
import { buildApp } from "./app.js";
import { createRecordingApprovalWorkflowSignaler } from "./approval-workflow-signaler.js";
import type { JwtAuthConfig } from "./auth.js";
import { createDatabaseApiServices } from "./services.js";

/**
 * Milestone 16 live coverage: production JWT auth against the real database —
 * real RS256 tokens verified through the JWKS path, subjects resolved to
 * seeded `users` rows with DB-sourced roles, server-side tenant membership,
 * and the policy lifecycle (create → version → activate → archive) with its
 * `policy.*` audit trail and the fail-closed effective-automation resolution.
 */
const describeLive =
  process.env.RUN_API_INTEGRATION_TESTS === "true" ? describe : describe.skip;

const fixturePrefix = `auth_it_${process.pid}_${Date.now()}`;
const ids = {
  tenantA: `${fixturePrefix}_ten_a`,
  tenantB: `${fixturePrefix}_ten_b`,
  roleOpsA: `${fixturePrefix}_role_ops_a`,
  roleOpsB: `${fixturePrefix}_role_ops_b`,
  rolePlatform: `${fixturePrefix}_role_platform`,
  opsUser: `${fixturePrefix}_usr_ops`,
  otherTenantUser: `${fixturePrefix}_usr_other`,
  suspendedUser: `${fixturePrefix}_usr_suspended`,
  platformUser: `${fixturePrefix}_usr_platform`,
};
const subjects = {
  ops: `${fixturePrefix}|ops`,
  other: `${fixturePrefix}|other`,
  suspended: `${fixturePrefix}|suspended`,
  platform: `${fixturePrefix}|platform`,
  unknown: `${fixturePrefix}|unprovisioned`,
};

const ISSUER = "https://auth-it.test";
const AUDIENCE = "support-platform-api";
const KEY_ID = "auth-it-key";

describeLive("live JWT auth and policy lifecycle", () => {
  let app: FastifyInstance | undefined;
  let client: PostgresClient | undefined;
  let jwksServer: Server | undefined;
  let privateKey: CryptoKey;
  const approvalSignaler = createRecordingApprovalWorkflowSignaler();
  const metrics = createRecordingSupportMetrics();
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required when RUN_API_INTEGRATION_TESTS=true",
      );
    }

    client = createPostgresClient(undefined, { max: 1 });
    const db = createDatabase(client);

    await migrateDatabase(client);
    await seedFixtures(db);

    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = pair.privateKey;
    const jwk = await exportJWK(pair.publicKey);
    const jwks = JSON.stringify({
      keys: [{ ...jwk, kid: KEY_ID, alg: "RS256", use: "sig" }],
    });

    jwksServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(jwks);
    });
    await new Promise<void>((resolve) =>
      jwksServer!.listen(0, "127.0.0.1", resolve),
    );
    const address = jwksServer.address();

    if (address === null || typeof address !== "object") {
      throw new Error("JWKS fixture server did not report a port.");
    }

    const authConfig: JwtAuthConfig = {
      mode: "jwt",
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUrl: `http://127.0.0.1:${address.port}/jwks.json`,
      clockToleranceSeconds: 60,
    };

    for (const subject of Object.values(subjects)) {
      tokens.set(subject, await mintToken(subject));
    }

    // Default verifier + default database user directory: the production
    // JWT path end to end against live PostgreSQL.
    app = buildApp({
      services: createDatabaseApiServices({ approvalSignaler, metrics }),
      metrics,
      auth: authConfig,
      internalAuth: null,
    });
  });

  afterAll(async () => {
    try {
      await app?.close();

      if (client) {
        await cleanupFixtures(client);
      }
    } finally {
      await client?.end();
      await new Promise<void>((resolve, reject) =>
        jwksServer
          ? jwksServer.close((error) => (error ? reject(error) : resolve()))
          : resolve(),
      );
    }
  });

  async function mintToken(subject: string): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);

    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(nowSeconds - 5)
      .setExpirationTime(nowSeconds + 600)
      .sign(privateKey);
  }

  function headers(
    subject: string,
    tenantId: string | null = ids.tenantA,
  ): Record<string, string> {
    return {
      authorization: `Bearer ${tokens.get(subject)!}`,
      ...(tenantId ? { "x-tenant-id": tenantId } : {}),
    };
  }

  it("authenticates a real token via the user directory with DB-sourced roles", async () => {
    const response = await app!.inject({
      method: "GET",
      url: `/v1/tenants/${ids.tenantA}`,
      headers: headers(subjects.ops),
    });
    const body = TenantResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.tenant.tenant_id).toBe(ids.tenantA);
    // Milestone 12 follow-up closed: retention_policy is on the contract.
    expect(body.tenant.retention_policy).toEqual({ raw_payload_days: 30 });
  });

  it("enforces tenant membership server-side (403 on non-membership)", async () => {
    const crossTenant = await app!.inject({
      method: "GET",
      url: `/v1/tenants/${ids.tenantB}`,
      headers: headers(subjects.ops, ids.tenantB),
    });
    expect(crossTenant.statusCode).toBe(403);

    const otherWayAround = await app!.inject({
      method: "GET",
      url: `/v1/tenants/${ids.tenantA}`,
      headers: headers(subjects.other, ids.tenantA),
    });
    expect(otherWayAround.statusCode).toBe(403);
  });

  it("lets a platform-level user (NULL tenant) operate on any tenant", async () => {
    const response = await app!.inject({
      method: "GET",
      url: `/v1/tenants/${ids.tenantA}`,
      headers: headers(subjects.platform),
    });

    expect(response.statusCode).toBe(200);
  });

  it("rejects suspended and unprovisioned subjects with 401", async () => {
    for (const subject of [subjects.suspended, subjects.unknown]) {
      const response = await app!.inject({
        method: "GET",
        url: `/v1/tenants/${ids.tenantA}`,
        headers: headers(subject),
      });
      const body = ApiErrorResponseSchema.parse(response.json());

      expect(response.statusCode).toBe(401);
      expect(body.error.code).toBe("AUTH_REQUIRED");
    }
  });

  it("runs the policy lifecycle end to end with audits and fail-closed automation", async () => {
    const policyAId = `${fixturePrefix}_pol_auto_a`;

    // 1. Create an automation policy (draft) with valid content.
    const created = await app!.inject({
      method: "POST",
      url: "/v1/policies",
      headers: headers(subjects.ops),
      payload: {
        policy_id: policyAId,
        name: `${fixturePrefix} automation A`,
        domain: "automation",
        content: { auto_send_enabled: false, auto_send_allowed_topics: [] },
      },
    });
    const createdBody = PolicyCreateResponseSchema.parse(created.json());

    expect(created.statusCode).toBe(201);
    expect(createdBody.policy.status).toBe("draft");
    expect(createdBody.policy_version.version).toBe(1);
    expect(createdBody.policy_version.activated_at).toBeNull();

    // Invalid automation content is rejected at write time (fail closed).
    const invalid = await app!.inject({
      method: "POST",
      url: "/v1/policies",
      headers: headers(subjects.ops),
      payload: {
        name: `${fixturePrefix} bad automation`,
        domain: "automation",
        content: {
          auto_send_enabled: true,
          auto_send_allowed_topics: ["refund"],
        },
      },
    });
    expect(invalid.statusCode).toBe(400);

    // 2. Draft a second version.
    const versioned = await app!.inject({
      method: "POST",
      url: `/v1/policies/${policyAId}/versions`,
      headers: headers(subjects.ops),
      payload: {
        content: { auto_send_enabled: true, auto_send_allowed_topics: ["faq"] },
      },
    });
    const versionedBody = PolicyVersionResourceResponseSchema.parse(
      versioned.json(),
    );

    expect(versioned.statusCode).toBe(201);
    expect(versionedBody.policy_version.version).toBe(2);

    const versionOneId = createdBody.policy_version.policy_version_id;
    const versionTwoId = versionedBody.policy_version.policy_version_id;

    // 3. Activate version 2; the policy becomes active.
    const activated = await app!.inject({
      method: "POST",
      url: `/v1/policy-versions/${versionTwoId}/activate`,
      headers: headers(subjects.ops),
    });
    const activatedBody = PolicyActivationResponseSchema.parse(
      activated.json(),
    );

    expect(activated.statusCode).toBe(200);
    expect(activatedBody.policy.status).toBe("active");
    expect(activatedBody.policy_version.activated_at).not.toBeNull();
    expect(activatedBody.policy_version.approved_by_user_id).toBe(ids.opsUser);

    // Activation immutability: re-activating v2 conflicts, and the stale v1
    // draft can no longer be activated behind it.
    for (const versionId of [versionTwoId, versionOneId]) {
      const conflict = await app!.inject({
        method: "POST",
        url: `/v1/policy-versions/${versionId}/activate`,
        headers: headers(subjects.ops),
      });
      expect(conflict.statusCode).toBe(409);
    }

    // 4. The effective automation policy now reflects v2.
    const effective = await app!.inject({
      method: "GET",
      url: "/v1/policies/automation",
      headers: headers(subjects.ops),
    });
    const effectiveBody = EffectiveAutomationPolicyResponseSchema.parse(
      effective.json(),
    );

    expect(effectiveBody.configured).toBe(true);
    expect(effectiveBody.policy_version_id).toBe(versionTwoId);
    expect(effectiveBody.auto_send_enabled).toBe(true);
    expect(effectiveBody.auto_send_allowed_topics).toEqual(["faq"]);

    // 5. Activating a second automation policy archives the predecessor.
    const policyBId = `${fixturePrefix}_pol_auto_b`;
    const createdB = await app!.inject({
      method: "POST",
      url: "/v1/policies",
      headers: headers(subjects.ops),
      payload: {
        policy_id: policyBId,
        name: `${fixturePrefix} automation B`,
        domain: "automation",
        content: { auto_send_enabled: false, auto_send_allowed_topics: [] },
      },
    });
    const createdBBody = PolicyCreateResponseSchema.parse(createdB.json());
    const activatedB = await app!.inject({
      method: "POST",
      url: `/v1/policy-versions/${createdBBody.policy_version.policy_version_id}/activate`,
      headers: headers(subjects.ops),
    });
    const activatedBBody = PolicyActivationResponseSchema.parse(
      activatedB.json(),
    );

    expect(activatedB.statusCode).toBe(200);
    expect(activatedBBody.archived_policy_ids).toEqual([policyAId]);

    const archivedA = await app!.inject({
      method: "GET",
      url: `/v1/policies/${policyAId}`,
      headers: headers(subjects.ops),
    });
    expect(
      PolicyResourceResponseSchema.parse(archivedA.json()).policy.status,
    ).toBe("archived");

    // 6. Version list reads back (newest first).
    const versions = await app!.inject({
      method: "GET",
      url: `/v1/policies/${policyAId}/versions`,
      headers: headers(subjects.ops),
    });
    const versionsBody = PolicyVersionListResponseSchema.parse(versions.json());
    expect(versionsBody.policy_versions.map((row) => row.version)).toEqual([
      2, 1,
    ]);

    // 7. Manual archive of the active policy fails closed: automation
    // resolves to safe defaults again.
    const archivedB = await app!.inject({
      method: "POST",
      url: `/v1/policies/${policyBId}/archive`,
      headers: headers(subjects.ops),
    });
    expect(archivedB.statusCode).toBe(200);

    const archiveConflict = await app!.inject({
      method: "POST",
      url: `/v1/policies/${policyBId}/archive`,
      headers: headers(subjects.ops),
    });
    expect(archiveConflict.statusCode).toBe(409);

    const unconfigured = await app!.inject({
      method: "GET",
      url: "/v1/policies/automation",
      headers: headers(subjects.ops),
    });
    const unconfiguredBody = EffectiveAutomationPolicyResponseSchema.parse(
      unconfigured.json(),
    );
    expect(unconfiguredBody.configured).toBe(false);
    expect(unconfiguredBody.auto_send_enabled).toBe(false);

    // 8. The reserved policy.* audit actions were emitted with the acting
    // user attributed.
    const audits = await app!.inject({
      method: "GET",
      url: `/v1/audit-events?entity_type=policy&limit=100`,
      headers: headers(subjects.ops),
    });
    const auditBody = AuditEventListResponseSchema.parse(audits.json());
    const forPolicyA = auditBody.audit_events.filter(
      (event) => event.entity_id === policyAId,
    );
    const actions = forPolicyA.map((event) => event.action).sort();

    expect(actions).toEqual([
      "policy.activated",
      "policy.archived",
      "policy.created",
      "policy.created",
    ]);
    for (const event of forPolicyA) {
      expect(event.actor_type).toBe("human");
      expect(event.actor_id).toBe(ids.opsUser);
    }
  });
});

async function seedFixtures(db: ReturnType<typeof createDatabase>) {
  await db.insert(tenants).values([
    {
      tenantId: ids.tenantA,
      name: `${fixturePrefix} Tenant A`,
      retentionPolicy: { raw_payload_days: 30 },
    },
    {
      tenantId: ids.tenantB,
      name: `${fixturePrefix} Tenant B`,
    },
  ]);

  await db.insert(roles).values([
    { roleId: ids.roleOpsA, tenantId: ids.tenantA, name: "ops_admin" },
    { roleId: ids.roleOpsB, tenantId: ids.tenantB, name: "ops_admin" },
    { roleId: ids.rolePlatform, tenantId: ids.tenantA, name: "platform_admin" },
  ]);

  await db.insert(users).values([
    {
      userId: ids.opsUser,
      tenantId: ids.tenantA,
      email: `${fixturePrefix}.ops@example.test`,
      displayName: "Auth IT Ops Admin",
      status: "active",
      idpSubject: subjects.ops,
    },
    {
      userId: ids.otherTenantUser,
      tenantId: ids.tenantB,
      email: `${fixturePrefix}.other@example.test`,
      displayName: "Auth IT Other Tenant",
      status: "active",
      idpSubject: subjects.other,
    },
    {
      userId: ids.suspendedUser,
      tenantId: ids.tenantA,
      email: `${fixturePrefix}.suspended@example.test`,
      displayName: "Auth IT Suspended",
      status: "suspended",
      idpSubject: subjects.suspended,
    },
    {
      userId: ids.platformUser,
      tenantId: null,
      email: `${fixturePrefix}.platform@example.test`,
      displayName: "Auth IT Platform Admin",
      status: "active",
      idpSubject: subjects.platform,
    },
  ]);

  await db.insert(userRoles).values([
    {
      userRoleId: `${fixturePrefix}_usrrole_ops`,
      tenantId: ids.tenantA,
      userId: ids.opsUser,
      roleId: ids.roleOpsA,
    },
    {
      userRoleId: `${fixturePrefix}_usrrole_other`,
      tenantId: ids.tenantB,
      userId: ids.otherTenantUser,
      roleId: ids.roleOpsB,
    },
    {
      userRoleId: `${fixturePrefix}_usrrole_suspended`,
      tenantId: ids.tenantA,
      userId: ids.suspendedUser,
      roleId: ids.roleOpsA,
    },
    // Global grant (NULL tenant): platform-level users hold their roles
    // across all tenants.
    {
      userRoleId: `${fixturePrefix}_usrrole_platform`,
      tenantId: null,
      userId: ids.platformUser,
      roleId: ids.rolePlatform,
    },
  ]);
}

async function cleanupFixtures(client: PostgresClient) {
  await client`
    delete from audit_events
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from policy_versions
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from tenant_policies
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from user_roles
    where user_id like ${`${fixturePrefix}%`}
  `;
  await client`
    delete from users
    where user_id like ${`${fixturePrefix}%`}
  `;
  await client`
    delete from roles
    where role_id like ${`${fixturePrefix}%`}
  `;
  await client`
    delete from tenants
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
}
