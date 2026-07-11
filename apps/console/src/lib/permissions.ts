import type { SessionIdentityResponse } from "@support/shared-schemas";

/**
 * The API permissions the console gates navigation and actions on. These are
 * the same strings the server's `ROLE_PERMISSIONS` grants (packages/api
 * `rbac.ts`); the console never replicates the role→permission table — it reads
 * the caller's effective `permissions` from `GET /v1/me` and checks membership.
 * The API remains the real authority; this gate is a courtesy that keeps the UI
 * from offering actions the server would reject.
 */
export const PERMISSION = {
  approvalsRead: "approvals:read",
  approvalsReview: "approvals:review",
  aiRunsRead: "ai_runs:read",
  qaReviewsRead: "qa_reviews:read",
  qaReviewsWrite: "qa_reviews:write",
} as const;

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

export function can(
  identity: SessionIdentityResponse,
  permission: Permission,
): boolean {
  return identity.permissions.includes(permission);
}
