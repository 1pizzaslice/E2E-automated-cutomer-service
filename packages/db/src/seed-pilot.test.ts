import { describe, expect, it } from "vitest";
import {
  AutomationPolicyContentSchema,
  TenantRetentionPolicySchema,
} from "@support/shared-schemas";
import { buildPilotSeedPlan } from "./seed-pilot.js";

const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

describe("pilot tenant seed plan", () => {
  const now = () => new Date("2026-07-04T00:00:00.000Z");

  it("is deterministic for a fixed clock", () => {
    expect(buildPilotSeedPlan({ now })).toEqual(buildPilotSeedPlan({ now }));
  });

  it("seeds the pilot tenant with a valid retention policy", () => {
    const plan = buildPilotSeedPlan({ now });

    expect(plan.tenant.tenantId).toBe("ten_pilot");
    expect(plan.tenant.status).toBe("active");
    expect(
      TenantRetentionPolicySchema.parse(plan.tenant.retentionPolicy),
    ).toMatchObject({ raw_payload_days: 90 });
  });

  it("seeds all six global roles and tenant-scoped users with role links", () => {
    const plan = buildPilotSeedPlan({ now });

    expect(plan.globalRoles.map((role) => role.name).sort()).toEqual([
      "client_viewer",
      "integration_admin",
      "ops_admin",
      "platform_admin",
      "qa_reviewer",
      "support_agent",
    ]);
    for (const role of plan.globalRoles) {
      expect(role.tenantId).toBeNull();
    }

    const roleIds = new Set(plan.globalRoles.map((role) => role.roleId));
    const userIds = new Set(plan.users.map((user) => user.userId));
    expect(plan.users.length).toBeGreaterThanOrEqual(3);
    for (const user of plan.users) {
      expect(user.tenantId).toBe("ten_pilot");
    }
    for (const link of plan.userRoles) {
      expect(userIds.has(link.userId ?? "")).toBe(true);
      expect(roleIds.has(link.roleId ?? "")).toBe(true);
    }
  });

  it("links seeded users to IdP subjects only when provided", () => {
    const unlinked = buildPilotSeedPlan({ now });
    for (const user of unlinked.users) {
      expect(user.idpSubject).toBeNull();
    }

    const linked = buildPilotSeedPlan({
      now,
      idpSubjects: { ops: "user_clerk_ops" },
    });
    const opsUser = linked.users.find(
      (user) => user.userId === "usr_pilot_ops",
    );
    const agentUser = linked.users.find(
      (user) => user.userId === "usr_pilot_agent",
    );

    expect(opsUser?.idpSubject).toBe("user_clerk_ops");
    expect(agentUser?.idpSubject).toBeNull();
  });

  it("stores channel secrets as environment variable names, never values", () => {
    const plan = buildPilotSeedPlan({ now });
    const [channel] = plan.channels;

    expect(channel).toBeDefined();
    const config = channel?.config as Record<string, unknown>;
    expect(config.signature_secret_ref).toMatch(ENV_VAR_NAME_PATTERN);
    expect(config.send_credential_ref).toMatch(ENV_VAR_NAME_PATTERN);
    for (const value of Object.values(config)) {
      expect(typeof value).toBe("string");
      expect(String(value)).not.toMatch(/key-[0-9a-f]/i);
    }
  });

  it("seeds an active automation policy with auto-send disabled", () => {
    const plan = buildPilotSeedPlan({ now });

    const automationPolicy = plan.tenantPolicies.find(
      (policy) => policy.domain === "automation",
    );
    expect(automationPolicy?.status).toBe("active");

    const automationVersion = plan.policyVersions.find(
      (version) => version.policyId === automationPolicy?.policyId,
    );
    expect(automationVersion?.activatedAt).toEqual(now());

    const content = AutomationPolicyContentSchema.parse(
      automationVersion?.content,
    );
    expect(content.auto_send_enabled).toBe(false);
    expect(content.auto_send_allowed_topics).toEqual([]);
  });

  it("seeds the six first-party global tool definitions as read-only", () => {
    const plan = buildPilotSeedPlan({ now });

    expect(plan.toolDefinitions.map((tool) => tool.name).sort()).toEqual([
      "cancellation_eligibility",
      "customer_profile_lookup",
      "kb_search",
      "order_lookup",
      "refund_eligibility",
      "shipment_tracking_lookup",
    ]);
    for (const tool of plan.toolDefinitions) {
      expect(tool.tenantId).toBeNull();
      expect(tool.sideEffectClass).toBe("read_only");
      expect(tool.requiresHumanApproval).toBe(false);
      expect(tool.status).toBe("active");
      expect(tool.timeoutMs).toBeGreaterThan(0);
    }
  });

  it("supports a custom tenant id for non-default pilots", () => {
    const plan = buildPilotSeedPlan({ tenantId: "ten_pilot_two", now });

    expect(plan.tenant.tenantId).toBe("ten_pilot_two");
    for (const user of plan.users) {
      expect(user.tenantId).toBe("ten_pilot_two");
    }
    for (const policy of plan.tenantPolicies) {
      expect(policy.tenantId).toBe("ten_pilot_two");
    }
  });
});
