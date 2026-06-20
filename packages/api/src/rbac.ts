import type { RoleName } from "@support/shared-schemas";
import { HttpError } from "./errors.js";
import type { AuthContext } from "./request-context.js";

export type ApiPermission =
  | "openapi:read"
  | "tenants:list"
  | "tenants:read"
  | "tenants:create"
  | "tenants:update"
  | "customers:read"
  | "customers:create"
  | "customers:update"
  | "tickets:read"
  | "tickets:create"
  | "tickets:update";

const ROLE_PERMISSIONS: Readonly<Record<RoleName, ReadonlySet<ApiPermission>>> =
  {
    platform_admin: new Set([
      "openapi:read",
      "tenants:list",
      "tenants:read",
      "tenants:create",
      "tenants:update",
      "customers:read",
      "customers:create",
      "customers:update",
      "tickets:read",
      "tickets:create",
      "tickets:update",
    ]),
    ops_admin: new Set([
      "openapi:read",
      "tenants:read",
      "tenants:update",
      "customers:read",
      "customers:create",
      "customers:update",
      "tickets:read",
      "tickets:create",
      "tickets:update",
    ]),
    support_agent: new Set([
      "openapi:read",
      "customers:read",
      "customers:create",
      "customers:update",
      "tickets:read",
      "tickets:create",
      "tickets:update",
    ]),
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
