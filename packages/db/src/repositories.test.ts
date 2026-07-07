import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDatabase, type PostgresClient } from "./client.js";
import {
  activeAutomationPolicyVersionQuery,
  activeKbChunksForDocumentQuery,
  activeSlaPolicyForTenantQuery,
  createTicketEventQuery,
  createTicketIfAbsentQuery,
  linkMessageToTicketByIdQuery,
  ticketEventsForTicketQuery,
  aiDraftedTicketsCountQuery,
  aiRunByIdQuery,
  aiRunStatusCountsQuery,
  approvalResolutionCountsQuery,
  approvalsRequestedCountQuery,
  auditActionCountQuery,
  clearMessageRawPayloadRefsQuery,
  anonymizeAiRunsQuery,
  clearMessageAttachmentsQuery,
  expiredAiRunsForAnonymizationQuery,
  expiredAttachmentMessagesQuery,
  expiredRawPayloadMessagesQuery,
  firstResponseMinutesAvgQuery,
  outboundMessageCountsQuery,
  qaReviewsCompletedStatsQuery,
  qaReviewsCreatedCountQuery,
  ticketTopTopicsQuery,
  ticketsCreatedCountQuery,
  ticketsResolvedStatsQuery,
  aiRunsListQuery,
  completeAiRunByIdQuery,
  completeQaReviewByIdQuery,
  createAiRunQuery,
  createQaReviewQuery,
  qaReviewByIdQuery,
  qaReviewsListQuery,
  qaSamplingCandidatesQuery,
  toolCallsListQuery,
  approvalByIdQuery,
  approvalsListQuery,
  auditEventByIdQuery,
  auditEventsForEntityQuery,
  auditEventsListQuery,
  channelByIdQuery,
  conversationByExternalThreadQuery,
  conversationsListQuery,
  conversationByIdQuery,
  createApprovalQuery,
  createAuditEventQuery,
  createInboundMessageQuery,
  createKbDocumentQuery,
  createOutboundMessageQuery,
  customerIdentityByValueQuery,
  customerIdentityForCustomerQuery,
  deleteKbChunksForDocumentQuery,
  insertKbChunksQuery,
  customersListQuery,
  customerByIdQuery,
  integrationByIdQuery,
  kbDocumentByIdQuery,
  kbDocumentsListQuery,
  messageByExternalIdQuery,
  messageByIdQuery,
  messageByIdempotencyKeyQuery,
  messagesListQuery,
  resolvePendingApprovalByIdQuery,
  policiesListQuery,
  policyByIdQuery,
  searchKbChunksQuery,
  tenantsListQuery,
  tenantByIdQuery,
  ticketsListQuery,
  ticketByIdQuery,
  updateCustomerByIdQuery,
  updateKbDocumentByIdQuery,
  updateMessageSendResultByIdQuery,
  updateTicketByIdQuery,
  visibleToolDefinitionByNameQuery,
} from "./repositories.js";

const clients: PostgresClient[] = [];

function makeDb() {
  const client = postgres(
    "postgres://support:support@localhost:65535/support",
    {
      max: 1,
      connect_timeout: 1,
    },
  );
  clients.push(client);
  return createDatabase(client);
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end()));
});

describe("tenant-scoped repository queries", () => {
  it("builds tenant list reads with a bounded limit", () => {
    const query = tenantsListQuery(makeDb(), { limit: 25 });
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('from "tenants"');
    expect(compiled.sql).toContain("limit $1");
    expect(compiled.params).toEqual([25]);
  });

  it("scopes tenant reads by the current tenant", () => {
    const query = tenantByIdQuery(makeDb(), { tenantId: "ten_a" }, "ten_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tenants"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tenants"."tenant_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "ten_a", 1]);
  });

  it("scopes customer reads by tenant", () => {
    const query = customerByIdQuery(makeDb(), { tenantId: "ten_a" }, "cus_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"customers"."tenant_id" = $1');
    expect(compiled.sql).toContain('"customers"."customer_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "cus_a", 1]);
  });

  it("scopes customer list reads by tenant and filters", () => {
    const query = customersListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 10,
        email: "customer@example.test",
        externalCustomerRef: "external-a",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"customers"."tenant_id" = $1');
    expect(compiled.sql).toContain('"customers"."email" = $2');
    expect(compiled.sql).toContain('"customers"."external_customer_ref" = $3');
    expect(compiled.params).toEqual([
      "ten_a",
      "customer@example.test",
      "external-a",
      10,
    ]);
  });

  it("scopes customer updates by tenant and id", () => {
    const query = updateCustomerByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "cus_a",
      { displayName: "Updated Customer" },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"customers"."tenant_id" = $2');
    expect(compiled.sql).toContain('"customers"."customer_id" = $3');
    expect(compiled.params).toEqual(["Updated Customer", "ten_a", "cus_a"]);
  });

  it("scopes conversation list reads by tenant and filters", () => {
    const query = conversationsListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 10,
        status: "open",
        customerId: "cus_a",
        channelId: "chn_a",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"conversations"."tenant_id" = $1');
    expect(compiled.sql).toContain('"conversations"."status" = $2');
    expect(compiled.sql).toContain('"conversations"."customer_id" = $3');
    expect(compiled.sql).toContain('"conversations"."channel_id" = $4');
    expect(compiled.params).toEqual(["ten_a", "open", "cus_a", "chn_a", 10]);
  });

  it("scopes conversation reads by tenant", () => {
    const query = conversationByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "cnv_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"conversations"."tenant_id" = $1');
    expect(compiled.sql).toContain('"conversations"."conversation_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "cnv_a", 1]);
  });

  it("scopes message list reads by tenant, conversation, and filters", () => {
    const query = messagesListQuery(makeDb(), { tenantId: "ten_a" }, "cnv_a", {
      limit: 10,
      direction: "inbound",
      ticketId: "tic_a",
    });
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"messages"."tenant_id" = $1');
    expect(compiled.sql).toContain('"messages"."conversation_id" = $2');
    expect(compiled.sql).toContain('"messages"."direction" = $3');
    expect(compiled.sql).toContain('"messages"."ticket_id" = $4');
    expect(compiled.params).toEqual(["ten_a", "cnv_a", "inbound", "tic_a", 10]);
  });

  it("scopes message reads by tenant and conversation", () => {
    const query = messageByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "cnv_a",
      "msg_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"messages"."tenant_id" = $1');
    expect(compiled.sql).toContain('"messages"."conversation_id" = $2');
    expect(compiled.sql).toContain('"messages"."message_id" = $3');
    expect(compiled.params).toEqual(["ten_a", "cnv_a", "msg_a", 1]);
  });

  it("scopes ticket reads by tenant", () => {
    const query = ticketByIdQuery(makeDb(), { tenantId: "ten_a" }, "tic_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tickets"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tickets"."ticket_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "tic_a", 1]);
  });

  it("scopes ticket list reads by tenant and filters", () => {
    const query = ticketsListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 10,
        status: "new",
        customerId: "cus_a",
        assignedQueue: "tier-1",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tickets"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tickets"."status" = $2');
    expect(compiled.sql).toContain('"tickets"."customer_id" = $3');
    expect(compiled.sql).toContain('"tickets"."assigned_queue" = $4');
    expect(compiled.params).toEqual(["ten_a", "new", "cus_a", "tier-1", 10]);
  });

  it("scopes ticket updates by tenant and id", () => {
    const query = updateTicketByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "tic_a",
      { priority: "p1" },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tickets"."tenant_id" = $2');
    expect(compiled.sql).toContain('"tickets"."ticket_id" = $3');
    expect(compiled.params).toEqual(["p1", "ten_a", "tic_a"]);
  });

  it("creates tickets conflict-safely for deterministic workflow ids", () => {
    const query = createTicketIfAbsentQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        ticketId: "tkt_cnv_a",
        conversationId: "cnv_a",
        customerId: "cus_a",
        openedAt: new Date("2026-07-04T00:00:00.000Z"),
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('insert into "tickets"');
    expect(compiled.sql).toContain("on conflict do nothing");
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("tkt_cnv_a");
  });

  it("selects the tenant's active sla policy oldest-first", () => {
    const query = activeSlaPolicyForTenantQuery(makeDb(), {
      tenantId: "ten_a",
    });
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"sla_policies"."tenant_id" = $1');
    expect(compiled.sql).toContain('"sla_policies"."status" = $2');
    expect(compiled.sql).toContain("order by");
    expect(compiled.params).toEqual(["ten_a", "active", 1]);
  });

  it("appends ticket events with conflict-safe deterministic ids", () => {
    const query = createTicketEventQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        ticketEventId: "tev_a",
        ticketId: "tkt_cnv_a",
        eventType: "ticket_state_transition",
        fromStatus: "new",
        toStatus: "triaged",
        actorType: "system",
        actorId: "workflow",
        reasonCode: "triage",
        metadata: {},
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('insert into "ticket_events"');
    expect(compiled.sql).toContain("on conflict do nothing");
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("tev_a");
    expect(compiled.params).toContain("triaged");
  });

  it("lists ticket events for a ticket scoped by tenant", () => {
    const query = ticketEventsForTicketQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "tkt_cnv_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"ticket_events"."tenant_id" = $1');
    expect(compiled.sql).toContain('"ticket_events"."ticket_id" = $2');
    expect(compiled.sql).toContain("order by");
    expect(compiled.params).toEqual(["ten_a", "tkt_cnv_a"]);
  });

  it("links messages to tickets only when unlinked or replaying", () => {
    const query = linkMessageToTicketByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "msg_a",
      "tkt_cnv_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('update "messages"');
    expect(compiled.sql).toContain('"messages"."tenant_id" = $2');
    expect(compiled.sql).toContain('"messages"."message_id" = $3');
    expect(compiled.sql).toContain('"messages"."ticket_id" is null');
    expect(compiled.sql).toContain('"messages"."ticket_id" = $4');
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toEqual([
      "tkt_cnv_a",
      "ten_a",
      "msg_a",
      "tkt_cnv_a",
    ]);
  });

  it("scopes policy reads by tenant", () => {
    const query = policyByIdQuery(makeDb(), { tenantId: "ten_a" }, "pol_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tenant_policies"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tenant_policies"."policy_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "pol_a", 1]);
  });

  it("scopes policy list reads by tenant and filters", () => {
    const query = policiesListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 10,
        domain: "shipping",
        status: "active",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tenant_policies"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tenant_policies"."domain" = $2');
    expect(compiled.sql).toContain('"tenant_policies"."status" = $3');
    expect(compiled.params).toEqual(["ten_a", "shipping", "active", 10]);
  });

  it("scopes active KB chunk retrieval by tenant and document", () => {
    const query = activeKbChunksForDocumentQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "kbd_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"kb_chunks"."tenant_id" = $1');
    expect(compiled.sql).toContain('"kb_chunks"."kb_document_id" = $2');
    expect(compiled.sql).toContain('"kb_chunks"."status" = $3');
    expect(compiled.params).toEqual(["ten_a", "kbd_a", "active"]);
  });

  it("scopes KB chunk vector search by tenant, active status, and document filters", () => {
    const embedding = [0.1, 0.2, 0.3];
    const query = searchKbChunksQuery(
      makeDb(),
      { tenantId: "ten_a" },
      { embedding, limit: 5, documentType: "policy", sourceType: "manual" },
    );
    const compiled = query.toSQL();

    // Cosine nearest-neighbour ordering over the HNSW-indexed embedding.
    expect(compiled.sql).toContain('"kb_chunks"."embedding" <=>');
    expect(compiled.sql).toContain("order by");
    expect(compiled.sql).toContain("limit");
    // Joined to documents so retrieval can carry citation metadata.
    expect(compiled.sql).toContain('"kb_documents"');
    // Tenant + active-chunk + active-document (stale exclusion) + type filters.
    expect(compiled.sql).toContain('"kb_chunks"."tenant_id" = $2');
    expect(compiled.sql).toContain('"kb_chunks"."status" = $3');
    expect(compiled.sql).toContain('"kb_documents"."tenant_id" = $4');
    expect(compiled.sql).toContain('"kb_documents"."status" = $5');
    expect(compiled.sql).toContain('"kb_documents"."document_type" = $6');
    expect(compiled.sql).toContain('"kb_documents"."source_type" = $7');
    // The cosine expression appears in both the SELECT list and ORDER BY, so
    // the embedding is bound twice; the bounded limit is last.
    expect(compiled.params).toEqual([
      JSON.stringify(embedding),
      "ten_a",
      "active",
      "ten_a",
      "active",
      "policy",
      "manual",
      JSON.stringify(embedding),
      5,
    ]);
  });

  it("scopes KB document reads by tenant", () => {
    const query = kbDocumentByIdQuery(makeDb(), { tenantId: "ten_a" }, "kbd_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"kb_documents"."tenant_id" = $1');
    expect(compiled.sql).toContain('"kb_documents"."kb_document_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "kbd_a", 1]);
  });

  it("scopes KB document list reads by tenant and filters", () => {
    const query = kbDocumentsListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 10,
        sourceType: "manual",
        documentType: "policy",
        status: "active",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"kb_documents"."tenant_id" = $1');
    expect(compiled.sql).toContain('"kb_documents"."source_type" = $2');
    expect(compiled.sql).toContain('"kb_documents"."document_type" = $3');
    expect(compiled.sql).toContain('"kb_documents"."status" = $4');
    expect(compiled.params).toEqual([
      "ten_a",
      "manual",
      "policy",
      "active",
      10,
    ]);
  });

  it("stamps the tenant on KB document inserts", () => {
    const query = createKbDocumentQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        kbDocumentId: "kbd_a",
        title: "Policy",
        sourceType: "manual",
        sourceRef: null,
        documentType: "policy",
        status: "draft",
        version: 1,
        contentHash: "hash_a",
        createdByUserId: null,
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('insert into "kb_documents"');
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("kbd_a");
  });

  it("scopes KB document updates by tenant and id", () => {
    const query = updateKbDocumentByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "kbd_a",
      { status: "active" },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('update "kb_documents"');
    expect(compiled.sql).toContain('"kb_documents"."tenant_id" = $');
    expect(compiled.sql).toContain('"kb_documents"."kb_document_id" = $');
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("kbd_a");
  });

  it("scopes KB chunk deletion by tenant and document", () => {
    const query = deleteKbChunksForDocumentQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "kbd_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('delete from "kb_chunks"');
    expect(compiled.sql).toContain('"kb_chunks"."tenant_id" = $1');
    expect(compiled.sql).toContain('"kb_chunks"."kb_document_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "kbd_a"]);
  });

  it("stamps the tenant on KB chunk inserts", () => {
    const query = insertKbChunksQuery(makeDb(), { tenantId: "ten_a" }, [
      {
        kbChunkId: "kbc_a",
        kbDocumentId: "kbd_a",
        chunkIndex: 0,
        content: "chunk text",
        embedding: [0.1, 0.2, 0.3],
        metadata: { document_type: "policy" },
        status: "active",
      },
    ]);
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('insert into "kb_chunks"');
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("kbc_a");
  });

  it("scopes approval reads by tenant", () => {
    const query = approvalByIdQuery(makeDb(), { tenantId: "ten_a" }, "apr_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"approvals"."tenant_id" = $1');
    expect(compiled.sql).toContain('"approvals"."approval_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "apr_a", 1]);
  });

  it("scopes approval list reads by tenant and filters", () => {
    const query = approvalsListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 10,
        status: "pending",
        ticketId: "tic_a",
        approvalType: "reply",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"approvals"."tenant_id" = $1');
    expect(compiled.sql).toContain('"approvals"."status" = $2');
    expect(compiled.sql).toContain('"approvals"."ticket_id" = $3');
    expect(compiled.sql).toContain('"approvals"."approval_type" = $4');
    expect(compiled.params).toEqual(["ten_a", "pending", "tic_a", "reply", 10]);
  });

  it("scopes audit reads by tenant and entity", () => {
    const query = auditEventsForEntityQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "ticket",
      "tic_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"audit_events"."tenant_id" = $1');
    expect(compiled.sql).toContain('"audit_events"."entity_type" = $2');
    expect(compiled.sql).toContain('"audit_events"."entity_id" = $3');
    expect(compiled.params).toEqual(["ten_a", "ticket", "tic_a"]);
  });

  it("scopes audit reads by tenant and ID", () => {
    const query = auditEventByIdQuery(makeDb(), { tenantId: "ten_a" }, "aud_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"audit_events"."tenant_id" = $1');
    expect(compiled.sql).toContain('"audit_events"."audit_event_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "aud_a", 1]);
  });

  it("scopes audit list reads by tenant and filters", () => {
    const query = auditEventsListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 10,
        actorType: "system",
        entityType: "ticket",
        entityId: "tic_a",
        action: "ticket.created",
        correlationId: "corr_a",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"audit_events"."tenant_id" = $1');
    expect(compiled.sql).toContain('"audit_events"."actor_type" = $2');
    expect(compiled.sql).toContain('"audit_events"."entity_type" = $3');
    expect(compiled.sql).toContain('"audit_events"."entity_id" = $4');
    expect(compiled.sql).toContain('"audit_events"."action" = $5');
    expect(compiled.sql).toContain('"audit_events"."correlation_id" = $6');
    expect(compiled.params).toEqual([
      "ten_a",
      "system",
      "ticket",
      "tic_a",
      "ticket.created",
      "corr_a",
      10,
    ]);
  });

  it("scopes integration reads by tenant", () => {
    const query = integrationByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "int_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"integrations"."tenant_id" = $1');
    expect(compiled.sql).toContain('"integrations"."integration_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "int_a", 1]);
  });

  it("allows active global tool definitions but excludes other tenants", () => {
    const query = visibleToolDefinitionByNameQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "order_lookup",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tool_definitions"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tool_definitions"."tenant_id" is null');
    expect(compiled.sql).toContain('"tool_definitions"."name" = $2');
    expect(compiled.sql).toContain('"tool_definitions"."status" = $3');
    expect(compiled.params).toEqual(["ten_a", "order_lookup", "active", 1]);
  });

  it("resolves a channel by id without a tenant scope", () => {
    const query = channelByIdQuery(makeDb(), "chn_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('from "channels"');
    expect(compiled.sql).toContain('"channels"."channel_id" = $1');
    expect(compiled.params).toEqual(["chn_a", 1]);
  });

  it("resolves a customer identity within a tenant, channel, and type", () => {
    const query = customerIdentityByValueQuery(
      makeDb(),
      { tenantId: "ten_a" },
      { channel: "email", identityType: "email", identityValue: "a@b.test" },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"customer_identities"."tenant_id" = $1');
    expect(compiled.sql).toContain('"customer_identities"."channel" = $2');
    expect(compiled.sql).toContain(
      '"customer_identities"."identity_type" = $3',
    );
    expect(compiled.sql).toContain(
      '"customer_identities"."identity_value" = $4',
    );
    expect(compiled.params).toEqual(["ten_a", "email", "email", "a@b.test", 1]);
  });

  it("finds a conversation by tenant, channel, and external thread id", () => {
    const query = conversationByExternalThreadQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "chn_a",
      "thread-1",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"conversations"."tenant_id" = $1');
    expect(compiled.sql).toContain('"conversations"."channel_id" = $2');
    expect(compiled.sql).toContain('"conversations"."external_thread_id" = $3');
    expect(compiled.params).toEqual(["ten_a", "chn_a", "thread-1", 1]);
  });

  it("dedups inbound message reads by tenant, channel, and external message id", () => {
    const query = messageByExternalIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "chn_a",
      "provider-msg-1",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"messages"."tenant_id" = $1');
    expect(compiled.sql).toContain('"messages"."channel_id" = $2');
    expect(compiled.sql).toContain('"messages"."external_message_id" = $3');
    expect(compiled.params).toEqual(["ten_a", "chn_a", "provider-msg-1", 1]);
  });

  it("inserts inbound messages with conflict-safe dedup", () => {
    const query = createInboundMessageQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        messageId: "msg_a",
        conversationId: "cnv_a",
        channelId: "chn_a",
        direction: "inbound",
        createdByType: "customer",
        bodyText: "hi",
        bodyHtmlRef: null,
        attachments: [],
        externalMessageId: "provider-msg-1",
        externalThreadId: "thread-1",
        rawPayloadRef: "file://raw/1",
        idempotencyKey: "provider-msg-1",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('insert into "messages"');
    expect(compiled.sql).toContain("on conflict do nothing");
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("ten_a");
  });

  it("resolves outbound recipient identities by customer and channel", () => {
    const query = customerIdentityForCustomerQuery(
      makeDb(),
      { tenantId: "ten_a" },
      { customerId: "cus_a", channel: "email" },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"customer_identities"."tenant_id" = $1');
    expect(compiled.sql).toContain('"customer_identities"."customer_id" = $2');
    expect(compiled.sql).toContain('"customer_identities"."channel" = $3');
    expect(compiled.sql).toContain("order by");
    expect(compiled.params).toEqual(["ten_a", "cus_a", "email", 1]);
  });

  it("reads AI runs by tenant and id for foreign-key linking", () => {
    const query = aiRunByIdQuery(makeDb(), { tenantId: "ten_a" }, "run_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"ai_runs"."tenant_id" = $1');
    expect(compiled.sql).toContain('"ai_runs"."ai_run_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "run_a", 1]);
  });

  it("inserts approvals with conflict-safe retry dedup", () => {
    const query = createApprovalQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        approvalId: "apr_a",
        ticketId: "tic_a",
        aiRunId: null,
        approvalType: "reply",
        status: "pending",
        requestedPayload: { draft_text: "Original draft." },
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('insert into "approvals"');
    expect(compiled.sql).toContain("on conflict do nothing");
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("apr_a");
  });

  it("resolves approvals only while they are still pending", () => {
    const query = resolvePendingApprovalByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "apr_a",
      {
        status: "approved",
        reviewerUserId: "usr_reviewer",
        resolvedAt: new Date("2026-07-04T00:00:00.000Z"),
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('update "approvals"');
    expect(compiled.sql).toContain('"approvals"."tenant_id" = ');
    expect(compiled.sql).toContain('"approvals"."approval_id" = ');
    expect(compiled.sql).toContain('"approvals"."status" = ');
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("apr_a");
    expect(compiled.params).toContain("pending");
  });

  it("reads outbound sends by tenant and idempotency key", () => {
    const query = messageByIdempotencyKeyQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "outbound:ten_a:tic_a:apr_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"messages"."tenant_id" = $1');
    expect(compiled.sql).toContain('"messages"."idempotency_key" = $2');
    expect(compiled.params).toEqual(["ten_a", "outbound:ten_a:tic_a:apr_a", 1]);
  });

  it("inserts outbound messages with conflict-safe idempotency", () => {
    const query = createOutboundMessageQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        messageId: "msg_out_a",
        conversationId: "cnv_a",
        ticketId: "tic_a",
        channelId: "chn_a",
        direction: "outbound",
        createdByType: "human",
        bodyText: "Your order shipped yesterday.",
        sendStatus: "queued",
        sentByType: "human",
        approvalId: "apr_a",
        idempotencyKey: "outbound:ten_a:tic_a:apr_a",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('insert into "messages"');
    expect(compiled.sql).toContain("on conflict do nothing");
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("outbound:ten_a:tic_a:apr_a");
  });

  it("records terminal outbound send results by tenant and message id", () => {
    const query = updateMessageSendResultByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "msg_out_a",
      {
        sendStatus: "sent",
        providerMessageId: "provider-out-1",
        sentAt: new Date("2026-07-04T00:00:00.000Z"),
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('update "messages"');
    expect(compiled.sql).toContain('"messages"."tenant_id" = ');
    expect(compiled.sql).toContain('"messages"."message_id" = ');
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("msg_out_a");
    expect(compiled.params).toContain("provider-out-1");
  });

  it("appends audit events with conflict-safe deterministic ids", () => {
    const query = createAuditEventQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        auditEventId: "aud_a",
        actorType: "human",
        actorId: "usr_reviewer",
        entityType: "approval",
        entityId: "apr_a",
        action: "approval.approved",
        metadata: { status: "approved" },
        correlationId: "corr-1",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('insert into "audit_events"');
    expect(compiled.sql).toContain("on conflict do nothing");
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("approval.approved");
  });

  it("inserts ai runs with conflict-safe retry dedup", () => {
    const query = createAiRunQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        aiRunId: "air_a",
        ticketId: "tic_a",
        conversationId: "cnv_a",
        runType: "full_graph",
        promptVersion: "support_graph.v1",
        modelProvider: "deterministic",
        modelId: "deterministic-support-model.v1",
        status: "succeeded",
        traceId: "trace_a",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('insert into "ai_runs"');
    expect(compiled.sql).toContain("on conflict do nothing");
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("air_a");
    expect(compiled.params).toContain("trace_a");
  });

  it("completes ai runs scoped by tenant and run id", () => {
    const query = completeAiRunByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "air_a",
      {
        status: "succeeded",
        latencyMs: 250,
        completedAt: new Date("2026-07-04T00:00:00.000Z"),
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('update "ai_runs"');
    expect(compiled.sql).toContain('"ai_runs"."tenant_id" = ');
    expect(compiled.sql).toContain('"ai_runs"."ai_run_id" = ');
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("air_a");
  });

  it("lists ai runs with ticket, status, and run type filters", () => {
    const query = aiRunsListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 20,
        ticketId: "tic_a",
        status: "succeeded",
        runType: "full_graph",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"ai_runs"."tenant_id" = ');
    expect(compiled.sql).toContain('"ai_runs"."ticket_id" = ');
    expect(compiled.sql).toContain('"ai_runs"."status" = ');
    expect(compiled.sql).toContain('"ai_runs"."run_type" = ');
    expect(compiled.sql).toContain("order by");
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("succeeded");
  });

  it("lists tool calls filtered by ticket and ai run", () => {
    const query = toolCallsListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      { limit: 50, ticketId: "tic_a", aiRunId: "air_a" },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tool_calls"."tenant_id" = ');
    expect(compiled.sql).toContain('"tool_calls"."ticket_id" = ');
    expect(compiled.sql).toContain('"tool_calls"."ai_run_id" = ');
    expect(compiled.params).toContain("air_a");
  });

  it("inserts qa reviews with conflict-safe sampling dedup", () => {
    const query = createQaReviewQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        qaReviewId: "qa_a",
        ticketId: "tic_a",
        aiRunId: "air_a",
        sampleReason: "auto_send_candidate",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('insert into "qa_reviews"');
    expect(compiled.sql).toContain("on conflict do nothing");
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("qa_a");
    expect(compiled.params).toContain("auto_send_candidate");
  });

  it("reads qa reviews by tenant and id", () => {
    const query = qaReviewByIdQuery(makeDb(), { tenantId: "ten_a" }, "qa_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"qa_reviews"."tenant_id" = $1');
    expect(compiled.sql).toContain('"qa_reviews"."qa_review_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "qa_a", 1]);
  });

  it("lists qa reviews with ticket, ai run, and completion filters", () => {
    const query = qaReviewsListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      { limit: 20, ticketId: "tic_a", aiRunId: "air_a", completed: false },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"qa_reviews"."tenant_id" = ');
    expect(compiled.sql).toContain('"qa_reviews"."ticket_id" = ');
    expect(compiled.sql).toContain('"qa_reviews"."ai_run_id" = ');
    expect(compiled.sql).toContain('"qa_reviews"."completed_at" is null');
    expect(compiled.params).toContain("tic_a");
  });

  it("completes qa reviews only while they are still open", () => {
    const query = completeQaReviewByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "qa_a",
      {
        reviewerUserId: "usr_reviewer",
        scores: { draft_quality: 4 },
        defects: [{ category: "bad_tone" }],
        completedAt: new Date("2026-07-04T00:00:00.000Z"),
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('update "qa_reviews"');
    expect(compiled.sql).toContain('"qa_reviews"."tenant_id" = ');
    expect(compiled.sql).toContain('"qa_reviews"."qa_review_id" = ');
    expect(compiled.sql).toContain('"qa_reviews"."completed_at" is null');
    expect(compiled.sql).toContain("returning");
    expect(compiled.params).toContain("qa_a");
  });

  it("selects unsampled completed ai runs as qa sampling candidates", () => {
    const query = qaSamplingCandidatesQuery(
      makeDb(),
      { tenantId: "ten_a" },
      { limit: 100, since: new Date("2026-07-01T00:00:00.000Z") },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('from "ai_runs"');
    expect(compiled.sql).toContain('inner join "tickets"');
    expect(compiled.sql).toContain('left join "qa_reviews"');
    expect(compiled.sql).toContain('"ai_runs"."tenant_id" = ');
    expect(compiled.sql).toContain('"ai_runs"."status" in (');
    expect(compiled.sql).toContain('"qa_reviews"."qa_review_id" is null');
    expect(compiled.sql).toContain('"ai_runs"."created_at" >= ');
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("succeeded");
    expect(compiled.params).toContain("failed");
  });
});

describe("milestone 12 security and pilot readiness queries", () => {
  const window = {
    since: new Date("2026-06-27T00:00:00.000Z"),
    until: new Date("2026-07-04T00:00:00.000Z"),
  };

  it("resolves the active automation policy version for the tenant", () => {
    const query = activeAutomationPolicyVersionQuery(makeDb(), {
      tenantId: "ten_a",
    });
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('from "policy_versions"');
    expect(compiled.sql).toContain('inner join "tenant_policies"');
    expect(compiled.sql).toContain('"policy_versions"."tenant_id" = ');
    expect(compiled.sql).toContain('"tenant_policies"."tenant_id" = ');
    expect(compiled.sql).toContain('"tenant_policies"."domain" = ');
    expect(compiled.sql).toContain('"tenant_policies"."status" = ');
    expect(compiled.sql).toContain(
      '"policy_versions"."activated_at" is not null',
    );
    expect(compiled.sql).toContain('order by "policy_versions"."version" desc');
    expect(compiled.params).toContain("automation");
    expect(compiled.params).toContain("active");
    expect(compiled.params).toContain("ten_a");
  });

  it("selects expired raw payload refs in bounded batches", () => {
    const query = expiredRawPayloadMessagesQuery(
      makeDb(),
      { tenantId: "ten_a" },
      { cutoff: new Date("2026-04-01T00:00:00.000Z"), limit: 100 },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"messages"."raw_payload_ref" is not null');
    expect(compiled.sql).toContain('"messages"."created_at" < ');
    expect(compiled.sql).toContain("limit");
    expect(compiled.params).toContain("ten_a");
  });

  it("clears raw payload refs only for the given tenant-scoped messages", () => {
    const query = clearMessageRawPayloadRefsQuery(
      makeDb(),
      { tenantId: "ten_a" },
      ["msg_a", "msg_b"],
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('update "messages"');
    expect(compiled.sql).toContain('"raw_payload_ref" = ');
    expect(compiled.sql).toContain('"messages"."message_id" in (');
    expect(compiled.sql).toContain('"messages"."raw_payload_ref" is not null');
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("msg_a");
    expect(compiled.params).toContain("msg_b");
  });

  it("selects expired attachment messages in bounded batches", () => {
    const query = expiredAttachmentMessagesQuery(
      makeDb(),
      { tenantId: "ten_a" },
      { cutoff: new Date("2026-04-01T00:00:00.000Z"), limit: 100 },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain("jsonb_array_length");
    expect(compiled.sql).toContain('"messages"."created_at" < ');
    expect(compiled.sql).toContain("limit");
    expect(compiled.params).toContain("ten_a");
  });

  it("clears attachment metadata only for the given tenant-scoped messages", () => {
    const query = clearMessageAttachmentsQuery(
      makeDb(),
      { tenantId: "ten_a" },
      ["msg_a", "msg_b"],
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('update "messages"');
    expect(compiled.sql).toContain('"attachments" = ');
    expect(compiled.sql).toContain('"messages"."message_id" in (');
    expect(compiled.sql).toContain("jsonb_array_length");
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("msg_a");
    expect(compiled.params).toContain("msg_b");
  });

  it("selects only non-anonymized expired ai runs in bounded batches", () => {
    const query = expiredAiRunsForAnonymizationQuery(
      makeDb(),
      { tenantId: "ten_a" },
      { cutoff: new Date("2026-04-01T00:00:00.000Z"), limit: 100 },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('from "ai_runs"');
    expect(compiled.sql).toContain('"ai_runs"."anonymized_at" is null');
    expect(compiled.sql).toContain('"ai_runs"."created_at" < ');
    expect(compiled.sql).toContain("limit");
    expect(compiled.params).toContain("ten_a");
  });

  it("anonymizes ai runs by clearing content columns and stamping anonymized_at", () => {
    const query = anonymizeAiRunsQuery(
      makeDb(),
      { tenantId: "ten_a" },
      ["run_a", "run_b"],
      new Date("2026-04-01T00:00:00.000Z"),
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('update "ai_runs"');
    expect(compiled.sql).toContain('"structured_output" = ');
    expect(compiled.sql).toContain('"guardrail_results" = ');
    expect(compiled.sql).toContain('"anonymized_at" = ');
    expect(compiled.sql).toContain('"ai_runs"."ai_run_id" in (');
    expect(compiled.sql).toContain('"ai_runs"."anonymized_at" is null');
    expect(compiled.params).toContain("ten_a");
    expect(compiled.params).toContain("run_a");
    expect(compiled.params).toContain("run_b");
  });

  it("builds the weekly report ticket aggregates", () => {
    const created = ticketsCreatedCountQuery(
      makeDb(),
      { tenantId: "ten_a" },
      window,
    ).toSQL();
    const resolved = ticketsResolvedStatsQuery(
      makeDb(),
      { tenantId: "ten_a" },
      window,
    ).toSQL();
    const firstResponse = firstResponseMinutesAvgQuery(
      makeDb(),
      { tenantId: "ten_a" },
      window,
    ).toSQL();
    const topTopics = ticketTopTopicsQuery(
      makeDb(),
      { tenantId: "ten_a" },
      window,
    ).toSQL();

    expect(created.sql).toContain('"tickets"."created_at" >= ');
    expect(created.sql).toContain('"tickets"."created_at" < ');
    expect(resolved.sql).toContain('"tickets"."resolved_at" is not null');
    expect(resolved.sql).toContain("avg(extract(epoch from");
    expect(firstResponse.sql).toContain('"messages"."direction" = ');
    expect(firstResponse.sql).toContain("min(");
    expect(firstResponse.sql).toContain("group by");
    expect(topTopics.sql).toContain('"tickets"."topic" is not null');
    expect(topTopics.sql).toContain("group by");
    expect(topTopics.sql).toContain("order by count(*) desc");
  });

  it("builds the weekly report ai, approval, outbound, and qa aggregates", () => {
    const aiCounts = aiRunStatusCountsQuery(
      makeDb(),
      { tenantId: "ten_a" },
      window,
    ).toSQL();
    const drafted = aiDraftedTicketsCountQuery(
      makeDb(),
      { tenantId: "ten_a" },
      window,
    ).toSQL();
    const requested = approvalsRequestedCountQuery(
      makeDb(),
      { tenantId: "ten_a" },
      window,
    ).toSQL();
    const resolutions = approvalResolutionCountsQuery(
      makeDb(),
      { tenantId: "ten_a" },
      window,
    ).toSQL();
    const outbound = outboundMessageCountsQuery(
      makeDb(),
      { tenantId: "ten_a" },
      window,
    ).toSQL();
    const qaCreated = qaReviewsCreatedCountQuery(
      makeDb(),
      { tenantId: "ten_a" },
      window,
    ).toSQL();
    const qaCompleted = qaReviewsCompletedStatsQuery(
      makeDb(),
      { tenantId: "ten_a" },
      window,
    ).toSQL();
    const slaBreaches = auditActionCountQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "ticket.sla_breached",
      window,
    ).toSQL();

    expect(aiCounts.sql).toContain('group by "ai_runs"."status"');
    expect(drafted.sql).toContain("count(distinct");
    expect(requested.sql).toContain('from "approvals"');
    expect(resolutions.sql).toContain('"approvals"."resolved_at" is not null');
    expect(outbound.sql).toContain('"messages"."direction" = ');
    expect(outbound.sql).toContain("group by");
    expect(qaCreated.sql).toContain('from "qa_reviews"');
    expect(qaCompleted.sql).toContain("filter (where jsonb_array_length");
    expect(slaBreaches.sql).toContain('"audit_events"."action" = ');
    expect(slaBreaches.params).toContain("ticket.sla_breached");
  });
});
