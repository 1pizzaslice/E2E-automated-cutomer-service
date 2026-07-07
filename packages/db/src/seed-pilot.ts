import type { SupportDatabase } from "./client.js";
import {
  channels,
  policyVersions,
  roles,
  slaPolicies,
  tenantPolicies,
  tenants,
  toolDefinitions,
  userRoles,
  users,
  type NewChannel,
  type NewPolicyVersion,
  type NewRole,
  type NewSlaPolicy,
  type NewTenant,
  type NewTenantPolicy,
  type NewToolDefinition,
  type NewUser,
  type NewUserRole,
} from "./schema.js";

/**
 * Deterministic, idempotent pilot tenant seed (Milestone 12). The plan is a
 * pure value so tests can assert its invariants (stable ids, no plaintext
 * secrets, safe automation defaults); {@link applyPilotSeed} inserts it with
 * conflict-safe semantics so re-running the seed is a no-op. Channel secrets
 * are environment-variable NAMES resolved at runtime (BACKEND_SPEC section
 * 4.1), never secret values. The automation policy ships with auto-send
 * disabled and an empty allowlist — the pilot default is human approval for
 * everything.
 */
export interface PilotSeedPlan {
  readonly tenant: NewTenant;
  readonly globalRoles: readonly NewRole[];
  readonly users: readonly NewUser[];
  readonly userRoles: readonly NewUserRole[];
  readonly channels: readonly NewChannel[];
  readonly slaPolicies: readonly NewSlaPolicy[];
  readonly tenantPolicies: readonly NewTenantPolicy[];
  readonly policyVersions: readonly NewPolicyVersion[];
  readonly toolDefinitions: readonly NewToolDefinition[];
}

export interface PilotSeedOptions {
  readonly tenantId?: string;
  readonly now?: () => Date;
  /**
   * Optional IdP subject (`sub` claim) per seeded pilot user, keyed by the
   * user suffix (`ops`/`agent`/`qa`). Links the seeded users to real hosted
   * IdP identities for production JWT auth (Milestone 16). Inserts are
   * conflict-safe, so linking an already-seeded user is an ops UPDATE, not a
   * re-run (SOPS section 1.1).
   */
  readonly idpSubjects?: Partial<Record<"ops" | "agent" | "qa", string>>;
}

export interface PilotSeedResult {
  readonly inserted: Readonly<Record<keyof PilotSeedPlan, number>>;
}

const ROLE_NAMES = [
  "platform_admin",
  "ops_admin",
  "support_agent",
  "qa_reviewer",
  "client_viewer",
  "integration_admin",
] as const;

const FIRST_PARTY_TOOLS: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly permission: string;
  readonly timeoutMs: number;
}> = [
  {
    name: "order_lookup",
    description: "Look up an order by order number for the current tenant.",
    permission: "order_read",
    timeoutMs: 2000,
  },
  {
    name: "shipment_tracking_lookup",
    description: "Look up shipment tracking status for an order.",
    permission: "order_read",
    timeoutMs: 2000,
  },
  {
    name: "refund_eligibility",
    description: "Evaluate refund eligibility for an order against policy.",
    permission: "eligibility_evaluate",
    timeoutMs: 2000,
  },
  {
    name: "cancellation_eligibility",
    description:
      "Evaluate cancellation eligibility for an order against policy.",
    permission: "eligibility_evaluate",
    timeoutMs: 2000,
  },
  {
    name: "customer_profile_lookup",
    description: "Look up the customer profile for the current ticket.",
    permission: "customer_read",
    timeoutMs: 2000,
  },
  {
    name: "kb_search",
    description:
      "Search the tenant knowledge base and return cited evidence chunks.",
    permission: "kb_read",
    timeoutMs: 5000,
  },
];

export function buildPilotSeedPlan(
  options: PilotSeedOptions = {},
): PilotSeedPlan {
  const tenantId = options.tenantId ?? "ten_pilot";
  const now = options.now ? options.now() : new Date();

  const tenant: NewTenant = {
    tenantId,
    name: "Pilot Tenant",
    status: "active",
    defaultTimezone: "UTC",
    retentionPolicy: {
      raw_payload_days: 90,
      attachment_days: 90,
      ai_run_days: 365,
    },
  };

  const globalRoles: NewRole[] = ROLE_NAMES.map((name) => ({
    roleId: `role_global_${name}`,
    tenantId: null,
    name,
  }));

  const seedUsers: ReadonlyArray<{
    readonly suffix: string;
    readonly displayName: string;
    readonly role: (typeof ROLE_NAMES)[number];
  }> = [
    { suffix: "ops", displayName: "Pilot Ops Admin", role: "ops_admin" },
    {
      suffix: "agent",
      displayName: "Pilot Support Agent",
      role: "support_agent",
    },
    { suffix: "qa", displayName: "Pilot QA Reviewer", role: "qa_reviewer" },
  ];

  const usersPlan: NewUser[] = seedUsers.map((user) => ({
    userId: `usr_pilot_${user.suffix}`,
    tenantId,
    email: `pilot-${user.suffix}@pilot.example`,
    displayName: user.displayName,
    status: "active",
    idpSubject:
      options.idpSubjects?.[user.suffix as "ops" | "agent" | "qa"] ?? null,
  }));

  const userRolesPlan: NewUserRole[] = seedUsers.map((user) => ({
    userRoleId: `usrrole_pilot_${user.suffix}`,
    tenantId,
    userId: `usr_pilot_${user.suffix}`,
    roleId: `role_global_${user.role}`,
  }));

  const channelsPlan: NewChannel[] = [
    {
      channelId: "chn_pilot_email",
      tenantId,
      type: "email",
      provider: "mailgun",
      status: "active",
      config: {
        from_address: "support@pilot.example",
        from_name: "Pilot Support",
        signature_secret_ref: "PILOT_MAILGUN_SIGNING_KEY",
        send_credential_ref: "PILOT_MAILGUN_API_KEY",
      },
    },
  ];

  const slaPoliciesPlan: NewSlaPolicy[] = [
    {
      slaPolicyId: "sla_pilot_default",
      tenantId,
      name: "Pilot default SLA",
      priority: "p2",
      firstResponseMinutes: 60,
      nextResponseMinutes: 240,
      resolutionMinutes: 1440,
      businessHours: {},
      pauseConditions: {},
      escalationRules: {},
      status: "active",
    },
  ];

  const tenantPoliciesPlan: NewTenantPolicy[] = [
    {
      policyId: "pol_pilot_automation",
      tenantId,
      name: "Pilot automation controls",
      domain: "automation",
      status: "active",
    },
    {
      policyId: "pol_pilot_refunds",
      tenantId,
      name: "Pilot refund policy",
      domain: "refunds",
      status: "active",
    },
    {
      policyId: "pol_pilot_escalation",
      tenantId,
      name: "Pilot escalation policy",
      domain: "escalation",
      status: "active",
    },
  ];

  const policyVersionsPlan: NewPolicyVersion[] = [
    {
      policyVersionId: "polv_pilot_automation_1",
      tenantId,
      policyId: "pol_pilot_automation",
      version: 1,
      content: {
        auto_send_enabled: false,
        auto_send_allowed_topics: [],
      },
      schemaVersion: "automation.v1",
      activatedAt: now,
    },
    {
      policyVersionId: "polv_pilot_refunds_1",
      tenantId,
      policyId: "pol_pilot_refunds",
      version: 1,
      content: {
        refund_window_days: 30,
        requires_order_lookup: true,
        requires_policy_evidence: true,
      },
      schemaVersion: "refunds.v1",
      activatedAt: now,
    },
    {
      policyVersionId: "polv_pilot_escalation_1",
      tenantId,
      policyId: "pol_pilot_escalation",
      version: 1,
      content: {
        hard_escalation_flags: [
          "legal_threat",
          "chargeback",
          "fraud_suspicion",
          "safety_issue",
          "prompt_injection",
        ],
      },
      schemaVersion: "escalation.v1",
      activatedAt: now,
    },
  ];

  const toolDefinitionsPlan: NewToolDefinition[] = FIRST_PARTY_TOOLS.map(
    (tool) => ({
      toolDefinitionId: `tool_global_${tool.name}`,
      tenantId: null,
      name: tool.name,
      description: tool.description,
      inputSchema: {},
      outputSchema: {},
      permission: tool.permission,
      sideEffectClass: "read_only",
      requiresHumanApproval: false,
      timeoutMs: tool.timeoutMs,
      retryPolicy: {},
      redactionPolicy: {},
      status: "active",
    }),
  );

  return {
    tenant,
    globalRoles,
    users: usersPlan,
    userRoles: userRolesPlan,
    channels: channelsPlan,
    slaPolicies: slaPoliciesPlan,
    tenantPolicies: tenantPoliciesPlan,
    policyVersions: policyVersionsPlan,
    toolDefinitions: toolDefinitionsPlan,
  };
}

/**
 * Insert the plan on the owner connection in foreign-key order. Every insert
 * is `on conflict do nothing`, so re-running the seed never duplicates or
 * overwrites rows that drifted from the plan.
 */
export async function applyPilotSeed(
  db: SupportDatabase,
  plan: PilotSeedPlan = buildPilotSeedPlan(),
): Promise<PilotSeedResult> {
  const tenantRows = await db
    .insert(tenants)
    .values(plan.tenant)
    .onConflictDoNothing()
    .returning({ id: tenants.tenantId });

  const roleRows = await db
    .insert(roles)
    .values([...plan.globalRoles])
    .onConflictDoNothing()
    .returning({ id: roles.roleId });

  const userRows = await db
    .insert(users)
    .values([...plan.users])
    .onConflictDoNothing()
    .returning({ id: users.userId });

  const userRoleRows = await db
    .insert(userRoles)
    .values([...plan.userRoles])
    .onConflictDoNothing()
    .returning({ id: userRoles.userRoleId });

  const channelRows = await db
    .insert(channels)
    .values([...plan.channels])
    .onConflictDoNothing()
    .returning({ id: channels.channelId });

  const slaPolicyRows = await db
    .insert(slaPolicies)
    .values([...plan.slaPolicies])
    .onConflictDoNothing()
    .returning({ id: slaPolicies.slaPolicyId });

  const tenantPolicyRows = await db
    .insert(tenantPolicies)
    .values([...plan.tenantPolicies])
    .onConflictDoNothing()
    .returning({ id: tenantPolicies.policyId });

  const policyVersionRows = await db
    .insert(policyVersions)
    .values([...plan.policyVersions])
    .onConflictDoNothing()
    .returning({ id: policyVersions.policyVersionId });

  const toolDefinitionRows = await db
    .insert(toolDefinitions)
    .values([...plan.toolDefinitions])
    .onConflictDoNothing()
    .returning({ id: toolDefinitions.toolDefinitionId });

  return {
    inserted: {
      tenant: tenantRows.length,
      globalRoles: roleRows.length,
      users: userRows.length,
      userRoles: userRoleRows.length,
      channels: channelRows.length,
      slaPolicies: slaPolicyRows.length,
      tenantPolicies: tenantPolicyRows.length,
      policyVersions: policyVersionRows.length,
      toolDefinitions: toolDefinitionRows.length,
    },
  };
}
