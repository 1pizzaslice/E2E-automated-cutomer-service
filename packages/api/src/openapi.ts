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
      "/openapi.json": {
        get: {
          summary: "Serve this OpenAPI document",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/RequestIdHeader" }],
          responses: {
            "200": {
              description: "The OpenAPI 3.1 document describing this API",
              content: { "application/json": { schema: { type: "object" } } },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/me": {
        get: {
          summary:
            "The authenticated caller's identity, roles, and permissions",
          description:
            "Tenant-optional: returns the caller's home tenant (null for platform-level users) so a reviewer console can scope subsequent requests. `x-tenant-id` is not required here.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/RequestIdHeader" }],
          responses: {
            "200": {
              description: "Session identity",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SessionIdentity" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
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
      "/v1/conversations": {
        get: {
          summary: "List tenant-scoped conversations",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            {
              name: "status",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/ConversationStatus" },
            },
            {
              name: "customer_id",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "channel_id",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Conversation list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ConversationList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/conversations/{conversation_id}": {
        get: {
          summary: "Read a tenant-scoped conversation",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "conversation_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Conversation resource",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ConversationResource",
                  },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/conversations/{conversation_id}/messages": {
        get: {
          summary: "List messages for a tenant-scoped conversation",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "conversation_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            {
              name: "direction",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/MessageDirection" },
            },
            {
              name: "ticket_id",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Message list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MessageList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/conversations/{conversation_id}/messages/{message_id}": {
        get: {
          summary: "Read a message for a tenant-scoped conversation",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "conversation_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "message_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Message resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MessageResource" },
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
            {
              name: "updated_since",
              in: "query",
              required: false,
              schema: { type: "string", format: "date-time" },
            },
            { $ref: "#/components/parameters/OffsetQuery" },
            { $ref: "#/components/parameters/SortOrderQuery" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Ticket list",
              headers: { ETag: { $ref: "#/components/headers/ETag" } },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TicketList" },
                },
              },
            },
            "304": { $ref: "#/components/responses/NotModified" },
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
      "/v1/policies": {
        get: {
          summary: "List tenant-scoped policies",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            {
              name: "domain",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/TenantPolicyDomain" },
            },
            {
              name: "status",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/TenantPolicyStatus" },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Policy list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PolicyList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
        post: {
          summary:
            "Create a policy with its version-1 draft (emits policy.created)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PolicyCreateRequest" },
              },
            },
          },
          responses: {
            "201": {
              description: "Created policy and its draft version",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PolicyCreate" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/policies/automation": {
        get: {
          summary: "Resolve the tenant's effective auto-send automation policy",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description:
                "Effective automation policy (safe defaults when unconfigured)",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/EffectiveAutomationPolicy",
                  },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/policies/{policy_id}": {
        get: {
          summary: "Read a tenant-scoped policy",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "policy_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Policy resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PolicyResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/policies/{policy_id}/versions": {
        get: {
          summary: "List a policy's versions (newest first)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "policy_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Policy version list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PolicyVersionList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
        post: {
          summary:
            "Create the next draft version of a policy (emits policy.created)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "policy_id",
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
                schema: {
                  $ref: "#/components/schemas/PolicyVersionCreateRequest",
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created draft version",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PolicyVersionResource",
                  },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/policy-versions/{policy_version_id}/activate": {
        post: {
          summary:
            "Activate a draft policy version (immutable once active; archives same-domain predecessors; emits policy.activated)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "policy_version_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Activation result",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PolicyActivation" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/policies/{policy_id}/archive": {
        post: {
          summary: "Archive a policy (emits policy.archived)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "policy_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Archived policy resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PolicyResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/reports/pilot-weekly": {
        get: {
          summary: "Weekly pilot review report (SOPS section 14 metrics)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            {
              name: "since",
              in: "query",
              required: false,
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "until",
              in: "query",
              required: false,
              schema: { type: "string", format: "date-time" },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description:
                "Weekly pilot report (defaults to the trailing seven days)",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/WeeklyPilotReportResponse",
                  },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/kb/documents": {
        get: {
          summary: "List tenant-scoped KB documents",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            {
              name: "source_type",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/KbDocumentSourceType" },
            },
            {
              name: "document_type",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/KbDocumentType" },
            },
            {
              name: "status",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/KbStatus" },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "KB document list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/KbDocumentList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
        post: {
          summary: "Create a tenant-scoped KB document",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/KbDocumentCreateRequest",
                },
              },
            },
          },
          responses: {
            "201": {
              description: "KB document resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/KbDocumentResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/kb/documents/{kb_document_id}": {
        get: {
          summary: "Read a tenant-scoped KB document",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "kb_document_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "KB document resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/KbDocumentResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
        patch: {
          summary: "Update tenant-scoped KB document metadata or status",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "kb_document_id",
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
                schema: {
                  $ref: "#/components/schemas/KbDocumentUpdateRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "KB document resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/KbDocumentResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/kb/documents/{kb_document_id}/ingest": {
        post: {
          summary: "Chunk, embed, and activate a tenant-scoped KB document",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "kb_document_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "KB ingestion result",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/KbIngestionResult" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/kb/search": {
        post: {
          summary: "Tenant-scoped KB retrieval over active chunks",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KbSearchRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Ranked KB chunk citations",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/KbSearchResponse" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/approvals": {
        get: {
          summary: "List tenant-scoped approvals",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            {
              name: "status",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/ApprovalStatus" },
            },
            {
              name: "ticket_id",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "approval_type",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/ApprovalType" },
            },
            { $ref: "#/components/parameters/OffsetQuery" },
            { $ref: "#/components/parameters/SortOrderQuery" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Approval list",
              headers: { ETag: { $ref: "#/components/headers/ETag" } },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApprovalList" },
                },
              },
            },
            "304": { $ref: "#/components/responses/NotModified" },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/approvals/summary": {
        get: {
          summary: "Open-counts summary of tenant approvals by status",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Approval status counts",
              headers: { ETag: { $ref: "#/components/headers/ETag" } },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApprovalSummary" },
                },
              },
            },
            "304": { $ref: "#/components/responses/NotModified" },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/approvals/{approval_id}": {
        get: {
          summary: "Read a tenant-scoped approval",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "approval_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Approval resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApprovalResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/approvals/{approval_id}/evidence": {
        get: {
          summary: "Reviewer evidence composite for an approval",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "approval_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Approval evidence package",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApprovalEvidence" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/approvals/{approval_id}/approve": {
        post: {
          summary: "Approve a pending approval and resume the workflow",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "approval_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ApprovalApproveRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Approval decision",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApprovalDecision" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/approvals/{approval_id}/edit": {
        post: {
          summary:
            "Approve a pending approval with a human-edited payload and resume the workflow",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "approval_id",
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
                schema: { $ref: "#/components/schemas/ApprovalEditRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Approval decision",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApprovalDecision" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/approvals/{approval_id}/reject": {
        post: {
          summary: "Reject a pending approval; no response is sent",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "approval_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApprovalRejectRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Approval decision",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApprovalDecision" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/approvals/{approval_id}/escalate": {
        post: {
          summary: "Escalate a pending approval to manual handling",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "approval_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ApprovalEscalateRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Approval decision",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApprovalDecision" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/ai-runs": {
        get: {
          summary: "List tenant-scoped AI runs",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            {
              name: "ticket_id",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "status",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/AiRunStatus" },
            },
            {
              name: "run_type",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/AiRunType" },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "AI run list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AiRunList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/ai-runs/{ai_run_id}": {
        get: {
          summary:
            "Read a tenant-scoped AI run, including its observability trace link",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "ai_run_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "AI run resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AiRunResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/qa-reviews": {
        get: {
          summary: "List tenant-scoped QA reviews",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            {
              name: "ticket_id",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "ai_run_id",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "completed",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["true", "false"] },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "QA review list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/QaReviewList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
        post: {
          summary: "Queue a ticket/AI run for QA review",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/QaReviewCreateRequest" },
              },
            },
          },
          responses: {
            "201": {
              description: "QA review created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/QaReviewResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/qa-reviews/{qa_review_id}": {
        get: {
          summary: "Read a tenant-scoped QA review",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "qa_review_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "QA review resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/QaReviewResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/qa-reviews/{qa_review_id}/complete": {
        post: {
          summary: "Complete an open QA review with scores and defects",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "qa_review_id",
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
                schema: {
                  $ref: "#/components/schemas/QaReviewCompleteRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Completed QA review",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/QaReviewResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/qa-reviews/{qa_review_id}/evidence": {
        get: {
          summary:
            "Read the composite QA evidence package for a review (conversation, messages, AI run, tool calls, approvals)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "qa_review_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "QA evidence package",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/QaReviewEvidence" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/audit-events": {
        get: {
          summary: "List tenant-scoped audit events",
          security: [{ bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            {
              name: "actor_type",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/AuditActorType" },
            },
            {
              name: "entity_type",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "entity_id",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "action",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "correlation_id",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Audit event list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuditEventList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/audit-events/{audit_event_id}": {
        get: {
          summary: "Read a tenant-scoped audit event",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "audit_event_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Audit event resource",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuditEventResource" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/tickets/{ticket_id}/audit-events": {
        get: {
          summary: "List tenant-scoped audit events for a ticket",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "ticket_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            {
              name: "actor_type",
              in: "query",
              required: false,
              schema: { $ref: "#/components/schemas/AuditActorType" },
            },
            {
              name: "action",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "correlation_id",
              in: "query",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Ticket audit event list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuditEventList" },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/tickets/{ticket_id}/events": {
        get: {
          summary: "List the lifecycle event timeline for a ticket",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "ticket_id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/TenantHeader" },
            { $ref: "#/components/parameters/LimitQuery" },
            { $ref: "#/components/parameters/OffsetQuery" },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Ticket lifecycle event list",
              headers: { ETag: { $ref: "#/components/headers/ETag" } },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TicketEventList" },
                },
              },
            },
            "304": { $ref: "#/components/responses/NotModified" },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/webhooks/email/{provider}": {
        post: {
          summary: "Ingest an inbound email provider webhook",
          description:
            "Unauthenticated provider webhook. The request is authenticated by verifying the provider signature over the raw request body; the resolved channel determines the tenant.",
          security: [],
          parameters: [
            {
              name: "provider",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "channel_id",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          responses: {
            "202": {
              description: "Inbound messages accepted",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/InboundWebhookAccepted",
                  },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/webhooks/whatsapp/{provider}": {
        post: {
          summary: "Ingest an inbound WhatsApp provider webhook",
          description:
            "Unauthenticated provider webhook. The request is authenticated by verifying the provider signature over the raw request body; the resolved channel determines the tenant.",
          security: [],
          parameters: [
            {
              name: "provider",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "channel_id",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          responses: {
            "202": {
              description: "Inbound messages accepted",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/InboundWebhookAccepted",
                  },
                },
              },
            },
            default: { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/internal/tools/execute": {
        post: {
          summary:
            "Execute a governed tool call on behalf of the AI runtime (service-to-service)",
          description:
            "Internal machine-token route for the AI runtime sidecar; it is never exposed through the user gateway. The bearer token must be the shared internal service token (SUPPORT_INTERNAL_API_TOKEN by default) — user identity headers are ignored and no user role holds the required permission. Tenant context arrives in the request body, not headers. Every tool outcome (succeeded, failed, blocked) returns HTTP 200 with the result envelope; HTTP errors are reserved for auth and body validation.",
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/RequestIdHeader" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InternalToolExecuteRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Tool call result envelope (status: succeeded, failed, or blocked)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ToolCallResult" },
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
          bearerFormat: "JWT",
          description:
            "IdP-issued JWT verified against the issuer's JWKS " +
            "(issuer/audience/expiry; Milestone 16). The AI runtime sidecar " +
            "presents its internal machine token through the same header.",
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
        OffsetQuery: {
          name: "offset",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 0, default: 0 },
        },
        SortOrderQuery: {
          name: "order",
          in: "query",
          required: false,
          description:
            "Chronological order by created_at. Defaults to newest-first.",
          schema: { type: "string", enum: ["created_asc", "created_desc"] },
        },
      },
      headers: {
        ETag: {
          description:
            "Content hash of the list page for conditional requests (send it back as If-None-Match to get a 304 when unchanged).",
          schema: { type: "string" },
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
        NotModified: {
          description:
            "The list page is unchanged since the client's If-None-Match ETag; no body is returned.",
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
            offset: { type: "integer", minimum: 0 },
            has_more: { type: "boolean" },
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
            "retention_policy",
            "created_at",
            "updated_at",
          ],
          properties: {
            tenant_id: { type: "string" },
            name: { type: "string" },
            status: { enum: ["active", "suspended", "archived"] },
            default_timezone: { type: "string" },
            retention_policy: {
              type: "object",
              description:
                "Read-only per-tenant retention configuration (whole days; " +
                "absent keys retain indefinitely). Changing it is an ops " +
                "action (BACKEND_SPEC section 22).",
              additionalProperties: true,
            },
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
        ConversationResource: {
          type: "object",
          required: ["conversation"],
          properties: {
            conversation: { $ref: "#/components/schemas/Conversation" },
          },
        },
        ConversationStatus: {
          enum: ["open", "archived"],
        },
        Conversation: {
          type: "object",
          required: [
            "conversation_id",
            "tenant_id",
            "customer_id",
            "channel_id",
            "external_thread_id",
            "status",
            "last_message_at",
            "created_at",
            "updated_at",
          ],
          properties: {
            conversation_id: { type: "string" },
            tenant_id: { type: "string" },
            customer_id: { type: "string" },
            channel_id: { type: "string" },
            external_thread_id: { type: ["string", "null"] },
            status: { $ref: "#/components/schemas/ConversationStatus" },
            last_message_at: {
              type: ["string", "null"],
              format: "date-time",
            },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        ConversationList: {
          type: "object",
          required: ["conversations", "page"],
          properties: {
            conversations: {
              type: "array",
              items: { $ref: "#/components/schemas/Conversation" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        MessageResource: {
          type: "object",
          required: ["message"],
          properties: {
            message: { $ref: "#/components/schemas/Message" },
          },
        },
        MessageDirection: {
          enum: ["inbound", "outbound", "internal_note", "system"],
        },
        MessageCreatorType: {
          enum: ["customer", "human", "ai", "system", "integration"],
        },
        Message: {
          type: "object",
          required: [
            "message_id",
            "tenant_id",
            "conversation_id",
            "ticket_id",
            "channel_id",
            "direction",
            "body_text",
            "body_html_ref",
            "attachments",
            "external_message_id",
            "external_thread_id",
            "raw_payload_ref",
            "created_by_type",
            "created_by_user_id",
            "provider_message_id",
            "send_status",
            "sent_by_type",
            "ai_run_id",
            "approval_id",
            "sent_at",
            "idempotency_key",
            "created_at",
          ],
          properties: {
            message_id: { type: "string" },
            tenant_id: { type: "string" },
            conversation_id: { type: "string" },
            ticket_id: { type: ["string", "null"] },
            channel_id: { type: "string" },
            direction: { $ref: "#/components/schemas/MessageDirection" },
            body_text: { type: ["string", "null"] },
            body_html_ref: { type: ["string", "null"] },
            attachments: {
              type: "array",
              items: { type: "object", additionalProperties: true },
            },
            external_message_id: { type: ["string", "null"] },
            external_thread_id: { type: ["string", "null"] },
            raw_payload_ref: { type: ["string", "null"] },
            created_by_type: {
              $ref: "#/components/schemas/MessageCreatorType",
            },
            created_by_user_id: { type: ["string", "null"] },
            provider_message_id: { type: ["string", "null"] },
            send_status: { type: ["string", "null"] },
            sent_by_type: { type: ["string", "null"] },
            ai_run_id: { type: ["string", "null"] },
            approval_id: { type: ["string", "null"] },
            sent_at: { type: ["string", "null"], format: "date-time" },
            idempotency_key: { type: ["string", "null"] },
            created_at: { type: "string", format: "date-time" },
          },
        },
        MessageList: {
          type: "object",
          required: ["messages", "page"],
          properties: {
            messages: {
              type: "array",
              items: { $ref: "#/components/schemas/Message" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        PolicyResource: {
          type: "object",
          required: ["policy"],
          properties: {
            policy: { $ref: "#/components/schemas/Policy" },
          },
        },
        TenantPolicyDomain: {
          enum: [
            "refunds",
            "cancellations",
            "shipping",
            "faq",
            "routing",
            "tone",
            "escalation",
            "automation",
          ],
        },
        TenantPolicyStatus: {
          enum: ["draft", "active", "archived"],
        },
        Policy: {
          type: "object",
          required: [
            "policy_id",
            "tenant_id",
            "name",
            "domain",
            "status",
            "created_at",
            "updated_at",
          ],
          properties: {
            policy_id: { type: "string" },
            tenant_id: { type: "string" },
            name: { type: "string" },
            domain: { $ref: "#/components/schemas/TenantPolicyDomain" },
            status: { $ref: "#/components/schemas/TenantPolicyStatus" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        PolicyList: {
          type: "object",
          required: ["policies", "page"],
          properties: {
            policies: {
              type: "array",
              items: { $ref: "#/components/schemas/Policy" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        PolicyVersion: {
          type: "object",
          required: [
            "policy_version_id",
            "tenant_id",
            "policy_id",
            "version",
            "content",
            "schema_version",
            "created_by_user_id",
            "approved_by_user_id",
            "activated_at",
            "created_at",
          ],
          properties: {
            policy_version_id: { type: "string" },
            tenant_id: { type: "string" },
            policy_id: { type: "string" },
            version: { type: "integer", minimum: 1 },
            content: { type: "object", additionalProperties: true },
            schema_version: { type: "string" },
            created_by_user_id: { type: ["string", "null"] },
            approved_by_user_id: { type: ["string", "null"] },
            activated_at: {
              type: ["string", "null"],
              format: "date-time",
              description:
                "Stamped exactly once at activation; versions are immutable " +
                "once active.",
            },
            created_at: { type: "string", format: "date-time" },
          },
        },
        PolicyVersionResource: {
          type: "object",
          required: ["policy_version"],
          properties: {
            policy_version: { $ref: "#/components/schemas/PolicyVersion" },
          },
        },
        PolicyVersionList: {
          type: "object",
          required: ["policy_versions", "page"],
          properties: {
            policy_versions: {
              type: "array",
              items: { $ref: "#/components/schemas/PolicyVersion" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        PolicyCreateRequest: {
          type: "object",
          required: ["name", "domain", "content"],
          additionalProperties: false,
          properties: {
            policy_id: { type: "string", minLength: 1 },
            policy_version_id: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
            domain: { $ref: "#/components/schemas/TenantPolicyDomain" },
            content: {
              type: "object",
              additionalProperties: true,
              description:
                "automation-domain content must satisfy the closed " +
                "AutomationPolicyContent contract (auto_send_enabled + " +
                "auto_send_allowed_topics within the platform ceiling).",
            },
            schema_version: { type: "string", minLength: 1 },
          },
        },
        PolicyVersionCreateRequest: {
          type: "object",
          required: ["content"],
          additionalProperties: false,
          properties: {
            policy_version_id: { type: "string", minLength: 1 },
            content: { type: "object", additionalProperties: true },
            schema_version: { type: "string", minLength: 1 },
          },
        },
        PolicyCreate: {
          type: "object",
          required: ["policy", "policy_version"],
          properties: {
            policy: { $ref: "#/components/schemas/Policy" },
            policy_version: { $ref: "#/components/schemas/PolicyVersion" },
          },
        },
        PolicyActivation: {
          type: "object",
          required: ["policy", "policy_version", "archived_policy_ids"],
          properties: {
            policy: { $ref: "#/components/schemas/Policy" },
            policy_version: { $ref: "#/components/schemas/PolicyVersion" },
            archived_policy_ids: {
              type: "array",
              items: { type: "string" },
              description:
                "Same-domain predecessor policies archived by this activation.",
            },
          },
        },
        KbDocumentResource: {
          type: "object",
          required: ["kb_document"],
          properties: {
            kb_document: { $ref: "#/components/schemas/KbDocument" },
          },
        },
        KbDocumentSourceType: {
          enum: ["manual", "upload", "url", "integration"],
        },
        KbDocumentType: {
          enum: ["faq", "policy", "macro", "product_doc", "sop"],
        },
        KbStatus: {
          enum: ["draft", "active", "stale", "archived"],
        },
        KbDocument: {
          type: "object",
          required: [
            "kb_document_id",
            "tenant_id",
            "title",
            "source_type",
            "source_ref",
            "document_type",
            "status",
            "version",
            "content_hash",
            "created_by_user_id",
            "created_at",
            "updated_at",
          ],
          properties: {
            kb_document_id: { type: "string" },
            tenant_id: { type: "string" },
            title: { type: "string" },
            source_type: { $ref: "#/components/schemas/KbDocumentSourceType" },
            source_ref: { type: ["string", "null"] },
            document_type: { $ref: "#/components/schemas/KbDocumentType" },
            status: { $ref: "#/components/schemas/KbStatus" },
            version: { type: "integer", minimum: 1 },
            content_hash: { type: "string" },
            created_by_user_id: { type: ["string", "null"] },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        KbDocumentList: {
          type: "object",
          required: ["kb_documents", "page"],
          properties: {
            kb_documents: {
              type: "array",
              items: { $ref: "#/components/schemas/KbDocument" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        KbDocumentCreateRequest: {
          type: "object",
          additionalProperties: false,
          required: ["title", "source_type", "document_type", "content"],
          properties: {
            kb_document_id: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 },
            source_type: { $ref: "#/components/schemas/KbDocumentSourceType" },
            source_ref: { type: ["string", "null"], minLength: 1 },
            document_type: { $ref: "#/components/schemas/KbDocumentType" },
            content: { type: "string", minLength: 1 },
          },
        },
        KbDocumentUpdateRequest: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1 },
            source_ref: { type: ["string", "null"], minLength: 1 },
            document_type: { $ref: "#/components/schemas/KbDocumentType" },
            status: { $ref: "#/components/schemas/KbStatus" },
          },
        },
        KbIngestionResult: {
          type: "object",
          required: [
            "kb_document_id",
            "status",
            "version",
            "content_hash",
            "chunk_count",
            "embedded_count",
          ],
          properties: {
            kb_document_id: { type: "string" },
            status: { $ref: "#/components/schemas/KbStatus" },
            version: { type: "integer", minimum: 1 },
            content_hash: { type: "string" },
            chunk_count: { type: "integer", minimum: 0 },
            embedded_count: { type: "integer", minimum: 0 },
          },
        },
        KbSearchRequest: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 1 },
            limit: { type: "integer", minimum: 1, maximum: 50 },
            document_type: { $ref: "#/components/schemas/KbDocumentType" },
            source_type: { $ref: "#/components/schemas/KbDocumentSourceType" },
          },
        },
        KbSearchResult: {
          type: "object",
          required: [
            "kb_chunk_id",
            "tenant_id",
            "kb_document_id",
            "chunk_index",
            "content",
            "status",
            "metadata",
            "created_at",
            "score",
            "document_title",
            "document_type",
            "source_type",
            "source_ref",
          ],
          properties: {
            kb_chunk_id: { type: "string" },
            tenant_id: { type: "string" },
            kb_document_id: { type: "string" },
            chunk_index: { type: "integer", minimum: 0 },
            content: { type: "string" },
            status: { $ref: "#/components/schemas/KbStatus" },
            metadata: { type: "object", additionalProperties: true },
            created_at: { type: "string", format: "date-time" },
            score: { type: "number" },
            document_title: { type: "string" },
            document_type: { $ref: "#/components/schemas/KbDocumentType" },
            source_type: { $ref: "#/components/schemas/KbDocumentSourceType" },
            source_ref: { type: ["string", "null"] },
          },
        },
        KbSearchResponse: {
          type: "object",
          required: ["results", "page"],
          properties: {
            results: {
              type: "array",
              items: { $ref: "#/components/schemas/KbSearchResult" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        ApprovalResource: {
          type: "object",
          required: ["approval"],
          properties: {
            approval: { $ref: "#/components/schemas/Approval" },
          },
        },
        ApprovalType: {
          enum: ["reply", "tool_action", "escalation", "policy_exception"],
        },
        ApprovalStatus: {
          enum: [
            "pending",
            "approved",
            "edited",
            "rejected",
            "escalated",
            "expired",
          ],
        },
        Approval: {
          type: "object",
          required: [
            "approval_id",
            "tenant_id",
            "ticket_id",
            "ai_run_id",
            "approval_type",
            "status",
            "requested_payload",
            "approved_payload",
            "reviewer_user_id",
            "review_notes",
            "created_at",
            "resolved_at",
          ],
          properties: {
            approval_id: { type: "string" },
            tenant_id: { type: "string" },
            ticket_id: { type: "string" },
            ai_run_id: { type: ["string", "null"] },
            approval_type: { $ref: "#/components/schemas/ApprovalType" },
            status: { $ref: "#/components/schemas/ApprovalStatus" },
            requested_payload: {
              type: "object",
              additionalProperties: true,
            },
            approved_payload: {
              type: ["object", "null"],
              additionalProperties: true,
            },
            reviewer_user_id: { type: ["string", "null"] },
            review_notes: { type: ["string", "null"] },
            created_at: { type: "string", format: "date-time" },
            resolved_at: { type: ["string", "null"], format: "date-time" },
          },
        },
        ApprovalList: {
          type: "object",
          required: ["approvals", "page"],
          properties: {
            approvals: {
              type: "array",
              items: { $ref: "#/components/schemas/Approval" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        ApprovalApproveRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            review_notes: { type: ["string", "null"], minLength: 1 },
          },
        },
        ApprovalEditRequest: {
          type: "object",
          additionalProperties: false,
          required: ["approved_payload"],
          properties: {
            approved_payload: { type: "object", additionalProperties: true },
            review_notes: { type: ["string", "null"], minLength: 1 },
          },
        },
        ApprovalRejectRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            review_notes: { type: ["string", "null"], minLength: 1 },
          },
        },
        ApprovalEscalateRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            review_notes: { type: ["string", "null"], minLength: 1 },
          },
        },
        ApprovalWorkflowSignalResult: {
          type: "object",
          additionalProperties: false,
          required: ["delivered", "workflow_id", "reason"],
          properties: {
            delivered: { type: "boolean" },
            workflow_id: { type: ["string", "null"], minLength: 1 },
            reason: { type: ["string", "null"], minLength: 1 },
          },
        },
        ApprovalDecision: {
          type: "object",
          required: ["approval", "workflow_signal"],
          properties: {
            approval: { $ref: "#/components/schemas/Approval" },
            workflow_signal: {
              $ref: "#/components/schemas/ApprovalWorkflowSignalResult",
            },
          },
        },
        AiRunType: {
          enum: [
            "classification",
            "routing",
            "draft",
            "full_graph",
            "critique",
            "eval",
          ],
        },
        AiRunStatus: {
          enum: ["started", "succeeded", "failed", "canceled"],
        },
        AiRun: {
          type: "object",
          required: [
            "ai_run_id",
            "tenant_id",
            "ticket_id",
            "conversation_id",
            "run_type",
            "prompt_version",
            "model_provider",
            "model_id",
            "input_refs",
            "retrieved_context_refs",
            "structured_output",
            "confidence",
            "risk_level",
            "automation_recommendation",
            "guardrail_results",
            "status",
            "latency_ms",
            "input_tokens",
            "output_tokens",
            "cost_estimate",
            "trace_id",
            "created_at",
            "completed_at",
          ],
          properties: {
            ai_run_id: { type: "string" },
            tenant_id: { type: "string" },
            ticket_id: { type: "string" },
            conversation_id: { type: "string" },
            run_type: { $ref: "#/components/schemas/AiRunType" },
            prompt_version: { type: "string" },
            model_provider: { type: "string" },
            model_id: { type: "string" },
            input_refs: { type: "object", additionalProperties: true },
            retrieved_context_refs: {
              type: "object",
              additionalProperties: true,
            },
            structured_output: {
              type: ["object", "null"],
              additionalProperties: true,
            },
            confidence: { type: ["number", "null"] },
            risk_level: { type: ["string", "null"] },
            automation_recommendation: {
              oneOf: [
                { $ref: "#/components/schemas/AutomationMode" },
                { type: "null" },
              ],
            },
            guardrail_results: { type: "object", additionalProperties: true },
            status: { $ref: "#/components/schemas/AiRunStatus" },
            latency_ms: { type: ["integer", "null"] },
            input_tokens: { type: ["integer", "null"] },
            output_tokens: { type: ["integer", "null"] },
            cost_estimate: { type: ["number", "null"] },
            trace_id: { type: ["string", "null"] },
            created_at: { type: "string", format: "date-time" },
            completed_at: { type: ["string", "null"], format: "date-time" },
          },
        },
        AiRunResource: {
          type: "object",
          required: ["ai_run"],
          properties: {
            ai_run: { $ref: "#/components/schemas/AiRun" },
          },
        },
        AiRunList: {
          type: "object",
          required: ["ai_runs", "page"],
          properties: {
            ai_runs: {
              type: "array",
              items: { $ref: "#/components/schemas/AiRun" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        ToolCall: {
          type: "object",
          required: [
            "tool_call_id",
            "tenant_id",
            "ticket_id",
            "ai_run_id",
            "tool_definition_id",
            "input",
            "output",
            "status",
            "side_effect_class",
            "idempotency_key",
            "started_at",
            "completed_at",
            "error_code",
            "error_message",
          ],
          properties: {
            tool_call_id: { type: "string" },
            tenant_id: { type: "string" },
            ticket_id: { type: "string" },
            ai_run_id: { type: "string" },
            tool_definition_id: { type: "string" },
            input: { type: "object", additionalProperties: true },
            output: { type: ["object", "null"], additionalProperties: true },
            status: {
              enum: ["planned", "running", "succeeded", "failed", "blocked"],
            },
            side_effect_class: {
              enum: [
                "read_only",
                "draft_side_effect",
                "reversible_write",
                "irreversible_write",
              ],
            },
            idempotency_key: { type: ["string", "null"] },
            started_at: { type: ["string", "null"], format: "date-time" },
            completed_at: { type: ["string", "null"], format: "date-time" },
            error_code: { type: ["string", "null"] },
            error_message: { type: ["string", "null"] },
          },
        },
        ToolPermissionClass: {
          enum: [
            "customer_read",
            "order_read",
            "kb_read",
            "eligibility_evaluate",
            "reply_draft",
            "action_execute",
          ],
        },
        ToolSideEffectClass: {
          enum: [
            "read_only",
            "draft_side_effect",
            "reversible_write",
            "irreversible_write",
          ],
        },
        ToolCallRequest: {
          type: "object",
          additionalProperties: false,
          required: ["tool_name", "arguments"],
          properties: {
            tool_name: { type: "string", minLength: 1 },
            arguments: { type: "object", additionalProperties: true },
            idempotency_key: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
        ToolCallError: {
          type: "object",
          additionalProperties: false,
          required: ["code", "message"],
          properties: {
            code: {
              enum: [
                "invalid_arguments",
                "unauthorized",
                "not_visible",
                "not_found",
                "timeout",
                "result_too_large",
                "output_invalid",
                "tool_error",
              ],
            },
            message: { type: "string", minLength: 1 },
          },
        },
        ToolCallResult: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: [
                "status",
                "tool_call_id",
                "tool_name",
                "side_effect_class",
                "output",
                "idempotent_replay",
              ],
              properties: {
                status: { enum: ["succeeded"] },
                tool_call_id: { type: "string", minLength: 1 },
                tool_name: { type: "string", minLength: 1 },
                side_effect_class: {
                  $ref: "#/components/schemas/ToolSideEffectClass",
                },
                output: { type: "object", additionalProperties: true },
                idempotent_replay: { type: "boolean" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: [
                "status",
                "tool_call_id",
                "tool_name",
                "side_effect_class",
                "error",
                "idempotent_replay",
              ],
              properties: {
                status: { enum: ["failed", "blocked"] },
                tool_call_id: { type: "string" },
                tool_name: { type: "string", minLength: 1 },
                side_effect_class: {
                  $ref: "#/components/schemas/ToolSideEffectClass",
                },
                error: { $ref: "#/components/schemas/ToolCallError" },
                idempotent_replay: { type: "boolean" },
              },
            },
          ],
        },
        InternalToolExecuteRequest: {
          type: "object",
          additionalProperties: false,
          required: [
            "tenant_id",
            "ticket_id",
            "ai_run_id",
            "granted_permissions",
            "request",
          ],
          properties: {
            tenant_id: { type: "string", minLength: 1 },
            ticket_id: { type: "string", minLength: 1 },
            ai_run_id: { type: "string", minLength: 1 },
            granted_permissions: {
              type: "array",
              items: { $ref: "#/components/schemas/ToolPermissionClass" },
            },
            request: { $ref: "#/components/schemas/ToolCallRequest" },
          },
        },
        QaSampleReason: {
          enum: ["random_sample", "auto_send_candidate", "high_risk", "manual"],
        },
        QaDefectCategory: {
          enum: [
            "wrong_policy",
            "wrong_tool_use",
            "missing_evidence",
            "hallucination",
            "bad_tone",
            "missed_escalation",
            "privacy_issue",
            "tenant_leakage",
            "unsafe_auto_send",
          ],
        },
        QaDefectSeverity: {
          enum: ["critical", "high", "medium", "low"],
        },
        QaReviewDefect: {
          type: "object",
          additionalProperties: false,
          required: ["category"],
          properties: {
            category: { $ref: "#/components/schemas/QaDefectCategory" },
            severity: { $ref: "#/components/schemas/QaDefectSeverity" },
            note: { type: "string", minLength: 1 },
          },
        },
        QaReview: {
          type: "object",
          required: [
            "qa_review_id",
            "tenant_id",
            "ticket_id",
            "ai_run_id",
            "reviewer_user_id",
            "sample_reason",
            "scores",
            "defects",
            "notes",
            "created_at",
            "completed_at",
          ],
          properties: {
            qa_review_id: { type: "string" },
            tenant_id: { type: "string" },
            ticket_id: { type: "string" },
            ai_run_id: { type: ["string", "null"] },
            reviewer_user_id: { type: ["string", "null"] },
            sample_reason: { type: "string" },
            scores: { type: "object", additionalProperties: true },
            defects: {
              type: "array",
              items: { type: "object", additionalProperties: true },
            },
            notes: { type: ["string", "null"] },
            created_at: { type: "string", format: "date-time" },
            completed_at: { type: ["string", "null"], format: "date-time" },
          },
        },
        QaReviewResource: {
          type: "object",
          required: ["qa_review"],
          properties: {
            qa_review: { $ref: "#/components/schemas/QaReview" },
          },
        },
        QaReviewList: {
          type: "object",
          required: ["qa_reviews", "page"],
          properties: {
            qa_reviews: {
              type: "array",
              items: { $ref: "#/components/schemas/QaReview" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        QaReviewCreateRequest: {
          type: "object",
          additionalProperties: false,
          required: ["ticket_id", "sample_reason"],
          properties: {
            ticket_id: { type: "string", minLength: 1 },
            ai_run_id: { type: ["string", "null"], minLength: 1 },
            sample_reason: { $ref: "#/components/schemas/QaSampleReason" },
            notes: { type: ["string", "null"], minLength: 1 },
          },
        },
        QaReviewCompleteRequest: {
          type: "object",
          additionalProperties: false,
          required: ["scores", "defects"],
          properties: {
            scores: {
              type: "object",
              additionalProperties: { type: "number", minimum: 0, maximum: 5 },
            },
            defects: {
              type: "array",
              items: { $ref: "#/components/schemas/QaReviewDefect" },
            },
            notes: { type: ["string", "null"], minLength: 1 },
          },
        },
        QaReviewEvidence: {
          type: "object",
          required: [
            "qa_review",
            "ticket",
            "conversation",
            "messages",
            "ai_run",
            "tool_calls",
            "approvals",
          ],
          properties: {
            qa_review: { $ref: "#/components/schemas/QaReview" },
            ticket: { $ref: "#/components/schemas/Ticket" },
            conversation: { $ref: "#/components/schemas/Conversation" },
            messages: {
              type: "array",
              items: { $ref: "#/components/schemas/Message" },
            },
            ai_run: {
              oneOf: [{ $ref: "#/components/schemas/AiRun" }, { type: "null" }],
            },
            tool_calls: {
              type: "array",
              items: { $ref: "#/components/schemas/ToolCall" },
            },
            approvals: {
              type: "array",
              items: { $ref: "#/components/schemas/Approval" },
            },
          },
        },
        ApprovalEvidence: {
          type: "object",
          required: [
            "approval",
            "ticket",
            "conversation",
            "messages",
            "ai_run",
            "tool_calls",
            "prior_approvals",
          ],
          properties: {
            approval: { $ref: "#/components/schemas/Approval" },
            ticket: { $ref: "#/components/schemas/Ticket" },
            conversation: { $ref: "#/components/schemas/Conversation" },
            messages: {
              type: "array",
              items: { $ref: "#/components/schemas/Message" },
            },
            ai_run: {
              oneOf: [{ $ref: "#/components/schemas/AiRun" }, { type: "null" }],
            },
            tool_calls: {
              type: "array",
              items: { $ref: "#/components/schemas/ToolCall" },
            },
            prior_approvals: {
              type: "array",
              items: { $ref: "#/components/schemas/Approval" },
            },
          },
        },
        ApprovalStatusCounts: {
          type: "object",
          required: [
            "pending",
            "approved",
            "edited",
            "rejected",
            "escalated",
            "expired",
          ],
          properties: {
            pending: { type: "integer", minimum: 0 },
            approved: { type: "integer", minimum: 0 },
            edited: { type: "integer", minimum: 0 },
            rejected: { type: "integer", minimum: 0 },
            escalated: { type: "integer", minimum: 0 },
            expired: { type: "integer", minimum: 0 },
          },
        },
        ApprovalSummary: {
          type: "object",
          required: ["counts", "total"],
          properties: {
            counts: { $ref: "#/components/schemas/ApprovalStatusCounts" },
            total: { type: "integer", minimum: 0 },
          },
        },
        SessionIdentity: {
          type: "object",
          required: ["user_id", "tenant_id", "email", "roles", "permissions"],
          properties: {
            user_id: { type: "string", minLength: 1 },
            tenant_id: { type: "string", minLength: 1, nullable: true },
            email: { type: "string", nullable: true },
            roles: { type: "array", items: { type: "string" } },
            permissions: { type: "array", items: { type: "string" } },
          },
        },
        TicketEvent: {
          type: "object",
          required: [
            "ticket_event_id",
            "tenant_id",
            "ticket_id",
            "event_type",
            "from_status",
            "to_status",
            "actor_type",
            "actor_id",
            "reason_code",
            "metadata",
            "created_at",
          ],
          properties: {
            ticket_event_id: { type: "string" },
            tenant_id: { type: "string" },
            ticket_id: { type: "string" },
            event_type: { type: "string" },
            from_status: {
              oneOf: [
                { $ref: "#/components/schemas/TicketStatus" },
                { type: "null" },
              ],
            },
            to_status: {
              oneOf: [
                { $ref: "#/components/schemas/TicketStatus" },
                { type: "null" },
              ],
            },
            actor_type: { $ref: "#/components/schemas/AuditActorType" },
            actor_id: { type: ["string", "null"] },
            reason_code: { type: ["string", "null"] },
            metadata: { oneOf: [{ type: "object" }, { type: "null" }] },
            created_at: { type: "string", format: "date-time" },
          },
        },
        TicketEventList: {
          type: "object",
          required: ["ticket_events", "page"],
          properties: {
            ticket_events: {
              type: "array",
              items: { $ref: "#/components/schemas/TicketEvent" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
          },
        },
        AuditEventResource: {
          type: "object",
          required: ["audit_event"],
          properties: {
            audit_event: { $ref: "#/components/schemas/AuditEvent" },
          },
        },
        AuditActorType: {
          enum: ["system", "ai", "human", "integration"],
        },
        AuditEvent: {
          type: "object",
          required: [
            "audit_event_id",
            "tenant_id",
            "actor_type",
            "actor_id",
            "entity_type",
            "entity_id",
            "action",
            "metadata",
            "correlation_id",
            "created_at",
          ],
          properties: {
            audit_event_id: { type: "string" },
            tenant_id: { type: "string" },
            actor_type: { $ref: "#/components/schemas/AuditActorType" },
            actor_id: { type: ["string", "null"] },
            entity_type: { type: "string" },
            entity_id: { type: "string" },
            action: { type: "string" },
            metadata: { type: "object", additionalProperties: true },
            correlation_id: { type: ["string", "null"] },
            created_at: { type: "string", format: "date-time" },
          },
        },
        AuditEventList: {
          type: "object",
          required: ["audit_events", "page"],
          properties: {
            audit_events: {
              type: "array",
              items: { $ref: "#/components/schemas/AuditEvent" },
            },
            page: { $ref: "#/components/schemas/ListPage" },
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
        InboundWebhookMessageResult: {
          type: "object",
          required: [
            "external_message_id",
            "message_id",
            "conversation_id",
            "ticket_id",
            "deduplicated",
            "rejected",
            "rejection_reason",
            "workflow_id",
          ],
          additionalProperties: false,
          properties: {
            external_message_id: { type: "string" },
            message_id: { type: "string" },
            conversation_id: { type: "string" },
            ticket_id: { type: "string" },
            deduplicated: { type: "boolean" },
            rejected: { type: "boolean" },
            rejection_reason: { type: ["string", "null"] },
            workflow_id: { type: ["string", "null"] },
          },
        },
        InboundWebhookAccepted: {
          type: "object",
          required: [
            "channel_id",
            "provider",
            "received",
            "accepted",
            "deduplicated",
            "rejected",
            "results",
          ],
          additionalProperties: false,
          properties: {
            channel_id: { type: "string" },
            provider: { type: "string" },
            received: { type: "integer", minimum: 0 },
            accepted: { type: "integer", minimum: 0 },
            deduplicated: { type: "integer", minimum: 0 },
            rejected: { type: "integer", minimum: 0 },
            results: {
              type: "array",
              items: {
                $ref: "#/components/schemas/InboundWebhookMessageResult",
              },
            },
          },
        },
        AutoSendTopic: {
          type: "string",
          enum: ["faq", "order_status"],
        },
        EffectiveAutomationPolicy: {
          type: "object",
          required: [
            "tenant_id",
            "configured",
            "policy_id",
            "policy_version_id",
            "version",
            "activated_at",
            "auto_send_enabled",
            "auto_send_allowed_topics",
          ],
          properties: {
            tenant_id: { type: "string", minLength: 1 },
            configured: { type: "boolean" },
            policy_id: { type: ["string", "null"], minLength: 1 },
            policy_version_id: { type: ["string", "null"], minLength: 1 },
            version: { type: ["integer", "null"], minimum: 1 },
            activated_at: { type: ["string", "null"], format: "date-time" },
            auto_send_enabled: { type: "boolean" },
            auto_send_allowed_topics: {
              type: "array",
              items: { $ref: "#/components/schemas/AutoSendTopic" },
            },
          },
        },
        WeeklyPilotReport: {
          type: "object",
          required: [
            "tenant_id",
            "window",
            "tickets",
            "ai_runs",
            "approvals",
            "outbound_messages",
            "qa_reviews",
            "top_topics",
          ],
          properties: {
            tenant_id: { type: "string", minLength: 1 },
            window: {
              type: "object",
              required: ["since", "until"],
              properties: {
                since: { type: "string", format: "date-time" },
                until: { type: "string", format: "date-time" },
              },
            },
            tickets: {
              type: "object",
              required: [
                "created",
                "resolved",
                "manual_escalations",
                "sla_breaches",
                "first_response_minutes_avg",
                "resolution_minutes_avg",
                "escalation_rate",
              ],
              properties: {
                created: { type: "integer", minimum: 0 },
                resolved: { type: "integer", minimum: 0 },
                manual_escalations: { type: "integer", minimum: 0 },
                sla_breaches: { type: "integer", minimum: 0 },
                first_response_minutes_avg: {
                  type: ["number", "null"],
                  minimum: 0,
                },
                resolution_minutes_avg: {
                  type: ["number", "null"],
                  minimum: 0,
                },
                escalation_rate: {
                  type: ["number", "null"],
                  minimum: 0,
                  maximum: 1,
                },
              },
            },
            ai_runs: {
              type: "object",
              required: ["total", "succeeded", "failed", "draft_rate"],
              properties: {
                total: { type: "integer", minimum: 0 },
                succeeded: { type: "integer", minimum: 0 },
                failed: { type: "integer", minimum: 0 },
                draft_rate: {
                  type: ["number", "null"],
                  minimum: 0,
                  maximum: 1,
                },
              },
            },
            approvals: {
              type: "object",
              required: [
                "requested",
                "approved",
                "edited",
                "rejected",
                "escalated",
                "approval_rate",
              ],
              properties: {
                requested: { type: "integer", minimum: 0 },
                approved: { type: "integer", minimum: 0 },
                edited: { type: "integer", minimum: 0 },
                rejected: { type: "integer", minimum: 0 },
                escalated: { type: "integer", minimum: 0 },
                approval_rate: {
                  type: ["number", "null"],
                  minimum: 0,
                  maximum: 1,
                },
              },
            },
            outbound_messages: {
              type: "object",
              required: ["sent", "failed", "auto_sent", "auto_send_rate"],
              properties: {
                sent: { type: "integer", minimum: 0 },
                failed: { type: "integer", minimum: 0 },
                auto_sent: { type: "integer", minimum: 0 },
                auto_send_rate: {
                  type: ["number", "null"],
                  minimum: 0,
                  maximum: 1,
                },
              },
            },
            qa_reviews: {
              type: "object",
              required: ["created", "completed", "with_defects", "defect_rate"],
              properties: {
                created: { type: "integer", minimum: 0 },
                completed: { type: "integer", minimum: 0 },
                with_defects: { type: "integer", minimum: 0 },
                defect_rate: {
                  type: ["number", "null"],
                  minimum: 0,
                  maximum: 1,
                },
              },
            },
            top_topics: {
              type: "array",
              items: {
                type: "object",
                required: ["topic", "count"],
                properties: {
                  topic: { type: "string", minLength: 1 },
                  count: { type: "integer", minimum: 1 },
                },
              },
            },
          },
        },
        WeeklyPilotReportResponse: {
          type: "object",
          required: ["report"],
          properties: {
            report: { $ref: "#/components/schemas/WeeklyPilotReport" },
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
