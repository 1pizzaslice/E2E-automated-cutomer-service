import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aiRunByIdQuery,
  approvalByIdQuery,
  channels,
  conversations,
  createDatabaseFromEnv,
  customerIdentities,
  customers,
  messageByIdempotencyKeyQuery,
  migrateDatabase,
  qaReviewByIdQuery,
  qaReviewsListQuery,
  tenants,
  tickets,
  type PostgresClient,
  type SupportDatabase,
} from "@support/db";
import { createRecordingOutboundChannelSender } from "@support/integrations";
import {
  createDatabaseTicketLifecyclePersistenceStore,
  createPersistedRunAiGraph,
  createTicketLifecyclePersistenceActivities,
  deterministicApprovalId,
  type TicketLifecyclePersistenceStore,
} from "./ticket-lifecycle-persistence.js";
import {
  createDatabaseQaSamplingStore,
  deterministicQaReviewId,
  runQaSamplingJob,
  type QaSamplingStore,
} from "../qa-sampling.js";
import type {
  RunAiGraphActivityInput,
  RunAiGraphActivityResult,
} from "../workflows/ticket-lifecycle-types.js";

const describeLive =
  process.env.RUN_WORKER_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

const prefix = `wrk_it_${process.pid}_${Date.now()}`;
const ids = {
  tenant: `${prefix}_ten`,
  customer: `${prefix}_cus`,
  channel: `${prefix}_chn`,
  conversation: `${prefix}_cnv`,
  ticket: `${prefix}_tic`,
  aiRun: `${prefix}_air`,
  correlation: `${prefix}_corr`,
};
const scope = { tenantId: ids.tenant };
const approvalId = deterministicApprovalId(
  ids.tenant,
  ids.ticket,
  ids.correlation,
);
const idempotencyKey = `outbound:${ids.tenant}:${ids.ticket}:${approvalId}`;

const runInput: RunAiGraphActivityInput = {
  tenant_id: ids.tenant,
  ticket_id: ids.ticket,
  initial_message_id: `${prefix}_msg_in`,
  correlation_id: ids.correlation,
  ticket: {
    ticket_id: ids.ticket,
    conversation_id: ids.conversation,
    customer_id: ids.customer,
    status: "waiting_ai",
    priority: "p2",
    automation_mode: "human_approve",
    assigned_queue: null,
    assigned_user_id: null,
    sla_policy_id: null,
    opened_at: "2026-07-04T11:00:00.000Z",
    first_response_due_at: null,
    next_response_due_at: null,
    resolution_due_at: null,
  },
  triage: {
    status: "triaged",
    route: "human_approval",
    reason_code: "v1_default_human_approval",
    metadata: {},
  },
};

const succeededRun: RunAiGraphActivityResult = {
  status: "succeeded",
  ai_run_id: ids.aiRun,
  trace_id: `${prefix}_trace`,
  classification: { topic: "shipping_delivery" },
  routing_decision: {
    topic: "shipping_delivery",
    subtopic: null,
    language: "en",
    sentiment: "neutral",
    urgency: "medium",
    priority: "p2",
    risk_level: "low",
    confidence: 0.91,
    // auto_send makes the persisted run a mandatory QA sampling candidate.
    automation_mode: "auto_send",
    assigned_queue: null,
    reason_codes: ["low_risk_allowlisted"],
    required_tools: [],
    required_evidence: [],
  },
  tool_calls: [],
  draft: {
    draft_text: "Your order shipped yesterday.",
    customer_language: "en",
    tone: "empathetic",
    evidence: [
      { type: "kb_chunk", ref_id: "kb_chunk_1", summary: "Shipping policy" },
    ],
    actions: [],
    risk_level: "low",
    confidence: 0.91,
    needs_human: false,
    human_review_reasons: [],
  },
  guardrails: { passed: true },
  final_recommendation: {
    automation_mode: "auto_send",
    risk_level: "low",
    confidence: 0.91,
    reason_codes: ["low_risk_allowlisted"],
  },
  eval_signals: {},
};

describeLive("live ticket lifecycle persistence store", () => {
  let ownerClient: PostgresClient | undefined;
  let ownerDb: SupportDatabase;
  let store: TicketLifecyclePersistenceStore;
  let samplingStore: QaSamplingStore;

  beforeAll(async () => {
    const database = createDatabaseFromEnv();
    ownerClient = database.client;
    ownerDb = database.db;
    await migrateDatabase(ownerClient);

    await ownerDb
      .insert(tenants)
      .values({ tenantId: ids.tenant, name: `${prefix} Tenant` });
    await ownerDb.insert(customers).values({
      customerId: ids.customer,
      tenantId: ids.tenant,
      displayName: "Workers IT Customer",
      email: `${prefix}@example.test`,
    });
    await ownerDb.insert(channels).values({
      channelId: ids.channel,
      tenantId: ids.tenant,
      type: "email",
      provider: "mailgun",
      status: "active",
      config: {
        sending_domain: "mg.tenant.example.com",
        from_address: "support@tenant.example.com",
      },
    });
    await ownerDb.insert(customerIdentities).values({
      customerIdentityId: `${prefix}_ident`,
      tenantId: ids.tenant,
      customerId: ids.customer,
      channel: "email",
      identityType: "email",
      identityValue: `${prefix}.customer@example.test`,
    });
    await ownerDb.insert(conversations).values({
      conversationId: ids.conversation,
      tenantId: ids.tenant,
      customerId: ids.customer,
      channelId: ids.channel,
      externalThreadId: `<${prefix}@example.test>`,
      status: "open",
    });
    await ownerDb.insert(tickets).values({
      ticketId: ids.ticket,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      customerId: ids.customer,
      status: "waiting_ai",
      priority: "p2",
      openedAt: new Date("2026-07-04T11:00:00.000Z"),
    });

    store = createDatabaseTicketLifecyclePersistenceStore();
    samplingStore = createDatabaseQaSamplingStore();
  });

  afterAll(async () => {
    await store?.close?.();
    await samplingStore?.close?.();

    if (!ownerClient) {
      return;
    }

    try {
      const client = ownerClient;
      for (const table of [
        "qa_reviews",
        "messages",
        "approvals",
        "ai_runs",
        "audit_events",
        "tickets",
        "conversations",
        "customer_identities",
        "channels",
        "customers",
        "tenants",
      ]) {
        await client.unsafe(`delete from ${table} where tenant_id = $1`, [
          ids.tenant,
        ]);
      }
    } finally {
      await ownerClient.end();
    }
  });

  it("persists the AI run with its trace link and dedupes retries", async () => {
    const runAiGraph = createPersistedRunAiGraph(async () => succeededRun, {
      store,
    });

    await runAiGraph(runInput);
    await runAiGraph(runInput);

    const rows = await aiRunByIdQuery(ownerDb, scope, ids.aiRun);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      aiRunId: ids.aiRun,
      ticketId: ids.ticket,
      conversationId: ids.conversation,
      runType: "full_graph",
      status: "succeeded",
      automationRecommendation: "auto_send",
      riskLevel: "low",
      traceId: `${prefix}_trace`,
    });
    expect(rows[0]?.completedAt).not.toBeNull();
  });

  it("links approvals to the persisted AI run row (Milestone 10 FK unblock)", async () => {
    const activities = createTicketLifecyclePersistenceActivities({
      store,
      outboundSender: createRecordingOutboundChannelSender(),
    });

    await activities.createApproval({
      tenant_id: ids.tenant,
      ticket_id: ids.ticket,
      correlation_id: ids.correlation,
      reason_code: "v1_default_human_approval",
      metadata: {
        source: "ai_graph",
        ai_graph: {
          ai_run_id: ids.aiRun,
          draft: { draft_text: "Your order shipped yesterday." },
        },
      },
    });

    const rows = await approvalByIdQuery(ownerDb, scope, approvalId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.aiRunId).toBe(ids.aiRun);
  });

  it("sends the approved draft once, links the message, and replays idempotently", async () => {
    await ownerClient!.unsafe(
      `update approvals
         set status = 'approved',
             approved_payload = $1,
             resolved_at = now()
       where tenant_id = $2 and approval_id = $3`,
      [
        JSON.stringify({ draft_text: "Your order shipped yesterday." }),
        ids.tenant,
        approvalId,
      ],
    );

    const sender = createRecordingOutboundChannelSender();
    const activities = createTicketLifecyclePersistenceActivities({
      store,
      outboundSender: sender,
    });
    const sendInput = {
      tenant_id: ids.tenant,
      ticket_id: ids.ticket,
      conversation_id: ids.conversation,
      correlation_id: ids.correlation,
      approval_id: approvalId,
      approval_status: "approved" as const,
      idempotency_key: idempotencyKey,
    };

    const first = await activities.sendOutboundMessage(sendInput);
    const replay = await activities.sendOutboundMessage(sendInput);

    expect(first.status).toBe("sent");
    expect(replay.message_id).toBe(first.message_id);
    expect(sender.sends).toHaveLength(1);

    const rows = await messageByIdempotencyKeyQuery(
      ownerDb,
      scope,
      idempotencyKey,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sendStatus: "sent",
      aiRunId: ids.aiRun,
      approvalId,
      idempotencyKey,
    });
  });

  it("samples the auto-send run for QA review exactly once", async () => {
    const first = await runQaSamplingJob(
      { store: samplingStore },
      { tenantId: ids.tenant },
    );
    const second = await runQaSamplingJob(
      { store: samplingStore },
      { tenantId: ids.tenant },
    );

    expect(first.sampled).toBe(1);
    expect(first.byReason).toEqual({ auto_send_candidate: 1 });
    expect(second.sampled).toBe(0);

    const qaReviewId = deterministicQaReviewId(ids.tenant, ids.aiRun);
    const rows = await qaReviewByIdQuery(ownerDb, scope, qaReviewId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticketId: ids.ticket,
      aiRunId: ids.aiRun,
      sampleReason: "auto_send_candidate",
    });

    const openReviews = await qaReviewsListQuery(ownerDb, scope, {
      limit: 10,
      ticketId: ids.ticket,
      completed: false,
    });

    expect(openReviews).toHaveLength(1);
  });
});
