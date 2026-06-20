import type { RoleName } from "@support/shared-schemas";
import { HttpError } from "./errors.js";
import type { AuthContext } from "./request-context.js";

export type ApiPermission =
  | "openapi:read"
  | "tenants:read"
  | "customers:read"
  | "tickets:read";

const ROLE_PERMISSIONS: Readonly<Record<RoleName, ReadonlySet<ApiPermission>>> =
  {
    platform_admin: new Set([
      "openapi:read",
      "tenants:read",
      "customers:read",
      "tickets:read",
    ]),
    ops_admin: new Set([
      "openapi:read",
      "tenants:read",
      "customers:read",
      "tickets:read",
    ]),
    support_agent: new Set(["openapi:read", "customers:read", "tickets:read"]),
    qa_reviewer: new Set(["openapi:read", "customers:read", "tickets:read"]),
    client_viewer: new Set(["openapi:read", "customers:read", "tickets:read"]),
    integration_admin: new Set(["openapi:read"]),
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
