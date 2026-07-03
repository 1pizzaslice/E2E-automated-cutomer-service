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
            { $ref: "#/components/parameters/RequestIdHeader" },
          ],
          responses: {
            "200": {
              description: "Approval list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApprovalList" },
                },
              },
            },
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
            "workflow_id",
          ],
          additionalProperties: false,
          properties: {
            external_message_id: { type: "string" },
            message_id: { type: "string" },
            conversation_id: { type: "string" },
            ticket_id: { type: "string" },
            deduplicated: { type: "boolean" },
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
            "results",
          ],
          additionalProperties: false,
          properties: {
            channel_id: { type: "string" },
            provider: { type: "string" },
            received: { type: "integer", minimum: 0 },
            accepted: { type: "integer", minimum: 0 },
            deduplicated: { type: "integer", minimum: 0 },
            results: {
              type: "array",
              items: {
                $ref: "#/components/schemas/InboundWebhookMessageResult",
              },
            },
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
