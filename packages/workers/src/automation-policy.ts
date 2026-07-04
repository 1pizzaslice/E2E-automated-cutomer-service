import {
  activeAutomationPolicyVersionQuery,
  createDatabaseFromEnv,
  withTenantTransaction,
} from "@support/db";
import { AutomationPolicyContentSchema } from "@support/shared-schemas";
import type { RunAiGraphActivityResult } from "./workflows/ticket-lifecycle-types.js";

/**
 * Auto-send allowlist controls (Milestone 12). The tenant's automation policy
 * lives in the active `automation`-domain `policy_versions.content` row; this
 * module resolves it and provides the single eligibility gate any future
 * auto-send branch MUST consult before sending without human approval. The
 * v1 ticket lifecycle workflow does not auto-send at all — every outbound
 * message still requires an approval signal — so today this gate is exercised
 * by tests and the `GET /v1/policies/automation` read surface, and it fails
 * closed: no policy, a malformed policy, or a kill-switched policy all
 * resolve to "not eligible".
 */
export interface ResolvedAutomationPolicy {
  readonly configured: boolean;
  readonly policyVersionId: string | null;
  readonly autoSendEnabled: boolean;
  readonly autoSendAllowedTopics: readonly string[];
}

export const DISABLED_AUTOMATION_POLICY: ResolvedAutomationPolicy = {
  configured: false,
  policyVersionId: null,
  autoSendEnabled: false,
  autoSendAllowedTopics: [],
};

export interface AutomationPolicyStore {
  getActiveAutomationPolicy(
    tenantId: string,
  ): Promise<ResolvedAutomationPolicy>;
  close?(): Promise<void>;
}

export function createDatabaseAutomationPolicyStore(): AutomationPolicyStore {
  let database: ReturnType<typeof createDatabaseFromEnv> | undefined;

  function getDatabase() {
    database ??= createDatabaseFromEnv();
    return database;
  }

  return {
    async getActiveAutomationPolicy(tenantId) {
      const scope = { tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await activeAutomationPolicyVersionQuery(db, scope);
        const row = rows[0];

        if (!row) {
          return DISABLED_AUTOMATION_POLICY;
        }

        const content = AutomationPolicyContentSchema.safeParse(row.content);
        if (!content.success) {
          // A malformed automation policy must fail closed, never open.
          return DISABLED_AUTOMATION_POLICY;
        }

        return {
          configured: true,
          policyVersionId: row.policyVersionId,
          autoSendEnabled: content.data.auto_send_enabled,
          autoSendAllowedTopics: content.data.auto_send_allowed_topics,
        };
      });
    },

    async close() {
      await database?.client.end();
    },
  };
}

export function createInMemoryAutomationPolicyStore(
  policies: Readonly<Record<string, ResolvedAutomationPolicy>> = {},
): AutomationPolicyStore {
  return {
    async getActiveAutomationPolicy(tenantId) {
      return policies[tenantId] ?? DISABLED_AUTOMATION_POLICY;
    },
  };
}

export type AutoSendIneligibilityReason =
  | "auto_send_disabled"
  | "ai_run_not_succeeded"
  | "ai_did_not_recommend_auto_send"
  | "no_topic"
  | "topic_not_allowlisted"
  | "risk_not_low"
  | "guardrails_not_passed"
  | "no_draft";

export type AutoSendEligibility =
  | {
      readonly eligible: true;
      readonly topic: string;
      readonly policyVersionId: string | null;
    }
  | {
      readonly eligible: false;
      readonly reasonCode: AutoSendIneligibilityReason;
    };

/**
 * The auto-send gate: eligible only when the tenant kill switch is on, the
 * AI run succeeded with an explicit `auto_send` recommendation at low risk,
 * guardrails passed, a draft exists, and the classified topic is on the
 * tenant allowlist. Every check fails closed toward human approval.
 */
export function evaluateAutoSendEligibility(
  policy: ResolvedAutomationPolicy,
  aiResult: RunAiGraphActivityResult,
): AutoSendEligibility {
  if (!policy.autoSendEnabled) {
    return { eligible: false, reasonCode: "auto_send_disabled" };
  }

  if (aiResult.status !== "succeeded") {
    return { eligible: false, reasonCode: "ai_run_not_succeeded" };
  }

  if (aiResult.final_recommendation.automation_mode !== "auto_send") {
    return { eligible: false, reasonCode: "ai_did_not_recommend_auto_send" };
  }

  if (aiResult.final_recommendation.risk_level !== "low") {
    return { eligible: false, reasonCode: "risk_not_low" };
  }

  if (aiResult.guardrails["passed"] !== true) {
    return { eligible: false, reasonCode: "guardrails_not_passed" };
  }

  if (!aiResult.draft) {
    return { eligible: false, reasonCode: "no_draft" };
  }

  const topic = aiResult.routing_decision.topic;
  if (!topic) {
    return { eligible: false, reasonCode: "no_topic" };
  }

  if (!policy.autoSendAllowedTopics.includes(topic)) {
    return { eligible: false, reasonCode: "topic_not_allowlisted" };
  }

  return {
    eligible: true,
    topic,
    policyVersionId: policy.policyVersionId,
  };
}
