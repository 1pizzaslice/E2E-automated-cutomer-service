import type { FastifyInstance } from "fastify";
import {
  InternalToolExecuteRequestSchema,
  InternalToolExecuteResponseSchema,
} from "@support/shared-schemas";
import { requireAuthenticatedRequestContext } from "./request-context.js";
import { requirePermission } from "./rbac.js";
import { parseBody } from "./routes.js";
import type { ToolExecutor } from "./tool-registry.js";

export interface InternalRouteDependencies {
  readonly toolExecutor: ToolExecutor;
}

/**
 * Service-to-service routes for the AI runtime sidecar (Milestone 14). They
 * live outside `/v1/*` because they are never exposed through the user
 * gateway: the caller is the machine principal minted from the internal
 * bearer token, tenant context arrives in the request body (not headers), and
 * `tools:execute_internal` is held by no user role. Every tool outcome —
 * succeeded, failed, or blocked — returns HTTP 200 with the Milestone 8
 * result envelope carrying the status; HTTP errors are reserved for auth
 * (401/403) and body validation (400).
 */
export function registerInternalRoutes(
  app: FastifyInstance,
  deps: InternalRouteDependencies,
): void {
  app.post("/internal/tools/execute", async (request) => {
    const context = requireAuthenticatedRequestContext(request);

    requirePermission(context.actor, "tools:execute_internal");

    const body = parseBody(InternalToolExecuteRequestSchema, request);
    const result = await deps.toolExecutor.execute(
      {
        tenantId: body.tenant_id,
        ticketId: body.ticket_id,
        aiRunId: body.ai_run_id,
        grantedPermissions: body.granted_permissions,
      },
      body.request,
    );

    return InternalToolExecuteResponseSchema.parse(result);
  });
}
