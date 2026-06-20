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
      "/v1/tenants": {
        get: {
          summary: "List tenants",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/LimitQuery" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Tenant list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TenantList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
        post: {
          summary: "Create a tenant",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/RequestIdHeader" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TenantCreateRequest" },
              },
            },
          },
          responses: {
            "201": {
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
        patch: {
          summary: "Update a tenant",
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
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TenantUpdateRequest" },
              },
            },
          },
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
      "/v1/customers": {
        get: {
          summary: "List tenant-scoped customers",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            {
              name: "email",
              in: "query",
              required: false,
              schema: { type: "string", format: "email" },
            },
            {
              name: "external_customer_ref",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Customer list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CustomerList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
        post: {
          summary: "Create a tenant-scoped customer",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CustomerCreateRequest" },
              },
            },
          },
          responses: {
            "201": {
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
        patch: {
          summary: "Update a tenant-scoped customer",
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
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CustomerUpdateRequest" },
              },
            },
          },
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
      "/v1/tickets": {
        get: {
          summary: "List tenant-scoped tickets",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            {
              name: "status",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/TicketStatus" },
            },
            {
              name: "customer_id",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "assigned_queue",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Ticket list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TicketList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
        post: {
          summary: "Create a tenant-scoped ticket",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TicketCreateRequest" },
              },
            },
          },
          responses: {
            "201": {
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
        patch: {
          summary: "Update tenant-scoped ticket triage fields",
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
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TicketUpdateRequest" },
              },
            },
          },
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
        LimitQuery: {
          name: "limit",
          in: "query",
          required: false,
          schema: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 50,
          },
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
        ListPage: {
          type: "object",
          required: ["count", "limit"],
          properties: {
            count: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1 },
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
        TenantList: {
          type: "object",
          required: ["tenants", "page"],
          properties: {
            tenants: {
              type: "array",
              items: { $ref: "#/components/schemas/Tenant" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        TenantCreateRequest: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            tenant_id: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
            status: { enum: ["active", "suspended", "archived"] },
            default_timezone: { type: "string", minLength: 1 },
          },
        },
        TenantUpdateRequest: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1 },
            status: { enum: ["active", "suspended", "archived"] },
            default_timezone: { type: "string", minLength: 1 },
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
        CustomerList: {
          type: "object",
          required: ["customers", "page"],
          properties: {
            customers: {
              type: "array",
              items: { $ref: "#/components/schemas/Customer" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        CustomerCreateRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            customer_id: { type: "string", minLength: 1 },
            display_name: { type: ["string", "null"], minLength: 1 },
            email: { type: ["string", "null"], format: "email" },
            phone: { type: ["string", "null"], minLength: 1 },
            external_customer_ref: {
              type: ["string", "null"],
              minLength: 1,
            },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        CustomerUpdateRequest: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            display_name: { type: ["string", "null"], minLength: 1 },
            email: { type: ["string", "null"], format: "email" },
            phone: { type: ["string", "null"], minLength: 1 },
            external_customer_ref: {
              type: ["string", "null"],
              minLength: 1,
            },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        TicketResource: {
          type: "object",
          required: ["ticket"],
          properties: {
            ticket: { $ref: "#/components/schemas/Ticket" },
          },
        },
        TicketStatus: {
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
        TicketPriority: {
          enum: ["p0", "p1", "p2", "p3"],
        },
        AutomationMode: {
          enum: ["auto_send", "human_approve", "human_only"],
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
            status: { $ref: "#/components/schemas/TicketStatus" },
            priority: { $ref: "#/components/schemas/TicketPriority" },
            topic: { type: ["string", "null"] },
            subtopic: { type: ["string", "null"] },
            language: { type: ["string", "null"] },
            sentiment: { type: ["string", "null"] },
            urgency_score: { type: ["integer", "null"] },
            automation_mode: { $ref: "#/components/schemas/AutomationMode" },
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
        TicketList: {
          type: "object",
          required: ["tickets", "page"],
          properties: {
            tickets: {
              type: "array",
              items: { $ref: "#/components/schemas/Ticket" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        TicketCreateRequest: {
          type: "object",
          required: ["conversation_id", "customer_id"],
          additionalProperties: false,
          properties: {
            ticket_id: { type: "string", minLength: 1 },
            conversation_id: { type: "string", minLength: 1 },
            customer_id: { type: "string", minLength: 1 },
            priority: { $ref: "#/components/schemas/TicketPriority" },
            topic: { type: ["string", "null"], minLength: 1 },
            subtopic: { type: ["string", "null"], minLength: 1 },
            language: { type: ["string", "null"], minLength: 1 },
            sentiment: { type: ["string", "null"], minLength: 1 },
            urgency_score: { type: ["integer", "null"] },
            automation_mode: { $ref: "#/components/schemas/AutomationMode" },
            assigned_queue: { type: ["string", "null"], minLength: 1 },
            assigned_user_id: { type: ["string", "null"], minLength: 1 },
            sla_policy_id: { type: ["string", "null"], minLength: 1 },
            policy_version_id: { type: ["string", "null"], minLength: 1 },
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
          },
        },
        TicketUpdateRequest: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            priority: { $ref: "#/components/schemas/TicketPriority" },
            topic: { type: ["string", "null"], minLength: 1 },
            subtopic: { type: ["string", "null"], minLength: 1 },
            language: { type: ["string", "null"], minLength: 1 },
            sentiment: { type: ["string", "null"], minLength: 1 },
            urgency_score: { type: ["integer", "null"] },
            automation_mode: { $ref: "#/components/schemas/AutomationMode" },
            assigned_queue: { type: ["string", "null"], minLength: 1 },
            assigned_user_id: { type: ["string", "null"], minLength: 1 },
            sla_policy_id: { type: ["string", "null"], minLength: 1 },
            policy_version_id: { type: ["string", "null"], minLength: 1 },
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
          },
        },
      },
    },
  };
}
