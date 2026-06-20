import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CustomerResourceResponseSchema,
  TenantResourceResponseSchema,
  TicketResourceResponseSchema,
  createHealthResponse,
} from "@support/shared-schemas";
import { HttpError } from "./errors.js";
import { buildOpenApiDocument } from "./openapi.js";
import {
  requireAuthenticatedRequestContext,
  requireTenantRequestContext,
} from "./request-context.js";
import { requirePermission } from "./rbac.js";
import type { ApiServices } from "./services.js";

const TenantParamsSchema = z.object({
  tenant_id: z.string().min(1),
});

const CustomerParamsSchema = z.object({
  customer_id: z.string().min(1),
});

const TicketParamsSchema = z.object({
  ticket_id: z.string().min(1),
});

export function registerRoutes(
  app: FastifyInstance,
  services: ApiServices,
): void {
  app.get("/health", async () => createHealthResponse("api"));
  app.get("/ready", async () => createHealthResponse("api"));
  app.get("/openapi.json", async (request) => {
    const context = requireAuthenticatedRequestContext(request);

    requirePermission(context.actor, "openapi:read");

    return buildOpenApiDocument();
  });

  app.get("/v1/tenants/:tenant_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "tenants:read");

    const { tenant_id: tenantId } = parseParams(TenantParamsSchema, request);

    if (tenantId !== context.tenant.tenantId) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Tenant path does not match request tenant context.",
      );
    }

    const tenant = await services.tenants.getById(context, tenantId);

    if (!tenant) {
      throw new HttpError(404, "TENANT_NOT_FOUND", "Tenant was not found.");
    }

    return TenantResourceResponseSchema.parse({ tenant });
  });

  app.get("/v1/customers/:customer_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "customers:read");

    const { customer_id: customerId } = parseParams(
      CustomerParamsSchema,
      request,
    );
    const customer = await services.customers.getById(context, customerId);

    if (!customer) {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "Customer was not found.");
    }

    return CustomerResourceResponseSchema.parse({ customer });
  });

  app.get("/v1/tickets/:ticket_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "tickets:read");

    const { ticket_id: ticketId } = parseParams(TicketParamsSchema, request);
    const ticket = await services.tickets.getById(context, ticketId);

    if (!ticket) {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "Ticket was not found.");
    }

    return TicketResourceResponseSchema.parse({ ticket });
  });
}

function parseParams<T extends z.ZodType>(
  schema: T,
  request: FastifyRequest,
): z.infer<T> {
  const parsed = schema.safeParse(request.params);

  if (!parsed.success) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Request parameters are invalid.",
      parsed.error.issues,
    );
  }

  return parsed.data;
}
