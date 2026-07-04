import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { RoleNameSchema, type RoleName } from "@support/shared-schemas";
import { HttpError } from "./errors.js";
import {
  INTERNAL_SERVICE_USER_ID,
  isInternalServiceToken,
  type InternalAuthConfig,
} from "./internal-auth.js";

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

export interface AuthenticatedRequestContext extends RequestContext {
  readonly actor: AuthContext;
}

export interface TenantRequestContext extends RequestContext {
  readonly actor: AuthContext;
  readonly tenant: TenantContext;
}

declare module "fastify" {
  interface FastifyRequest {
    requestContext?: RequestContext;
    rawBody?: Buffer;
  }
}

const HEALTH_PATHS = new Set(["/health", "/ready"]);

// Provider webhooks authenticate by signature over the raw request body, not by
// bearer token, so they are exempt from the actor/tenant auth requirement. The
// webhook handler resolves tenant/channel and verifies the signature itself.
const WEBHOOK_PATH_PREFIX = "/v1/webhooks/";

export interface RegisterRequestContextOptions {
  /**
   * Machine-token auth for the AI runtime sidecar. When configured and a
   * request's bearer token matches (constant-time), the actor becomes the
   * `internal_service` principal and the `x-user-id`/`x-user-roles` headers
   * are ignored. Omitted/undefined disables machine auth entirely.
   */
  readonly internalAuth?: InternalAuthConfig;
}

export function registerRequestContext(
  app: FastifyInstance,
  options: RegisterRequestContextOptions = {},
): void {
  app.addHook("onRequest", async (request, reply) => {
    const requestId = readHeader(request, "x-request-id") ?? randomUUID();
    const correlationId = readHeader(request, "x-correlation-id") ?? requestId;
    const path = getPathname(request.url);

    request.requestContext = { requestId, correlationId };
    reply.header("x-request-id", requestId);
    reply.header("x-correlation-id", correlationId);

    if (HEALTH_PATHS.has(path) || path.startsWith(WEBHOOK_PATH_PREFIX)) {
      return;
    }

    const actor = readAuthContext(request, options.internalAuth);
    // `/internal/*` routes are not tenant-scoped by header: the tenant arrives
    // in the request body and is enforced by the tool registry, so only /v1/*
    // requests (including those from the machine actor) read `x-tenant-id`.
    const tenant = path.startsWith("/v1/")
      ? readOptionalTenantContext(request)
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
  const context = requireAuthenticatedRequestContext(request);

  if (!context.tenant) {
    throw new HttpError(
      400,
      "TENANT_CONTEXT_REQUIRED",
      "Tenant context is required.",
    );
  }

  return context as TenantRequestContext;
}

export function requireAuthenticatedRequestContext(
  request: FastifyRequest,
): AuthenticatedRequestContext {
  const context = request.requestContext;

  if (!context?.actor) {
    throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
  }

  return context as AuthenticatedRequestContext;
}

function readAuthContext(
  request: FastifyRequest,
  internalAuth?: InternalAuthConfig,
): AuthContext {
  const authorization = readHeader(request, "authorization");

  if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
    throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
  }

  // Machine-token path: the AI runtime sidecar presents the shared internal
  // token as its bearer credential. On a constant-time match the actor is the
  // internal service principal; identity headers from the request are ignored
  // so a caller cannot decorate the machine actor with arbitrary claims.
  if (internalAuth) {
    const presented = authorization.slice("Bearer ".length).trim();

    if (isInternalServiceToken(internalAuth, presented)) {
      return {
        userId: INTERNAL_SERVICE_USER_ID,
        roles: ["internal_service"],
      };
    }
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

function readOptionalTenantContext(
  request: FastifyRequest,
): TenantContext | undefined {
  const tenantId = readHeader(request, "x-tenant-id");

  return tenantId ? { tenantId } : undefined;
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

/**
 * Roles come only from the trusted `x-user-roles` header — there is no
 * default role. A request without any parseable role is unauthenticated
 * (deny-by-default, Milestone 12): granting `support_agent` implicitly would
 * let a misconfigured gateway mint write access.
 */
function parseRoles(header: string | undefined): RoleName[] {
  if (!header) {
    throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
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

    // `internal_service` is reserved for the machine token verified in
    // readAuthContext — a gateway must never mint it via headers. A request
    // claiming it here is treated as unauthenticated, not merely unauthorized.
    if (result.data === "internal_service") {
      throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
    }

    roles.push(result.data);
  }

  if (roles.length === 0) {
    throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
  }

  return roles;
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
