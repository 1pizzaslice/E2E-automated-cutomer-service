export function buildOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Support Operations API",
      version: "0.1.0",
    },
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          security: [],
          responses: {
            "200": {
              description: "Service health status",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthResponse" },
                },
              },
            },
          },
        },
      },
      "/ready": {
        get: {
          summary: "Readiness check",
          security: [],
          responses: {
            "200": {
              description: "Service readiness status",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/tenants/{tenant_id}": {
        get: {
          summary: "Read the current tenant",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "tenant_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Tenant resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TenantResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/customers/{customer_id}": {
        get: {
          summary: "Read a tenant-scoped customer",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "customer_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Customer resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CustomerResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/tickets/{ticket_id}": {
        get: {
          summary: "Read a tenant-scoped ticket",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "ticket_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Ticket resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TicketResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
      parameters: {
        TenantHeader: {
          name: "x-tenant-id",
          in: "header",
          required: true,
          schema: { type: "string", minLength: 1 },
        },
        RequestIdHeader: {
          name: "x-request-id",
          in: "header",
          required: false,
          schema: { type: "string", minLength: 1 },
        },
      },
      responses: {
        Error: {
          description: "Structured API error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ApiError" },
            },
          },
        },
      },
      schemas: {
        HealthResponse: {
          type: "object",
          required: ["service", "status", "timestamp", "version"],
          properties: {
            service: {
              enum: ["api", "workers", "ai-runtime", "db", "integrations"],
            },
            status: { enum: ["ok", "degraded", "down"] },
            timestamp: { type: "string", format: "date-time" },
            version: { type: "string" },
          },
        },
        ApiError: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message", "details", "request_id"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: { type: "array", items: {} },
                request_id: { type: "string" },
              },
            },
          },
        },
        TenantResource: {
          type: "object",
          required: ["tenant"],
          properties: {
            tenant: { $ref: "#/components/schemas/Tenant" },
          },
        },
        Tenant: {
          type: "object",
          required: [
            "tenant_id",
            "name",
            "status",
            "default_timezone",
            "created_at",
            "updated_at",
          ],
          properties: {
            tenant_id: { type: "string" },
            name: { type: "string" },
            status: { enum: ["active", "suspended", "archived"] },
            default_timezone: { type: "string" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        CustomerResource: {
          type: "object",
          required: ["customer"],
          properties: {
            customer: { $ref: "#/components/schemas/Customer" },
          },
        },
        Customer: {
          type: "object",
          required: [
            "customer_id",
            "tenant_id",
            "display_name",
            "email",
            "phone",
            "external_customer_ref",
            "metadata",
            "created_at",
            "updated_at",
          ],
          properties: {
            customer_id: { type: "string" },
            tenant_id: { type: "string" },
            display_name: { type: ["string", "null"] },
            email: { type: ["string", "null"], format: "email" },
            phone: { type: ["string", "null"] },
            external_customer_ref: { type: ["string", "null"] },
            metadata: { type: "object", additionalProperties: true },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        TicketResource: {
          type: "object",
          required: ["ticket"],
          properties: {
            ticket: { $ref: "#/components/schemas/Ticket" },
          },
        },
        Ticket: {
          type: "object",
          required: [
            "ticket_id",
            "tenant_id",
            "conversation_id",
            "customer_id",
            "status",
            "priority",
            "automation_mode",
            "opened_at",
            "created_at",
            "updated_at",
          ],
          properties: {
            ticket_id: { type: "string" },
            tenant_id: { type: "string" },
            conversation_id: { type: "string" },
            customer_id: { type: "string" },
            status: {
              enum: [
                "new",
                "triaged",
                "waiting_ai",
                "waiting_human",
                "waiting_customer",
                "resolved",
                "closed",
                "reopened",
                "failed",
              ],
            },
            priority: { enum: ["p0", "p1", "p2", "p3"] },
            topic: { type: ["string", "null"] },
            subtopic: { type: ["string", "null"] },
            language: { type: ["string", "null"] },
            sentiment: { type: ["string", "null"] },
            urgency_score: { type: ["integer", "null"] },
            automation_mode: {
              enum: ["auto_send", "human_approve", "human_only"],
            },
            assigned_queue: { type: ["string", "null"] },
            assigned_user_id: { type: ["string", "null"] },
            sla_policy_id: { type: ["string", "null"] },
            policy_version_id: { type: ["string", "null"] },
            opened_at: { type: "string", format: "date-time" },
            first_response_due_at: {
              type: ["string", "null"],
              format: "date-time",
            },
            next_response_due_at: {
              type: ["string", "null"],
              format: "date-time",
            },
            resolution_due_at: {
              type: ["string", "null"],
              format: "date-time",
            },
            resolved_at: { type: ["string", "null"], format: "date-time" },
            closed_at: { type: ["string", "null"], format: "date-time" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
      },
    },
  };
}
