import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CustomerCreateRequestSchema,
  CustomerListResponseSchema,
  CustomerResourceResponseSchema,
  CustomerUpdateRequestSchema,
  TenantResourceResponseSchema,
  TenantCreateRequestSchema,
  TenantListResponseSchema,
  TenantUpdateRequestSchema,
  TicketCreateRequestSchema,
  TicketListResponseSchema,
  TicketResourceResponseSchema,
  TicketStatusSchema,
  TicketUpdateRequestSchema,
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

const ListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const CustomerListQuerySchema = ListQuerySchema.extend({
  email: z.string().email().optional(),
  external_customer_ref: z.string().min(1).optional(),
});

const TicketListQuerySchema = ListQuerySchema.extend({
  status: TicketStatusSchema.optional(),
  customer_id: z.string().min(1).optional(),
  assigned_queue: z.string().min(1).optional(),
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

  app.get("/v1/tenants", async (request) => {
    const context = requireAuthenticatedRequestContext(request);

    requirePermission(context.actor, "tenants:list");

    const query = parseQuery(ListQuerySchema, request);
    const tenants = await services.tenants.list(context, query);

    return TenantListResponseSchema.parse(tenants);
  });

  app.post("/v1/tenants", async (request, reply) => {
    const context = requireAuthenticatedRequestContext(request);

    requirePermission(context.actor, "tenants:create");

    const input = parseBody(TenantCreateRequestSchema, request);
    const tenant = await services.tenants.create(context, input);

    reply.status(201);
    return TenantResourceResponseSchema.parse({ tenant });
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

  app.patch("/v1/tenants/:tenant_id", async (request) => {
    const context = requireAuthenticatedRequestContext(request);

    requirePermission(context.actor, "tenants:update");

    const { tenant_id: tenantId } = parseParams(TenantParamsSchema, request);

    if (!isPlatformAdmin(context.actor.roles)) {
      const tenantContext = requireTenantRequestContext(request);

      if (tenantId !== tenantContext.tenant.tenantId) {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Tenant path does not match request tenant context.",
        );
      }
    }

    const input = parseBody(TenantUpdateRequestSchema, request);
    const tenant = await services.tenants.update(context, tenantId, input);

    if (!tenant) {
      throw new HttpError(404, "TENANT_NOT_FOUND", "Tenant was not found.");
    }

    return TenantResourceResponseSchema.parse({ tenant });
  });

  app.get("/v1/customers", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "customers:read");

    const query = parseQuery(CustomerListQuerySchema, request);
    const customers = await services.customers.list(context, query);

    return CustomerListResponseSchema.parse(customers);
  });

  app.post("/v1/customers", async (request, reply) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "customers:create");

    const input = parseBody(CustomerCreateRequestSchema, request);
    const customer = await services.customers.create(context, input);

    reply.status(201);
    return CustomerResourceResponseSchema.parse({ customer });
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

  app.patch("/v1/customers/:customer_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "customers:update");

    const { customer_id: customerId } = parseParams(
      CustomerParamsSchema,
      request,
    );
    const input = parseBody(CustomerUpdateRequestSchema, request);
    const customer = await services.customers.update(
      context,
      customerId,
      input,
    );

    if (!customer) {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "Customer was not found.");
    }

    return CustomerResourceResponseSchema.parse({ customer });
  });

  app.get("/v1/tickets", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "tickets:read");

    const query = parseQuery(TicketListQuerySchema, request);
    const tickets = await services.tickets.list(context, query);

    return TicketListResponseSchema.parse(tickets);
  });

  app.post("/v1/tickets", async (request, reply) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "tickets:create");

    const input = parseBody(TicketCreateRequestSchema, request);
    const ticket = await services.tickets.create(context, input);

    if (!ticket) {
      throw new HttpError(
        404,
        "RESOURCE_NOT_FOUND",
        "Related customer or conversation was not found for this tenant.",
      );
    }

    reply.status(201);
    return TicketResourceResponseSchema.parse({ ticket });
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

  app.patch("/v1/tickets/:ticket_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "tickets:update");

    const { ticket_id: ticketId } = parseParams(TicketParamsSchema, request);
    const input = parseBody(TicketUpdateRequestSchema, request);
    const ticket = await services.tickets.update(context, ticketId, input);

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

function parseQuery<T extends z.ZodType>(
  schema: T,
  request: FastifyRequest,
): z.infer<T> {
  const parsed = schema.safeParse(request.query);

  if (!parsed.success) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Request query is invalid.",
      parsed.error.issues,
    );
  }

  return parsed.data;
}

function parseBody<T extends z.ZodType>(
  schema: T,
  request: FastifyRequest,
): z.infer<T> {
  const parsed = schema.safeParse(request.body);

  if (!parsed.success) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Request body is invalid.",
      parsed.error.issues,
    );
  }

  return parsed.data;
}

function isPlatformAdmin(roles: readonly string[]): boolean {
  return roles.includes("platform_admin");
}
