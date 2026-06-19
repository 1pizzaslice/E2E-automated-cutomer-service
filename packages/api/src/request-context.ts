import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { RoleNameSchema, type RoleName } from "@support/shared-schemas";
import { HttpError } from "./errors.js";

export interface AuthContext {
  readonly userId: string;
  readonly email?: string;
  readonly roles: readonly RoleName[];
}

export interface TenantContext {
  readonly tenantId: string;
}

export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly actor?: AuthContext;
  readonly tenant?: TenantContext;
}

export interface TenantRequestContext extends RequestContext {
  readonly actor: AuthContext;
  readonly tenant: TenantContext;
}

declare module "fastify" {
  interface FastifyRequest {
    requestContext?: RequestContext;
  }
}

const HEALTH_PATHS = new Set(["/health", "/ready"]);

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const requestId = readHeader(request, "x-request-id") ?? randomUUID();
    const correlationId = readHeader(request, "x-correlation-id") ?? requestId;
    const path = getPathname(request.url);

    request.requestContext = { requestId, correlationId };
    reply.header("x-request-id", requestId);
    reply.header("x-correlation-id", correlationId);

    if (HEALTH_PATHS.has(path)) {
      return;
    }

    const actor = readAuthContext(request);
    const tenant = path.startsWith("/v1/")
      ? readTenantContext(request)
      : undefined;

    request.requestContext = {
      requestId,
      correlationId,
      actor,
      tenant,
    };
  });
}

export function requireTenantRequestContext(
  request: FastifyRequest,
): TenantRequestContext {
  const context = request.requestContext;

  if (!context?.actor) {
    throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
  }

  if (!context.tenant) {
    throw new HttpError(
      400,
      "TENANT_CONTEXT_REQUIRED",
      "Tenant context is required.",
    );
  }

  return context as TenantRequestContext;
}

function readAuthContext(request: FastifyRequest): AuthContext {
  const authorization = readHeader(request, "authorization");

  if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
    throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
  }

  const userId = readRequiredHeader(request, "x-user-id", "AUTH_REQUIRED");
  const email = readHeader(request, "x-user-email");
  const roles = parseRoles(readHeader(request, "x-user-roles"));

  return {
    userId,
    ...(email ? { email } : {}),
    roles,
  };
}

function readTenantContext(request: FastifyRequest): TenantContext {
  return {
    tenantId: readRequiredHeader(
      request,
      "x-tenant-id",
      "TENANT_CONTEXT_REQUIRED",
    ),
  };
}

function readRequiredHeader(
  request: FastifyRequest,
  name: string,
  code: "AUTH_REQUIRED" | "TENANT_CONTEXT_REQUIRED",
): string {
  const value = readHeader(request, name);

  if (!value) {
    throw new HttpError(
      code === "AUTH_REQUIRED" ? 401 : 400,
      code,
      code === "AUTH_REQUIRED"
        ? "Authentication is required."
        : "Tenant context is required.",
    );
  }

  return value;
}

function parseRoles(header: string | undefined): RoleName[] {
  if (!header) {
    return ["support_agent"];
  }

  const roles: RoleName[] = [];
  const parsed = header
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role.length > 0);

  for (const role of parsed) {
    const result = RoleNameSchema.safeParse(role);

    if (!result.success) {
      throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
    }

    roles.push(result.data);
  }

  return roles.length > 0 ? roles : ["support_agent"];
}

function readHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];

  if (Array.isArray(value)) {
    return value[0]?.trim();
  }

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function getPathname(url: string): string {
  return new URL(url, "http://localhost").pathname;
}
