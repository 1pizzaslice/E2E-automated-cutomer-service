import type { RoleName } from "@support/shared-schemas";
import { HttpError } from "./errors.js";
import type { AuthContext } from "./request-context.js";

export type ApiPermission =
  | "openapi:read"
  // Read your own identity/roles/permissions (Milestone 23, GET /v1/me). Held
  // by every console-facing human role — it exposes only the caller's own
  // identity — but not integration_admin (deliberately pinned to openapi:read)
  // or internal_service (the machine principal carries no user identity).
  | "session:read"
  | "tenants:list"
  | "tenants:read"
  | "tenants:create"
  | "tenants:update"
  | "customers:read"
  | "customers:create"
  | "customers:update"
  | "conversations:read"
  | "messages:read"
  | "policies:read"
  | "policies:write"
  | "kb_documents:read"
  | "kb_documents:write"
  | "kb:search"
  | "approvals:read"
  | "approvals:review"
  | "audit_events:read"
  | "ai_runs:read"
  | "qa_reviews:read"
  | "qa_reviews:write"
  | "reports:read"
  | "tickets:read"
  | "tickets:create"
  | "tickets:update"
  | "tools:execute_internal";

/**
 * Deny-by-default role → permission matrix. Exported so the RBAC matrix test
 * can verify that every registered route enforces exactly the permission this
 * table grants — treat it as the single reviewable source of truth for API
 * access (BACKEND_SPEC section 3.2).
 */
export const ROLE_PERMISSIONS: Readonly<
  Record<RoleName, ReadonlySet<ApiPermission>>
> = {
  platform_admin: new Set([
    "openapi:read",
    "session:read",
    "tenants:list",
    "tenants:read",
    "tenants:create",
    "tenants:update",
    "customers:read",
    "customers:create",
    "customers:update",
    "conversations:read",
    "messages:read",
    "policies:read",
    "policies:write",
    "kb_documents:read",
    "kb_documents:write",
    "kb:search",
    "approvals:read",
    "approvals:review",
    "audit_events:read",
    "ai_runs:read",
    "qa_reviews:read",
    "qa_reviews:write",
    "reports:read",
    "tickets:read",
    "tickets:create",
    "tickets:update",
  ]),
  ops_admin: new Set([
    "openapi:read",
    "session:read",
    "tenants:read",
    "tenants:update",
    "customers:read",
    "customers:create",
    "customers:update",
    "conversations:read",
    "messages:read",
    "policies:read",
    // Policy lifecycle writes (Milestone 16) stay admin-only: the automation
    // domain controls the auto-send allowlist, a safety control agents and
    // reviewers must not be able to change.
    "policies:write",
    "kb_documents:read",
    "kb_documents:write",
    "kb:search",
    "approvals:read",
    "approvals:review",
    "audit_events:read",
    "ai_runs:read",
    "qa_reviews:read",
    "qa_reviews:write",
    "reports:read",
    "tickets:read",
    "tickets:create",
    "tickets:update",
  ]),
  support_agent: new Set([
    "openapi:read",
    "session:read",
    "customers:read",
    "customers:create",
    "customers:update",
    "conversations:read",
    "messages:read",
    "policies:read",
    "kb_documents:read",
    "kb_documents:write",
    "kb:search",
    "approvals:read",
    "approvals:review",
    "audit_events:read",
    "ai_runs:read",
    "qa_reviews:read",
    "tickets:read",
    "tickets:create",
    "tickets:update",
  ]),
  qa_reviewer: new Set([
    "openapi:read",
    "session:read",
    "customers:read",
    "conversations:read",
    "messages:read",
    "policies:read",
    "kb_documents:read",
    "kb:search",
    "approvals:read",
    "audit_events:read",
    "ai_runs:read",
    "qa_reviews:read",
    "qa_reviews:write",
    "reports:read",
    "tickets:read",
  ]),
  client_viewer: new Set([
    "openapi:read",
    "session:read",
    "customers:read",
    "conversations:read",
    "messages:read",
    "policies:read",
    "kb_documents:read",
    "kb:search",
    "approvals:read",
    "audit_events:read",
    "reports:read",
    "tickets:read",
  ]),
  integration_admin: new Set(["openapi:read"]),
  // Machine principal for the AI runtime sidecar (Milestone 14). It is minted
  // only by the internal bearer token (never via x-user-roles) and holds
  // exactly what the runtime needs: KB retrieval and governed tool execution.
  // No user role is ever granted tools:execute_internal.
  internal_service: new Set(["kb:search", "tools:execute_internal"]),
};

export function requirePermission(
  actor: AuthContext,
  permission: ApiPermission,
): void {
  if (hasPermission(actor, permission)) {
    return;
  }

  throw new HttpError(
    403,
    "FORBIDDEN",
    "Actor does not have permission to access this resource.",
  );
}

function hasPermission(actor: AuthContext, permission: ApiPermission): boolean {
  return actor.roles.some((role) => ROLE_PERMISSIONS[role].has(permission));
}

/**
 * The union of every permission the actor's roles grant, sorted for a stable
 * wire order. `GET /v1/me` returns this so a client (the reviewer console) can
 * gate navigation off the caller's effective permissions without replicating
 * `ROLE_PERMISSIONS`.
 */
export function permissionsForActor(actor: AuthContext): ApiPermission[] {
  const permissions = new Set<ApiPermission>();

  for (const role of actor.roles) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      permissions.add(permission);
    }
  }

  return [...permissions].sort();
}
