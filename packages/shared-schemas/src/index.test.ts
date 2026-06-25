import { describe, expect, it } from "vitest";
import {
  ApprovalListResponseSchema,
  ApprovalResourceResponseSchema,
  ApiErrorResponseSchema,
  AuditEventListResponseSchema,
  AuditEventResourceResponseSchema,
  ConversationListResponseSchema,
  ConversationResourceResponseSchema,
  CustomerCreateRequestSchema,
  CustomerListResponseSchema,
  CustomerResourceResponseSchema,
  DomainEventEnvelopeSchema,
  KbDocumentListResponseSchema,
  KbDocumentResourceResponseSchema,
  TenantCreateRequestSchema,
  TenantListResponseSchema,
  HealthResponseSchema,
  MessageListResponseSchema,
  MessageResourceResponseSchema,
  PolicyListResponseSchema,
  PolicyResourceResponseSchema,
  TicketCreateRequestSchema,
  TicketListResponseSchema,
  TicketResourceResponseSchema,
  TicketUpdateRequestSchema,
  buildDomainEventSubject,
  createHealthResponse,
} from "./index.js";

describe("shared health schema", () => {
  it("creates a valid health response", () => {
    const response = createHealthResponse("api");

    expect(HealthResponseSchema.parse(response)).toEqual(response);
    expect(response.status).toBe("ok");
  });

  it("rejects unknown services", () => {
    expect(() =>
      HealthResponseSchema.parse({
        service: "unknown",
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "0.1.0",
      }),
    ).toThrow();
  });
});

describe("shared event contract schemas", () => {
  const event = {
    event_id: "evt_test",
    event_name: "support.ticket.created.v1",
    schema_version: "1",
    tenant_id: "ten_test",
    correlation_id: "corr_test",
    causation_id: "req_test",
    occurred_at: "2026-06-25T00:00:00.000Z",
    actor: {
      type: "system",
      id: "workflow",
    },
    payload: {
      ticket_id: "ticket_test",
      status: "new",
    },
  } as const;

  it("validates versioned domain event envelopes and builds tenant-aware subjects", () => {
    const parsed = DomainEventEnvelopeSchema.parse(event);

    expect(parsed).toEqual(event);
    expect(buildDomainEventSubject(parsed)).toBe(
      "support.events.tenant.ten_test.ticket.created.v1",
    );
  });

  it("rejects unsupported event versions and unsafe subject tenant tokens", () => {
    expect(() =>
      DomainEventEnvelopeSchema.parse({
        ...event,
        schema_version: "2",
      }),
    ).toThrow();

    expect(() =>
      DomainEventEnvelopeSchema.parse({
        ...event,
        event_name: "support.ticket.created",
      }),
    ).toThrow();

    expect(() =>
      DomainEventEnvelopeSchema.parse({
        ...event,
        tenant_id: "tenant.with.dot",
      }),
    ).toThrow();
  });
});

describe("shared API contract schemas", () => {
  it("validates structured error responses", () => {
    const parsed = ApiErrorResponseSchema.parse({
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication is required.",
        request_id: "req_test",
      },
    });

    expect(parsed.error.details).toEqual([]);
  });

  it("validates customer resource responses", () => {
    const response = {
      customer: {
        customer_id: "cus_test",
        tenant_id: "ten_test",
        display_name: "Test Customer",
        email: "customer@example.test",
        phone: null,
        external_customer_ref: null,
        metadata: {},
        created_at: "2026-06-19T00:00:00.000Z",
        updated_at: "2026-06-19T00:00:00.000Z",
      },
    };

    expect(CustomerResourceResponseSchema.parse(response)).toEqual(response);
  });

  it("validates list response envelopes", () => {
    const now = "2026-06-19T00:00:00.000Z";

    expect(
      TenantListResponseSchema.parse({
        tenants: [
          {
            tenant_id: "ten_test",
            name: "Test Tenant",
            status: "active",
            default_timezone: "UTC",
            created_at: now,
            updated_at: now,
          },
        ],
        page: { count: 1, limit: 50 },
      }),
    ).toMatchObject({ page: { count: 1, limit: 50 } });

    expect(
      CustomerListResponseSchema.parse({
        customers: [
          {
            customer_id: "cus_test",
            tenant_id: "ten_test",
            display_name: "Test Customer",
            email: "customer@example.test",
            phone: null,
            external_customer_ref: null,
            metadata: {},
            created_at: now,
            updated_at: now,
          },
        ],
        page: { count: 1, limit: 50 },
      }),
    ).toMatchObject({ customers: [{ customer_id: "cus_test" }] });

    expect(
      ConversationListResponseSchema.parse({
        conversations: [
          {
            conversation_id: "cnv_test",
            tenant_id: "ten_test",
            customer_id: "cus_test",
            channel_id: "chn_test",
            external_thread_id: "thread_test",
            status: "open",
            last_message_at: now,
            created_at: now,
            updated_at: now,
          },
        ],
        page: { count: 1, limit: 50 },
      }),
    ).toMatchObject({ conversations: [{ conversation_id: "cnv_test" }] });

    expect(
      MessageListResponseSchema.parse({
        messages: [
          {
            message_id: "msg_test",
            tenant_id: "ten_test",
            conversation_id: "cnv_test",
            ticket_id: "ticket_test",
            channel_id: "chn_test",
            direction: "inbound",
            body_text: "Where is my order?",
            body_html_ref: null,
            attachments: [],
            external_message_id: "external_msg_test",
            external_thread_id: "thread_test",
            raw_payload_ref: "raw_payload_test",
            created_by_type: "customer",
            created_by_user_id: null,
            provider_message_id: null,
            send_status: null,
            sent_by_type: null,
            ai_run_id: null,
            approval_id: null,
            sent_at: null,
            idempotency_key: "idem_msg_test",
            created_at: now,
          },
        ],
        page: { count: 1, limit: 50 },
      }),
    ).toMatchObject({ messages: [{ message_id: "msg_test" }] });

    expect(
      TicketListResponseSchema.parse({
        tickets: [
          {
            ticket_id: "ticket_test",
            tenant_id: "ten_test",
            conversation_id: "cnv_test",
            customer_id: "cus_test",
            status: "new",
            priority: "p2",
            topic: null,
            subtopic: null,
            language: null,
            sentiment: null,
            urgency_score: null,
            automation_mode: "human_approve",
            assigned_queue: null,
            assigned_user_id: null,
            sla_policy_id: null,
            policy_version_id: null,
            opened_at: now,
            first_response_due_at: null,
            next_response_due_at: null,
            resolution_due_at: null,
            resolved_at: null,
            closed_at: null,
            created_at: now,
            updated_at: now,
          },
        ],
        page: { count: 1, limit: 50 },
      }),
    ).toMatchObject({ tickets: [{ ticket_id: "ticket_test" }] });

    expect(
      PolicyListResponseSchema.parse({
        policies: [
          {
            policy_id: "pol_test",
            tenant_id: "ten_test",
            name: "Shipping Policy",
            domain: "shipping",
            status: "active",
            created_at: now,
            updated_at: now,
          },
        ],
        page: { count: 1, limit: 50 },
      }),
    ).toMatchObject({ policies: [{ policy_id: "pol_test" }] });

    expect(
      KbDocumentListResponseSchema.parse({
        kb_documents: [
          {
            kb_document_id: "kbd_test",
            tenant_id: "ten_test",
            title: "Shipping FAQ",
            source_type: "manual",
            source_ref: null,
            document_type: "faq",
            status: "active",
            version: 1,
            content_hash: "hash_test",
            created_by_user_id: null,
            created_at: now,
            updated_at: now,
          },
        ],
        page: { count: 1, limit: 50 },
      }),
    ).toMatchObject({ kb_documents: [{ kb_document_id: "kbd_test" }] });

    expect(
      ApprovalListResponseSchema.parse({
        approvals: [
          {
            approval_id: "apr_test",
            tenant_id: "ten_test",
            ticket_id: "ticket_test",
            ai_run_id: null,
            approval_type: "reply",
            status: "pending",
            requested_payload: {
              draft: "Where is my order response draft.",
            },
            approved_payload: null,
            reviewer_user_id: null,
            review_notes: null,
            created_at: now,
            resolved_at: null,
          },
        ],
        page: { count: 1, limit: 50 },
      }),
    ).toMatchObject({ approvals: [{ approval_id: "apr_test" }] });

    expect(
      AuditEventListResponseSchema.parse({
        audit_events: [
          {
            audit_event_id: "aud_test",
            tenant_id: "ten_test",
            actor_type: "system",
            actor_id: null,
            entity_type: "ticket",
            entity_id: "ticket_test",
            action: "ticket.created",
            metadata: { status: "new" },
            correlation_id: "corr_test",
            created_at: now,
          },
        ],
        page: { count: 1, limit: 50 },
      }),
    ).toMatchObject({ audit_events: [{ audit_event_id: "aud_test" }] });
  });

  it("validates create and update request bodies", () => {
    expect(
      TenantCreateRequestSchema.parse({
        name: "Test Tenant",
        default_timezone: "UTC",
      }),
    ).toMatchObject({ name: "Test Tenant" });

    expect(
      CustomerCreateRequestSchema.parse({
        email: "customer@example.test",
        metadata: { source: "fixture" },
      }),
    ).toMatchObject({ email: "customer@example.test" });

    expect(
      TicketCreateRequestSchema.parse({
        conversation_id: "cnv_test",
        customer_id: "cus_test",
        priority: "p1",
      }),
    ).toMatchObject({ priority: "p1" });

    expect(() => TicketUpdateRequestSchema.parse({})).toThrow();
    expect(() =>
      TicketUpdateRequestSchema.parse({ status: "closed" }),
    ).toThrow();
  });

  it("validates ticket resource responses", () => {
    const response = {
      ticket: {
        ticket_id: "ticket_test",
        tenant_id: "ten_test",
        conversation_id: "cnv_test",
        customer_id: "cus_test",
        status: "new",
        priority: "p2",
        topic: null,
        subtopic: null,
        language: null,
        sentiment: null,
        urgency_score: null,
        automation_mode: "human_approve",
        assigned_queue: null,
        assigned_user_id: null,
        sla_policy_id: null,
        policy_version_id: null,
        opened_at: "2026-06-19T00:00:00.000Z",
        first_response_due_at: null,
        next_response_due_at: null,
        resolution_due_at: null,
        resolved_at: null,
        closed_at: null,
        created_at: "2026-06-19T00:00:00.000Z",
        updated_at: "2026-06-19T00:00:00.000Z",
      },
    };

    expect(TicketResourceResponseSchema.parse(response)).toEqual(response);
  });

  it("validates KB document resource responses", () => {
    const response = {
      kb_document: {
        kb_document_id: "kbd_test",
        tenant_id: "ten_test",
        title: "Shipping FAQ",
        source_type: "manual",
        source_ref: null,
        document_type: "faq",
        status: "active",
        version: 1,
        content_hash: "hash_test",
        created_by_user_id: null,
        created_at: "2026-06-19T00:00:00.000Z",
        updated_at: "2026-06-19T00:00:00.000Z",
      },
    };

    expect(KbDocumentResourceResponseSchema.parse(response)).toEqual(response);
  });

  it("validates conversation and message resource responses", () => {
    const now = "2026-06-19T00:00:00.000Z";
    const conversationResponse = {
      conversation: {
        conversation_id: "cnv_test",
        tenant_id: "ten_test",
        customer_id: "cus_test",
        channel_id: "chn_test",
        external_thread_id: "thread_test",
        status: "open",
        last_message_at: now,
        created_at: now,
        updated_at: now,
      },
    };
    const messageResponse = {
      message: {
        message_id: "msg_test",
        tenant_id: "ten_test",
        conversation_id: "cnv_test",
        ticket_id: "ticket_test",
        channel_id: "chn_test",
        direction: "inbound",
        body_text: "Where is my order?",
        body_html_ref: null,
        attachments: [],
        external_message_id: "external_msg_test",
        external_thread_id: "thread_test",
        raw_payload_ref: "raw_payload_test",
        created_by_type: "customer",
        created_by_user_id: null,
        provider_message_id: null,
        send_status: null,
        sent_by_type: null,
        ai_run_id: null,
        approval_id: null,
        sent_at: null,
        idempotency_key: "idem_msg_test",
        created_at: now,
      },
    };

    expect(
      ConversationResourceResponseSchema.parse(conversationResponse),
    ).toEqual(conversationResponse);
    expect(MessageResourceResponseSchema.parse(messageResponse)).toEqual(
      messageResponse,
    );
  });

  it("validates policy resource responses", () => {
    const response = {
      policy: {
        policy_id: "pol_test",
        tenant_id: "ten_test",
        name: "Shipping Policy",
        domain: "shipping",
        status: "active",
        created_at: "2026-06-19T00:00:00.000Z",
        updated_at: "2026-06-19T00:00:00.000Z",
      },
    };

    expect(PolicyResourceResponseSchema.parse(response)).toEqual(response);
  });

  it("validates approval resource responses", () => {
    const response = {
      approval: {
        approval_id: "apr_test",
        tenant_id: "ten_test",
        ticket_id: "ticket_test",
        ai_run_id: null,
        approval_type: "reply",
        status: "pending",
        requested_payload: {
          draft: "Where is my order response draft.",
          risk_reasons: ["v1_default_human_approval"],
        },
        approved_payload: null,
        reviewer_user_id: null,
        review_notes: null,
        created_at: "2026-06-19T00:00:00.000Z",
        resolved_at: null,
      },
    };

    expect(ApprovalResourceResponseSchema.parse(response)).toEqual(response);
  });

  it("validates audit event resource responses", () => {
    const response = {
      audit_event: {
        audit_event_id: "aud_test",
        tenant_id: "ten_test",
        actor_type: "system",
        actor_id: null,
        entity_type: "ticket",
        entity_id: "ticket_test",
        action: "ticket.created",
        metadata: { status: "new" },
        correlation_id: "corr_test",
        created_at: "2026-06-19T00:00:00.000Z",
      },
    };

    expect(AuditEventResourceResponseSchema.parse(response)).toEqual(response);
  });
});
