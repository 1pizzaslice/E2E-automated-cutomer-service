import { describe, expect, it } from "vitest";
import {
  AiRunListResponseSchema,
  AiRunResourceResponseSchema,
  AiRunResponseSchema,
  ApprovalApproveRequestSchema,
  ApprovalDecisionResponseSchema,
  ApprovalEditRequestSchema,
  ApprovalEscalateRequestSchema,
  ApprovalListResponseSchema,
  ApprovalRejectRequestSchema,
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
  MessageReceivedEventPayloadSchema,
  KbChunkResponseSchema,
  KbDocumentCreateRequestSchema,
  KbDocumentListResponseSchema,
  KbDocumentResourceResponseSchema,
  KbDocumentUpdateRequestSchema,
  KbIngestionResultSchema,
  KbSearchRequestSchema,
  KbSearchResponseSchema,
  SupportEventErrorRecordSchema,
  TenantCreateRequestSchema,
  TenantListResponseSchema,
  HealthResponseSchema,
  MessageListResponseSchema,
  MessageResourceResponseSchema,
  NormalizedInboundMessageSchema,
  NormalizedOutboundMessageSchema,
  PolicyListResponseSchema,
  PolicyResourceResponseSchema,
  QaReviewCompleteRequestSchema,
  QaReviewCreateRequestSchema,
  QaReviewEvidenceResponseSchema,
  QaReviewListResponseSchema,
  QaReviewResourceResponseSchema,
  QaReviewResponseSchema,
  TicketCreateRequestSchema,
  TicketCreatedEventPayloadSchema,
  TicketListResponseSchema,
  TicketResourceResponseSchema,
  TicketStateTransitionEventPayloadSchema,
  TicketUpdateRequestSchema,
  ToolCallRequestSchema,
  ToolCallResponseSchema,
  ToolCallResultSchema,
  ToolPermissionClassSchema,
  ToolSideEffectClassSchema,
  AutomationPolicyContentSchema,
  AutoSendTopicSchema,
  EffectiveAutomationPolicyResponseSchema,
  SupportAuditActionSchema,
  TenantRetentionPolicySchema,
  WeeklyPilotReportSchema,
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
      conversation_id: "cnv_test",
      customer_id: "cus_test",
      status: "new",
      priority: "p2",
      automation_mode: "human_approve",
      assigned_queue: null,
      assigned_user_id: null,
      opened_at: "2026-06-25T00:00:00.000Z",
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

  it("validates milestone event payload contracts by event name", () => {
    expect(
      MessageReceivedEventPayloadSchema.parse({
        message_id: "msg_test",
        conversation_id: "cnv_test",
        ticket_id: "ticket_test",
        channel_id: "chn_test",
        direction: "inbound",
        external_message_id: "external_msg_test",
        external_thread_id: "thread_test",
        idempotency_key: "idem_msg_test",
        received_at: "2026-06-25T00:00:00.000Z",
      }),
    ).toMatchObject({ direction: "inbound" });

    expect(TicketCreatedEventPayloadSchema.parse(event.payload)).toEqual(
      event.payload,
    );

    expect(
      TicketStateTransitionEventPayloadSchema.parse({
        ticket_id: "ticket_test",
        from_status: "new",
        to_status: "triaged",
        reason_code: "ai_triage_completed",
        metadata: {},
      }),
    ).toMatchObject({ to_status: "triaged" });
  });

  it("rejects domain envelopes with payloads that do not match the event name", () => {
    expect(() =>
      DomainEventEnvelopeSchema.parse({
        ...event,
        payload: {
          ticket_id: "ticket_test",
          status: "new",
        },
      }),
    ).toThrow(/Invalid payload for support.ticket.created.v1/);
  });

  it("validates structured support event error records", () => {
    expect(
      SupportEventErrorRecordSchema.parse({
        error_id: "event_error_test",
        error_kind: "handler_failed",
        consumer_name: "ticket_projection",
        stream_name: "SUPPORT_EVENTS",
        original_subject: "support.events.tenant.ten_test.ticket.created.v1",
        original_sequence: 7,
        event_id: "evt_test",
        event_name: "support.ticket.created.v1",
        tenant_id: "ten_test",
        correlation_id: "corr_test",
        causation_id: "req_test",
        occurred_at: "2026-06-25T00:00:00.000Z",
        redelivered: true,
        delivery_count: 5,
        will_retry: false,
        error_name: "Error",
        error_message: "handler failed",
      }),
    ).toMatchObject({
      error_kind: "handler_failed",
      will_retry: false,
    });
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

  it("validates a KB document create request and rejects empty content", () => {
    const request = {
      title: "Returns policy",
      source_type: "manual",
      document_type: "policy",
      content: "Returns are accepted within 30 days of delivery.",
    };

    expect(KbDocumentCreateRequestSchema.parse(request)).toMatchObject({
      title: "Returns policy",
      content: "Returns are accepted within 30 days of delivery.",
    });
    expect(() =>
      KbDocumentCreateRequestSchema.parse({ ...request, content: "" }),
    ).toThrow();
    expect(() =>
      KbDocumentCreateRequestSchema.parse({ ...request, extra: true }),
    ).toThrow();
  });

  it("requires at least one field on a KB document update request", () => {
    expect(
      KbDocumentUpdateRequestSchema.parse({ status: "stale" }),
    ).toMatchObject({ status: "stale" });
    expect(() => KbDocumentUpdateRequestSchema.parse({})).toThrow();
  });

  it("validates a KB chunk response and an ingestion result", () => {
    const chunk = {
      kb_chunk_id: "kbc_test",
      tenant_id: "ten_test",
      kb_document_id: "kbd_test",
      chunk_index: 0,
      content: "Returns are accepted within 30 days.",
      status: "active",
      metadata: { document_type: "policy" },
      created_at: "2026-06-19T00:00:00.000Z",
    };
    const result = {
      kb_document_id: "kbd_test",
      status: "active",
      version: 1,
      content_hash: "hash_test",
      chunk_count: 3,
      embedded_count: 3,
    };

    expect(KbChunkResponseSchema.parse(chunk)).toEqual(chunk);
    expect(KbIngestionResultSchema.parse(result)).toEqual(result);
  });

  it("validates a KB search request and rejects empty or unknown fields", () => {
    expect(
      KbSearchRequestSchema.parse({
        query: "how long do I have to return an item?",
        limit: 5,
        document_type: "policy",
      }),
    ).toMatchObject({
      query: "how long do I have to return an item?",
      limit: 5,
    });
    // limit is optional; the service applies a default.
    expect(KbSearchRequestSchema.parse({ query: "refunds" })).toEqual({
      query: "refunds",
    });
    expect(() => KbSearchRequestSchema.parse({ query: "" })).toThrow();
    expect(() =>
      KbSearchRequestSchema.parse({ query: "refunds", limit: 0 }),
    ).toThrow();
    expect(() =>
      KbSearchRequestSchema.parse({ query: "refunds", extra: true }),
    ).toThrow();
  });

  it("validates a KB search response with citation fields and a score", () => {
    const response = {
      results: [
        {
          kb_chunk_id: "kbc_test",
          tenant_id: "ten_test",
          kb_document_id: "kbd_test",
          chunk_index: 0,
          content: "Returns are accepted within 30 days.",
          status: "active",
          metadata: { document_type: "policy", source_type: "manual" },
          created_at: "2026-06-19T00:00:00.000Z",
          score: 0.87,
          document_title: "Returns policy",
          document_type: "policy",
          source_type: "manual",
          source_ref: null,
        },
      ],
      page: { count: 1, limit: 8 },
    };

    expect(KbSearchResponseSchema.parse(response)).toEqual(response);
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

describe("normalized inbound message schema", () => {
  const inboundMessage = {
    tenant_id: "ten_test",
    channel_id: "chn_test",
    channel: "email",
    provider: "gmail",
    external_thread_id: "provider-thread-id",
    external_message_id: "provider-message-id",
    customer_identity: {
      type: "email",
      value: "customer@example.com",
      display_name: "Customer Name",
    },
    direction: "inbound",
    body: {
      text: "Where is my order?",
      html: "<p>Where is my order?</p>",
    },
    attachments: [
      {
        filename: "receipt.pdf",
        content_type: "application/pdf",
        size_bytes: 12345,
        object_ref: "s3://raw-payloads/receipt.pdf",
      },
    ],
    raw_payload_ref: "s3://raw-payloads/provider-message-id.json",
    received_at: "2026-06-18T00:00:00.000Z",
    idempotency_key: "provider-message-id",
  };

  it("validates a canonical normalized inbound message", () => {
    expect(NormalizedInboundMessageSchema.parse(inboundMessage)).toEqual(
      inboundMessage,
    );
  });

  it("accepts a WhatsApp message with no attachments and html-only body", () => {
    expect(
      NormalizedInboundMessageSchema.parse({
        ...inboundMessage,
        channel: "whatsapp",
        provider: "whatsapp_cloud",
        customer_identity: {
          type: "whatsapp_id",
          value: "15551234567",
          display_name: null,
        },
        body: { text: null, html: "<p>Where is my order?</p>" },
        attachments: [],
      }),
    ).toMatchObject({ channel: "whatsapp" });
  });

  it("accepts a media-only message with an empty body and a null attachment size", () => {
    expect(
      NormalizedInboundMessageSchema.parse({
        ...inboundMessage,
        channel: "whatsapp",
        provider: "whatsapp_cloud",
        customer_identity: {
          type: "whatsapp_id",
          value: "15551234567",
          display_name: null,
        },
        body: { text: null, html: null },
        attachments: [
          {
            filename: "receipt.pdf",
            content_type: "application/pdf",
            size_bytes: null,
            object_ref: "whatsapp-media:MEDIA_ID",
          },
        ],
      }),
    ).toMatchObject({ channel: "whatsapp" });
  });

  it("rejects unsupported inbound channels", () => {
    expect(() =>
      NormalizedInboundMessageSchema.parse({
        ...inboundMessage,
        channel: "chat_future",
      }),
    ).toThrow();
  });

  it("rejects a message with no text, html, or attachments", () => {
    expect(() =>
      NormalizedInboundMessageSchema.parse({
        ...inboundMessage,
        body: { text: null, html: null },
        attachments: [],
      }),
    ).toThrow(/attachment/);
  });

  it("rejects a missing external_message_id used for dedup", () => {
    const { external_message_id: _omitted, ...withoutId } = inboundMessage;

    expect(() => NormalizedInboundMessageSchema.parse(withoutId)).toThrow();
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      NormalizedInboundMessageSchema.parse({
        ...inboundMessage,
        unexpected_field: "value",
      }),
    ).toThrow();
  });
});

describe("normalized outbound message schema", () => {
  const outboundMessage = {
    tenant_id: "ten_test",
    conversation_id: "con_test",
    ticket_id: "tkt_con_test",
    channel_id: "chn_test",
    channel: "email",
    provider: "mailgun",
    to: {
      type: "email",
      value: "customer@example.com",
      display_name: "Customer Name",
    },
    direction: "outbound",
    subject: "Re: Where is my order?",
    body: {
      text: "Your order shipped yesterday.",
      html: null,
    },
    external_thread_id: "provider-thread-id",
    approval_id: "apr_test",
    ai_run_id: "run_test",
    sent_by_type: "human",
    sent_by_user_id: "usr_reviewer",
    idempotency_key: "outbound:ten_test:tkt_con_test:apr_test",
  };

  it("validates a canonical outbound email message", () => {
    expect(NormalizedOutboundMessageSchema.parse(outboundMessage)).toEqual(
      outboundMessage,
    );
  });

  it("accepts a WhatsApp outbound message without a subject", () => {
    expect(
      NormalizedOutboundMessageSchema.parse({
        ...outboundMessage,
        channel: "whatsapp",
        provider: "whatsapp_cloud",
        to: { type: "whatsapp_id", value: "15551234567", display_name: null },
        subject: null,
        external_thread_id: null,
      }),
    ).toMatchObject({ channel: "whatsapp" });
  });

  it("rejects an outbound message without body text", () => {
    expect(() =>
      NormalizedOutboundMessageSchema.parse({
        ...outboundMessage,
        body: { text: "", html: null },
      }),
    ).toThrow();
  });

  it("rejects a missing idempotency key", () => {
    const { idempotency_key: _omitted, ...withoutKey } = outboundMessage;

    expect(() => NormalizedOutboundMessageSchema.parse(withoutKey)).toThrow();
  });

  it("rejects inbound direction and unknown keys", () => {
    expect(() =>
      NormalizedOutboundMessageSchema.parse({
        ...outboundMessage,
        direction: "inbound",
      }),
    ).toThrow();
    expect(() =>
      NormalizedOutboundMessageSchema.parse({
        ...outboundMessage,
        unexpected_field: "value",
      }),
    ).toThrow();
  });
});

describe("approval decision request schemas", () => {
  it("accepts approve/reject/escalate with and without review notes", () => {
    expect(ApprovalApproveRequestSchema.parse({})).toEqual({});
    expect(
      ApprovalApproveRequestSchema.parse({ review_notes: "Looks right." }),
    ).toEqual({ review_notes: "Looks right." });
    expect(ApprovalRejectRequestSchema.parse({ review_notes: null })).toEqual({
      review_notes: null,
    });
    expect(ApprovalEscalateRequestSchema.parse({})).toEqual({});
  });

  it("requires the human-edited payload on edit", () => {
    expect(
      ApprovalEditRequestSchema.parse({
        approved_payload: { draft_text: "Edited response." },
        review_notes: "Softened the tone.",
      }),
    ).toMatchObject({ approved_payload: { draft_text: "Edited response." } });
    expect(() => ApprovalEditRequestSchema.parse({})).toThrow();
  });

  it("rejects unknown decision request keys", () => {
    expect(() =>
      ApprovalApproveRequestSchema.parse({ approved_payload: {} }),
    ).toThrow();
  });

  it("validates the decision response with the workflow signal result", () => {
    const decision = {
      approval: {
        approval_id: "apr_test",
        tenant_id: "ten_test",
        ticket_id: "tkt_test",
        ai_run_id: null,
        approval_type: "reply",
        status: "approved",
        requested_payload: { draft_text: "Original draft." },
        approved_payload: { draft_text: "Original draft." },
        reviewer_user_id: "usr_reviewer",
        review_notes: null,
        created_at: "2026-07-04T00:00:00.000Z",
        resolved_at: "2026-07-04T00:05:00.000Z",
      },
      workflow_signal: {
        delivered: true,
        workflow_id: "ticket-lifecycle:ten_test:con_test",
        reason: null,
      },
    };

    expect(ApprovalDecisionResponseSchema.parse(decision)).toEqual(decision);
  });
});

describe("tool registry schemas", () => {
  it("enumerates the canonical side-effect and permission classes", () => {
    expect(ToolSideEffectClassSchema.options).toEqual([
      "read_only",
      "draft_side_effect",
      "reversible_write",
      "irreversible_write",
    ]);
    expect(ToolPermissionClassSchema.options).toContain("order_read");
    expect(ToolPermissionClassSchema.options).toContain("kb_read");
  });

  it("validates a tool call request with an optional idempotency key", () => {
    const request = {
      tool_name: "order_lookup",
      arguments: { order_id: "ord_1001" },
      idempotency_key: "req-abc",
    };

    expect(ToolCallRequestSchema.parse(request)).toEqual(request);
  });

  it("rejects unknown keys on a tool call request", () => {
    expect(() =>
      ToolCallRequestSchema.parse({
        tool_name: "order_lookup",
        arguments: {},
        unexpected: true,
      }),
    ).toThrow();
  });

  it("accepts a succeeded result and rejects mixing error with output", () => {
    const succeeded = {
      status: "succeeded",
      tool_call_id: "tcl_1",
      tool_name: "order_lookup",
      side_effect_class: "read_only",
      output: { order_id: "ord_1001" },
      idempotent_replay: false,
    };

    expect(ToolCallResultSchema.parse(succeeded)).toEqual(succeeded);

    expect(() =>
      ToolCallResultSchema.parse({
        ...succeeded,
        error: { code: "tool_error", message: "boom" },
      }),
    ).toThrow();
  });

  it("accepts a blocked result carrying a structured error", () => {
    const blocked = {
      status: "blocked",
      tool_call_id: "tcl_2",
      tool_name: "order_lookup",
      side_effect_class: "read_only",
      error: { code: "unauthorized", message: "missing order_read" },
      idempotent_replay: false,
    };

    expect(ToolCallResultSchema.parse(blocked)).toEqual(blocked);
  });
});

describe("observability and qa review schemas", () => {
  const aiRun = {
    ai_run_id: "air_test",
    tenant_id: "ten_test",
    ticket_id: "tkt_test",
    conversation_id: "con_test",
    run_type: "full_graph",
    prompt_version: "support_graph.v1",
    model_provider: "deterministic",
    model_id: "deterministic-support-model.v1",
    input_refs: { correlation_id: "corr-1" },
    retrieved_context_refs: { evidence_ids: ["kb_chunk_1"] },
    structured_output: { draft: { draft_text: "Hello" } },
    confidence: 0.92,
    risk_level: "low",
    automation_recommendation: "human_approve",
    guardrail_results: { passed: true },
    status: "succeeded",
    latency_ms: 240,
    input_tokens: null,
    output_tokens: null,
    cost_estimate: null,
    trace_id: "trace_abc123",
    created_at: "2026-07-04T00:00:00.000Z",
    completed_at: "2026-07-04T00:00:01.000Z",
  };

  const toolCall = {
    tool_call_id: "tc_test",
    tenant_id: "ten_test",
    ticket_id: "tkt_test",
    ai_run_id: "air_test",
    tool_definition_id: "tool_order_lookup",
    input: { order_number: "ORD-1" },
    output: { order: { status: "shipped" } },
    status: "succeeded",
    side_effect_class: "read_only",
    idempotency_key: null,
    started_at: "2026-07-04T00:00:00.500Z",
    completed_at: "2026-07-04T00:00:00.700Z",
    error_code: null,
    error_message: null,
  };

  const qaReview = {
    qa_review_id: "qa_test",
    tenant_id: "ten_test",
    ticket_id: "tkt_test",
    ai_run_id: "air_test",
    reviewer_user_id: null,
    sample_reason: "auto_send_candidate",
    scores: {},
    defects: [],
    notes: null,
    created_at: "2026-07-04T00:01:00.000Z",
    completed_at: null,
  };

  it("validates ai run response, resource, and list contracts", () => {
    expect(AiRunResponseSchema.parse(aiRun)).toEqual(aiRun);
    expect(AiRunResourceResponseSchema.parse({ ai_run: aiRun })).toEqual({
      ai_run: aiRun,
    });
    expect(
      AiRunListResponseSchema.parse({
        ai_runs: [aiRun],
        page: { limit: 20, count: 1 },
      }).ai_runs,
    ).toHaveLength(1);
  });

  it("rejects ai runs with unknown status or run type", () => {
    expect(() =>
      AiRunResponseSchema.parse({ ...aiRun, status: "mystery" }),
    ).toThrow();
    expect(() =>
      AiRunResponseSchema.parse({ ...aiRun, run_type: "vibes" }),
    ).toThrow();
  });

  it("validates persisted tool call rows", () => {
    expect(ToolCallResponseSchema.parse(toolCall)).toEqual(toolCall);
    expect(() =>
      ToolCallResponseSchema.parse({ ...toolCall, status: "unknown" }),
    ).toThrow();
  });

  it("validates qa review response, resource, and list contracts", () => {
    expect(QaReviewResponseSchema.parse(qaReview)).toEqual(qaReview);
    expect(
      QaReviewResourceResponseSchema.parse({ qa_review: qaReview }),
    ).toEqual({ qa_review: qaReview });
    expect(
      QaReviewListResponseSchema.parse({
        qa_reviews: [qaReview],
        page: { limit: 20, count: 1 },
      }).qa_reviews,
    ).toHaveLength(1);
  });

  it("accepts qa review create requests with enum sample reasons only", () => {
    expect(
      QaReviewCreateRequestSchema.parse({
        ticket_id: "tkt_test",
        ai_run_id: "air_test",
        sample_reason: "manual",
      }),
    ).toMatchObject({ sample_reason: "manual" });
    expect(() =>
      QaReviewCreateRequestSchema.parse({
        ticket_id: "tkt_test",
        sample_reason: "because",
      }),
    ).toThrow();
    expect(() =>
      QaReviewCreateRequestSchema.parse({
        ticket_id: "tkt_test",
        sample_reason: "manual",
        surprise: true,
      }),
    ).toThrow();
  });

  it("validates qa review completion scores and defect taxonomy", () => {
    expect(
      QaReviewCompleteRequestSchema.parse({
        scores: { draft_quality: 4, safety: 5 },
        defects: [{ category: "bad_tone", severity: "low", note: "Curt." }],
        notes: "Overall fine.",
      }).defects,
    ).toHaveLength(1);
    expect(() =>
      QaReviewCompleteRequestSchema.parse({
        scores: { draft_quality: 9 },
        defects: [],
      }),
    ).toThrow();
    expect(() =>
      QaReviewCompleteRequestSchema.parse({
        scores: {},
        defects: [{ category: "made_up_defect" }],
      }),
    ).toThrow();
  });

  it("validates the composite qa evidence package", () => {
    const evidence = {
      qa_review: qaReview,
      ticket: {
        ticket_id: "tkt_test",
        tenant_id: "ten_test",
        conversation_id: "con_test",
        customer_id: "cus_test",
        status: "waiting_human",
        priority: "p2",
        topic: "refund_request",
        subtopic: null,
        language: "en",
        sentiment: null,
        urgency_score: null,
        automation_mode: "human_approve",
        assigned_queue: null,
        assigned_user_id: null,
        sla_policy_id: null,
        policy_version_id: null,
        opened_at: "2026-07-04T00:00:00.000Z",
        first_response_due_at: null,
        next_response_due_at: null,
        resolution_due_at: null,
        resolved_at: null,
        closed_at: null,
        created_at: "2026-07-04T00:00:00.000Z",
        updated_at: "2026-07-04T00:00:00.000Z",
      },
      conversation: {
        conversation_id: "con_test",
        tenant_id: "ten_test",
        customer_id: "cus_test",
        channel_id: "chn_test",
        external_thread_id: "thread-1",
        status: "open",
        last_message_at: "2026-07-04T00:00:00.000Z",
        created_at: "2026-07-04T00:00:00.000Z",
        updated_at: "2026-07-04T00:00:00.000Z",
      },
      messages: [
        {
          message_id: "msg_in",
          tenant_id: "ten_test",
          conversation_id: "con_test",
          ticket_id: "tkt_test",
          channel_id: "chn_test",
          direction: "inbound",
          body_text: "Where is my refund?",
          body_html_ref: null,
          attachments: [],
          external_message_id: "ext-1",
          external_thread_id: "thread-1",
          raw_payload_ref: "file:///raw/1",
          created_by_type: "customer",
          created_by_user_id: null,
          provider_message_id: null,
          send_status: null,
          sent_by_type: null,
          ai_run_id: null,
          approval_id: null,
          sent_at: null,
          idempotency_key: "in-1",
          created_at: "2026-07-04T00:00:00.000Z",
        },
      ],
      ai_run: aiRun,
      tool_calls: [toolCall],
      approvals: [
        {
          approval_id: "apr_test",
          tenant_id: "ten_test",
          ticket_id: "tkt_test",
          ai_run_id: "air_test",
          approval_type: "reply",
          status: "edited",
          requested_payload: { draft_text: "Original AI draft." },
          approved_payload: { draft_text: "Human-edited reply." },
          reviewer_user_id: "usr_reviewer",
          review_notes: "Softened tone.",
          created_at: "2026-07-04T00:00:02.000Z",
          resolved_at: "2026-07-04T00:04:00.000Z",
        },
      ],
    };

    const parsed = QaReviewEvidenceResponseSchema.parse(evidence);
    expect(parsed.ai_run?.trace_id).toBe("trace_abc123");
    expect(parsed.approvals[0]?.requested_payload).toEqual({
      draft_text: "Original AI draft.",
    });
    expect(parsed.approvals[0]?.approved_payload).toEqual({
      draft_text: "Human-edited reply.",
    });
  });
});

describe("security and pilot readiness schemas", () => {
  it("accepts a tenant retention policy and rejects unknown keys", () => {
    const parsed = TenantRetentionPolicySchema.parse({
      raw_payload_days: 30,
      attachment_days: 30,
      ai_run_days: 180,
      audit_event_days: null,
    });
    expect(parsed.raw_payload_days).toBe(30);
    expect(TenantRetentionPolicySchema.parse({})).toEqual({});
    expect(() =>
      TenantRetentionPolicySchema.parse({ raw_payload_days: 0 }),
    ).toThrow();
    expect(() =>
      TenantRetentionPolicySchema.parse({ message_days: 10 }),
    ).toThrow();
  });

  it("constrains automation policy content to the closed low-risk topic set", () => {
    const parsed = AutomationPolicyContentSchema.parse({
      auto_send_enabled: true,
      auto_send_allowed_topics: ["faq", "order_status"],
    });
    expect(parsed.auto_send_allowed_topics).toEqual(["faq", "order_status"]);
    expect(AutoSendTopicSchema.options).toEqual(["faq", "order_status"]);
    expect(() =>
      AutomationPolicyContentSchema.parse({
        auto_send_enabled: true,
        auto_send_allowed_topics: ["refund"],
      }),
    ).toThrow();
    expect(() =>
      AutomationPolicyContentSchema.parse({
        auto_send_allowed_topics: [],
      }),
    ).toThrow();
    expect(() =>
      AutomationPolicyContentSchema.parse({
        auto_send_enabled: false,
        auto_send_allowed_topics: [],
        kill_switch: true,
      }),
    ).toThrow();
  });

  it("resolves an effective automation policy response", () => {
    const configured = EffectiveAutomationPolicyResponseSchema.parse({
      tenant_id: "ten_test",
      configured: true,
      policy_id: "pol_automation",
      policy_version_id: "polv_automation_1",
      version: 1,
      activated_at: "2026-07-04T00:00:00.000Z",
      auto_send_enabled: false,
      auto_send_allowed_topics: [],
    });
    expect(configured.configured).toBe(true);

    const unconfigured = EffectiveAutomationPolicyResponseSchema.parse({
      tenant_id: "ten_test",
      configured: false,
      policy_id: null,
      policy_version_id: null,
      version: null,
      activated_at: null,
      auto_send_enabled: false,
      auto_send_allowed_topics: [],
    });
    expect(unconfigured.auto_send_enabled).toBe(false);
  });

  it("keeps the audit action taxonomy closed and covers required families", () => {
    const actions = SupportAuditActionSchema.options;
    for (const requiredFamilyMember of [
      "ticket.sla_breached",
      "ai_graph.failed",
      "approval.requested",
      "approval.approved",
      "message.sent",
      "retention.applied",
      "policy.activated",
      "integration.credential_changed",
      "permission.granted",
    ]) {
      expect(actions).toContain(requiredFamilyMember);
    }
    expect(() => SupportAuditActionSchema.parse("ticket.deleted")).toThrow();
  });

  it("accepts a weekly pilot report with null rates for empty denominators", () => {
    const report = WeeklyPilotReportSchema.parse({
      tenant_id: "ten_pilot",
      window: {
        since: "2026-06-27T00:00:00.000Z",
        until: "2026-07-04T00:00:00.000Z",
      },
      tickets: {
        created: 12,
        resolved: 8,
        manual_escalations: 1,
        sla_breaches: 2,
        first_response_minutes_avg: 42.5,
        resolution_minutes_avg: 300,
        escalation_rate: 1 / 12,
      },
      ai_runs: { total: 10, succeeded: 9, failed: 1, draft_rate: 0.75 },
      approvals: {
        requested: 9,
        approved: 6,
        edited: 2,
        rejected: 1,
        escalated: 0,
        approval_rate: 8 / 9,
      },
      outbound_messages: {
        sent: 8,
        failed: 0,
        auto_sent: 0,
        auto_send_rate: 0,
      },
      qa_reviews: {
        created: 3,
        completed: 2,
        with_defects: 1,
        defect_rate: 0.5,
      },
      top_topics: [
        { topic: "order_status", count: 5 },
        { topic: "refund", count: 3 },
      ],
    });
    expect(report.tickets.created).toBe(12);

    const empty = WeeklyPilotReportSchema.parse({
      tenant_id: "ten_pilot",
      window: {
        since: "2026-06-27T00:00:00.000Z",
        until: "2026-07-04T00:00:00.000Z",
      },
      tickets: {
        created: 0,
        resolved: 0,
        manual_escalations: 0,
        sla_breaches: 0,
        first_response_minutes_avg: null,
        resolution_minutes_avg: null,
        escalation_rate: null,
      },
      ai_runs: { total: 0, succeeded: 0, failed: 0, draft_rate: null },
      approvals: {
        requested: 0,
        approved: 0,
        edited: 0,
        rejected: 0,
        escalated: 0,
        approval_rate: null,
      },
      outbound_messages: {
        sent: 0,
        failed: 0,
        auto_sent: 0,
        auto_send_rate: null,
      },
      qa_reviews: {
        created: 0,
        completed: 0,
        with_defects: 0,
        defect_rate: null,
      },
      top_topics: [],
    });
    expect(empty.top_topics).toEqual([]);
  });
});
