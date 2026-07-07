import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "@support/api";
import {
  aiRunsListQuery,
  approvalsListQuery,
  auditEventsListQuery,
  channels,
  conversationsListQuery,
  createDatabaseFromEnv,
  migrateDatabase,
  slaPolicies,
  tenants,
  ticketByIdQuery,
  toolCallsListQuery,
  toolDefinitions,
  users,
  type PostgresClient,
  type SupportDatabase,
} from "@support/db";
import { createHttpOutboundChannelSender } from "@support/integrations";
import { createRecordingSupportMetrics } from "@support/observability";
import { AI_SIDECAR_ERROR_CODES } from "./activities/http-ai-graph.js";
import {
  connectNatsEventBus,
  loadNatsEventBusConfig,
  type NatsEventBusRuntime,
} from "./event-bus.js";
import {
  loadTicketLifecycleWorkerRuntimeConfig,
  startTicketLifecycleWorkerRuntime,
  type RunningTicketLifecycleWorkerRuntime,
} from "./worker-runtime.js";

/**
 * Milestone 14 live end-to-end drive of the AI runtime service bridge
 * (Compose services: PostgreSQL, Temporal, NATS — plus the Python sidecar
 * spawned by this test via uv): a signed webhook flows through the real API
 * intake into the production worker composition with `AI_RUNTIME_SERVICE_URL`
 * configured, so the AI decision is made inside the Python FastAPI sidecar,
 * retrieval runs over `POST /v1/kb/search`, and tool execution runs over
 * `POST /internal/tools/execute` against the governed registry. Sidecar-down
 * and sidecar-500 paths must degrade to audited failed AI runs routed to
 * human approval — never failed workflows.
 *
 * Run: pnpm --filter @support/workers test:e2e:service
 * (requires `pnpm infra:up`, DATABASE_URL, uv with the ai/ service extra
 * available, and on IPv6-localhost hosts NATS_URL=nats://127.0.0.1:4222)
 *
 * Real-model mode (Milestone 15 acceptance): setting E2E_AI_REAL_PROVIDER
 * (+ E2E_AI_REAL_MODEL and the provider key, e.g. ANTHROPIC_API_KEY) spawns
 * the sidecar with the configured real provider — the happy path then proves
 * a real, citation-grounded model draft lands in the approval with real
 * token/cost provenance on `ai_runs`. Unset keeps the deterministic drive;
 * the degradation tests never reach a model either way. Costs real tokens:
 *
 *   E2E_AI_REAL_PROVIDER=anthropic E2E_AI_REAL_MODEL=claude-sonnet-5 \
 *     ANTHROPIC_API_KEY=... RUN_AI_SERVICE_E2E_TESTS=true DATABASE_URL=... \
 *     pnpm --filter @support/workers test:e2e:service
 */
const describeLive =
  process.env.RUN_AI_SERVICE_E2E_TESTS === "true" && process.env.DATABASE_URL
    ? describe
    : describe.skip;

const REAL_PROVIDER = process.env.E2E_AI_REAL_PROVIDER?.trim() || null;
const REAL_MODEL = process.env.E2E_AI_REAL_MODEL?.trim() || null;

if (REAL_PROVIDER && !REAL_MODEL) {
  throw new Error(
    "E2E_AI_REAL_MODEL is required when E2E_AI_REAL_PROVIDER is set.",
  );
}

const prefix = `e2e_svc_${process.pid}_${Date.now()}`;
const TENANT = `${prefix}_ten`;
const SCOPE = { tenantId: TENANT };
const CHANNEL = `${prefix}_chn`;
const SLA_POLICY = `${prefix}_sla`;
const REVIEWER = `${prefix}_usr`;
const SIGNING_SECRET = "e2e-svc-webhook-signing-secret";
const SEND_CREDENTIAL = "e2e-svc-mailgun-api-key";
const SENDING_DOMAIN = "mg.e2e-svc.example.test";
const AI_SERVICE_TOKEN = `${prefix}-ai-service-token`;
const INTERNAL_API_TOKEN = `${prefix}-internal-api-token`;
const SIDECAR_PORT = 18_100 + (process.pid % 400);
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const FIRST_PARTY_TOOL_NAMES = [
  { name: "order_lookup", permission: "order_read" },
  { name: "shipment_tracking_lookup", permission: "order_read" },
  { name: "refund_eligibility", permission: "eligibility_evaluate" },
  { name: "cancellation_eligibility", permission: "eligibility_evaluate" },
  { name: "customer_profile_lookup", permission: "customer_read" },
  { name: "kb_search", permission: "kb_read" },
] as const;

function mailgunPayload(
  messageId: string,
  threadId: string,
  text: string,
): string {
  const timestamp = "1783180800";
  const token = `token-${messageId}`;
  const signature = createHmac("sha256", SIGNING_SECRET)
    .update(`${timestamp}${token}`)
    .digest("hex");

  return JSON.stringify({
    message_id: messageId,
    thread_id: threadId,
    from: { email: `${prefix}.buyer@example.test`, name: "E2E Buyer" },
    subject: "Where is my order?",
    text,
    received_at: "2026-07-04T12:00:00.000Z",
    signature: { timestamp, token, signature },
  });
}

async function pollUntil<T>(
  read: () => Promise<T | null | undefined>,
  label: string,
  timeoutMs = 60_000,
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();

    if (value !== null && value !== undefined) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

function reviewerHeaders(): Record<string, string> {
  return {
    authorization: "Bearer e2e-placeholder-token",
    "x-tenant-id": TENANT,
    "x-user-id": REVIEWER,
    "x-user-roles": "support_agent",
  };
}

describeLive("live AI runtime service bridge end to end", () => {
  let ownerClient: PostgresClient | undefined;
  let ownerDb: SupportDatabase;
  let runtime: RunningTicketLifecycleWorkerRuntime | undefined;
  let app: ReturnType<typeof buildApp> | undefined;
  let apiBaseUrl = "";
  let eventBus: NatsEventBusRuntime | undefined;
  let sidecar: ChildProcess | undefined;
  let brokenSidecar: Server | undefined;
  const seededToolDefinitionIds: string[] = [];
  const providerCalls: string[] = [];

  const stubFetch: typeof fetch = async (input, init) => {
    providerCalls.push(String(input));
    void init;

    return new Response(
      JSON.stringify({ id: `<mailgun-${prefix}@${SENDING_DOMAIN}>` }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  async function startWorker(
    envOverrides: Record<string, string>,
  ): Promise<RunningTicketLifecycleWorkerRuntime> {
    const started = await startTicketLifecycleWorkerRuntime(
      loadTicketLifecycleWorkerRuntimeConfig({
        ...process.env,
        ...envOverrides,
      }),
      {
        outboundSender: createHttpOutboundChannelSender({
          fetchImpl: stubFetch,
        }),
        metrics: createRecordingSupportMetrics(),
      },
    );
    void started.run();
    return started;
  }

  function sidecarEnv(): Record<string, string> {
    return {
      AI_RUNTIME_SERVICE_URL: `http://127.0.0.1:${SIDECAR_PORT}`,
      SUPPORT_AI_SERVICE_TOKEN: AI_SERVICE_TOKEN,
      // Keep in-activity transport retries quick for the failure tests.
      AI_RUNTIME_SERVICE_TIMEOUT_MS: "15000",
    };
  }

  beforeAll(async () => {
    process.env[`E2E_SVC_SIGNING_SECRET_${process.pid}`] = SIGNING_SECRET;
    process.env[`E2E_SVC_SEND_CREDENTIAL_${process.pid}`] = SEND_CREDENTIAL;
    process.env.NATS_URL ??= "nats://127.0.0.1:4222";

    const database = createDatabaseFromEnv();
    ownerClient = database.client;
    ownerDb = database.db;
    await migrateDatabase(ownerClient);

    await ownerDb.insert(tenants).values({
      tenantId: TENANT,
      name: `${prefix} Outfitters`,
    });
    await ownerDb.insert(users).values({
      userId: REVIEWER,
      tenantId: TENANT,
      email: `${prefix}.reviewer@example.test`,
      displayName: "E2E Reviewer",
    });
    await ownerDb.insert(channels).values({
      channelId: CHANNEL,
      tenantId: TENANT,
      type: "email",
      provider: "mailgun",
      status: "active",
      config: {
        sending_domain: SENDING_DOMAIN,
        from_address: "support@e2e-svc.example.test",
        from_name: "E2E Support",
        signature_secret_ref: `E2E_SVC_SIGNING_SECRET_${process.pid}`,
        send_credential_ref: `E2E_SVC_SEND_CREDENTIAL_${process.pid}`,
      },
    });
    await ownerDb.insert(slaPolicies).values({
      slaPolicyId: SLA_POLICY,
      tenantId: TENANT,
      name: `${prefix} SLA`,
      priority: "p2",
      firstResponseMinutes: 60,
      nextResponseMinutes: 240,
      resolutionMinutes: 1440,
      status: "active",
    });

    // Global first-party tool definitions so the sidecar's tool calls resolve
    // in the governed registry. Only rows this test actually inserted are
    // cleaned up (a pilot-seeded database already has them).
    const insertedTools = await ownerDb
      .insert(toolDefinitions)
      .values(
        FIRST_PARTY_TOOL_NAMES.map((tool) => ({
          toolDefinitionId: `tool_global_${tool.name}`,
          tenantId: null,
          name: tool.name,
          description: `${tool.name} first-party tool`,
          inputSchema: {},
          outputSchema: {},
          permission: tool.permission,
          sideEffectClass: "read_only" as const,
          requiresHumanApproval: false,
          timeoutMs: 2000,
          retryPolicy: {},
          redactionPolicy: {},
          status: "active" as const,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: toolDefinitions.toolDefinitionId });
    seededToolDefinitionIds.push(...insertedTools.map((row) => row.id));

    eventBus = await connectNatsEventBus(loadNatsEventBusConfig(process.env));
    await eventBus.ensureStreams();

    // Real HTTP listener: the sidecar calls back into this API for tool
    // execution and KB retrieval.
    app = buildApp({ internalAuth: { token: INTERNAL_API_TOKEN } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();

    if (address === null || typeof address !== "object") {
      throw new Error("API listener did not report a port.");
    }

    apiBaseUrl = `http://127.0.0.1:${address.port}`;

    // KB content whose wording overlaps the customer ask, so the sidecar's
    // network retrieval demonstrably returns evidence.
    const createDocument = await app.inject({
      method: "POST",
      url: "/v1/kb/documents",
      headers: { ...reviewerHeaders(), "content-type": "application/json" },
      payload: {
        title: "Where is my order - shipping and tracking FAQ",
        source_type: "manual",
        document_type: "faq",
        content:
          "Where is my order? You can check your order status and tracking number any time. " +
          "We share the tracking number as soon as the order ships and send delivery updates.",
      },
    });
    expect(createDocument.statusCode).toBe(201);
    const kbDocumentId = createDocument.json().kb_document.kb_document_id;

    const ingestDocument = await app.inject({
      method: "POST",
      url: `/v1/kb/documents/${kbDocumentId}/ingest`,
      headers: { ...reviewerHeaders(), "content-type": "application/json" },
    });
    expect(ingestDocument.statusCode).toBe(200);
    expect(ingestDocument.json().embedded_count).toBeGreaterThan(0);

    // Spawn the Python sidecar in service mode pointed back at this API.
    const uvHome = path.join(homedir(), ".local/bin/uv");
    const uvBin = existsSync(uvHome) ? uvHome : "uv";
    sidecar = spawn(
      uvBin,
      [
        "run",
        "--frozen",
        "--project",
        "ai",
        "--extra",
        "service",
        // The llm extra ships the LangChain provider stack for real-model mode.
        ...(REAL_PROVIDER ? ["--extra", "llm"] : []),
        "python",
        "-m",
        "uvicorn",
        "--factory",
        "service.app:create_app",
        "--host",
        "127.0.0.1",
        "--port",
        String(SIDECAR_PORT),
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PYTHONPATH: "ai",
          SUPPORT_AI_SERVICE_MODE: "service",
          SUPPORT_AI_SERVICE_TOKEN: AI_SERVICE_TOKEN,
          SUPPORT_API_BASE_URL: apiBaseUrl,
          SUPPORT_INTERNAL_API_TOKEN: INTERNAL_API_TOKEN,
          // Real-model mode (Milestone 15): the provider key (e.g.
          // ANTHROPIC_API_KEY) is inherited from process.env above.
          ...(REAL_PROVIDER
            ? {
                SUPPORT_LLM_PROVIDER: REAL_PROVIDER,
                SUPPORT_LLM_MODEL: REAL_MODEL!,
              }
            : {}),
        },
        stdio: ["ignore", "inherit", "inherit"],
      },
    );

    await pollUntil(
      async () => {
        try {
          const response = await fetch(
            `http://127.0.0.1:${SIDECAR_PORT}/health`,
          );
          return response.ok ? true : null;
        } catch {
          return null;
        }
      },
      "sidecar /health",
      90_000,
    );

    runtime = await startWorker(sidecarEnv());
  }, 180_000);

  afterAll(async () => {
    try {
      await app?.close();
      await runtime?.shutdown();
      await eventBus?.close();
      sidecar?.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        brokenSidecar?.close(() => resolve());
        if (!brokenSidecar) resolve();
      });

      if (ownerClient) {
        for (const table of [
          "qa_reviews",
          "messages",
          "approvals",
          "tool_calls",
          "ai_runs",
          "audit_events",
          "ticket_events",
          "tickets",
          "conversations",
          "customer_identities",
          "customers",
          "kb_chunks",
          "kb_documents",
          "sla_policies",
          "channels",
          "user_roles",
          "users",
          "tenants",
        ]) {
          await ownerClient.unsafe(
            `delete from ${table} where tenant_id = $1`,
            [TENANT],
          );
        }

        for (const toolDefinitionId of seededToolDefinitionIds) {
          await ownerClient.unsafe(
            "delete from tool_calls where tool_definition_id = $1",
            [toolDefinitionId],
          );
          await ownerClient.unsafe(
            "delete from tool_definitions where tool_definition_id = $1",
            [toolDefinitionId],
          );
        }
      }
    } finally {
      await ownerClient?.end();
    }
  }, 120_000);

  async function driveConversation(
    idSuffix: string,
    text: string,
  ): Promise<{ conversationId: string; ticketId: string }> {
    const before = (
      await conversationsListQuery(ownerDb, SCOPE, { limit: 50 })
    ).map((row) => row.conversationId);

    const response = await app!.inject({
      method: "POST",
      url: `/v1/webhooks/email/mailgun?channel_id=${CHANNEL}`,
      headers: { "content-type": "application/json" },
      payload: mailgunPayload(
        `<${idSuffix}-${prefix}@mail.example>`,
        `<thread-${idSuffix}-${prefix}@mail.example>`,
        text,
      ),
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().accepted).toBe(1);

    const conversation = await pollUntil(
      async () =>
        (await conversationsListQuery(ownerDb, SCOPE, { limit: 50 })).find(
          (row) => !before.includes(row.conversationId),
        ),
      `conversation for ${idSuffix}`,
    );

    return {
      conversationId: conversation.conversationId,
      ticketId: `tkt_${conversation.conversationId}`,
    };
  }

  it("runs the full lifecycle with the AI decision made in the Python sidecar, retrieval and tools over the network", async () => {
    const { ticketId } = await driveConversation(
      "happy",
      "Where is my order 1001? Please share the tracking number for my order.",
    );

    const ticketRow = await pollUntil(async () => {
      const rows = await ticketByIdQuery(ownerDb, SCOPE, ticketId);
      return rows[0]?.status === "waiting_human" ? rows[0] : null;
    }, "ticket in waiting_human");
    expect(ticketRow.automationMode).toBe("human_approve");

    // The persisted AI run came from the sidecar: Python runtime provenance,
    // runtime-generated ids, and the trace link. In real-model mode the row
    // must carry the runtime-reported provider/model instead of the
    // deterministic constants (Milestone 15).
    const aiRun = (
      await aiRunsListQuery(ownerDb, SCOPE, { limit: 10, ticketId })
    )[0]!;
    expect(aiRun).toMatchObject({
      status: "succeeded",
      modelProvider: REAL_PROVIDER ?? "deterministic",
      modelId: REAL_PROVIDER ? REAL_MODEL : "deterministic-support-v1",
      automationRecommendation: "human_approve",
    });
    expect(aiRun.traceId).toMatch(/^trace_/);
    expect(aiRun.aiRunId).toMatch(/^air_/);

    const structuredOutput = aiRun.structuredOutput as Record<string, unknown>;
    const draft = structuredOutput.draft as Record<string, unknown>;
    expect(String(draft.draft_text).length).toBeGreaterThan(0);

    if (REAL_PROVIDER) {
      // Milestone 15 acceptance evidence: versioned prompt provenance plus
      // real token and cost capture on the persisted run.
      expect(aiRun.promptVersion).toContain("support_classifier.v1");
      expect(aiRun.promptVersion).toContain("support_response_composer.v1");
      expect(aiRun.inputTokens ?? 0).toBeGreaterThan(0);
      expect(aiRun.outputTokens ?? 0).toBeGreaterThan(0);
      expect(Number(aiRun.costEstimate ?? 0)).toBeGreaterThan(0);
      // Surface the real draft in the test output for the acceptance record.
      console.info(
        `[real-model draft] provider=${aiRun.modelProvider} model=${aiRun.modelId} ` +
          `tokens=${aiRun.inputTokens}/${aiRun.outputTokens} cost=$${aiRun.costEstimate}\n` +
          `${String(draft.draft_text)}\n` +
          `[cited evidence] ${JSON.stringify(draft.evidence ?? [])}`,
      );
    }

    // Retrieval ran over POST /v1/kb/search: the seeded FAQ document surfaced
    // as evidence inside the sidecar's graph state.
    const evalSignals = structuredOutput.eval_signals as Record<
      string,
      unknown
    >;
    expect(Number(evalSignals.evidence_count)).toBeGreaterThan(0);

    // Tool execution ran over POST /internal/tools/execute: the governed
    // registry audited a tool_calls row for this ticket.
    const toolCallRows = await toolCallsListQuery(ownerDb, SCOPE, {
      limit: 10,
      ticketId,
    });
    expect(toolCallRows.length).toBeGreaterThan(0);
    expect(toolCallRows.map((row) => row.aiRunId)).toContain(aiRun.aiRunId);

    // Human approval loop still closes: approve via API, workflow sends once.
    const approval = (
      await approvalsListQuery(ownerDb, SCOPE, { limit: 10, ticketId })
    ).find((row) => row.status === "pending")!;
    expect(approval).toBeDefined();
    expect(approval.aiRunId).toBe(aiRun.aiRunId);

    const decideResponse = await app!.inject({
      method: "POST",
      url: `/v1/approvals/${approval.approvalId}/approve`,
      headers: { ...reviewerHeaders(), "content-type": "application/json" },
      payload: { review_notes: "Sidecar draft approved." },
    });
    expect(decideResponse.statusCode).toBe(200);

    await pollUntil(async () => {
      const rows = await ticketByIdQuery(ownerDb, SCOPE, ticketId);
      return rows[0]?.status === "waiting_customer" ? rows[0] : null;
    }, "ticket in waiting_customer");

    expect(providerCalls).toHaveLength(1);
  }, 180_000);

  it("degrades to an audited failed AI run routed to human when the sidecar is down", async () => {
    await runtime!.shutdown();
    // Point the worker at a port nothing listens on.
    runtime = await startWorker({
      ...sidecarEnv(),
      AI_RUNTIME_SERVICE_URL: `http://127.0.0.1:${SIDECAR_PORT + 1}`,
    });

    const { ticketId } = await driveConversation(
      "sidecar-down",
      "I want to cancel my order before it ships.",
    );

    const ticketRow = await pollUntil(async () => {
      const rows = await ticketByIdQuery(ownerDb, SCOPE, ticketId);
      return rows[0]?.status === "waiting_human" ? rows[0] : null;
    }, "sidecar-down ticket in waiting_human");
    expect(ticketRow.status).toBe("waiting_human");

    const aiRun = (
      await aiRunsListQuery(ownerDb, SCOPE, { limit: 10, ticketId })
    )[0]!;
    expect(aiRun.status).toBe("failed");
    const structuredOutput = aiRun.structuredOutput as Record<string, unknown>;
    expect(structuredOutput.error_code).toBe(
      AI_SIDECAR_ERROR_CODES.unavailable,
    );
    expect(structuredOutput.retryable).toBe(true);

    // The failure is audited and a human approval still gates the reply.
    const auditActions = (
      await auditEventsListQuery(ownerDb, SCOPE, { limit: 200 })
    ).map((event) => event.action);
    expect(auditActions).toContain("ai_graph.failed");

    const approval = (
      await approvalsListQuery(ownerDb, SCOPE, { limit: 20, ticketId })
    ).find((row) => row.status === "pending");
    expect(approval).toBeDefined();
  }, 180_000);

  it("degrades the same way when the sidecar answers 500", async () => {
    const brokenPort = SIDECAR_PORT + 2;
    brokenSidecar = createServer((request, response) => {
      void request;
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "sidecar exploded" }));
    });
    await new Promise<void>((resolve) =>
      brokenSidecar!.listen(brokenPort, "127.0.0.1", resolve),
    );

    await runtime!.shutdown();
    runtime = await startWorker({
      ...sidecarEnv(),
      AI_RUNTIME_SERVICE_URL: `http://127.0.0.1:${brokenPort}`,
    });

    const { ticketId } = await driveConversation(
      "sidecar-500",
      "My package never arrived and I need help finding it.",
    );

    await pollUntil(async () => {
      const rows = await ticketByIdQuery(ownerDb, SCOPE, ticketId);
      return rows[0]?.status === "waiting_human" ? rows[0] : null;
    }, "sidecar-500 ticket in waiting_human");

    const aiRun = (
      await aiRunsListQuery(ownerDb, SCOPE, { limit: 10, ticketId })
    )[0]!;
    expect(aiRun.status).toBe("failed");
    const structuredOutput = aiRun.structuredOutput as Record<string, unknown>;
    expect(structuredOutput.error_code).toBe(
      AI_SIDECAR_ERROR_CODES.serverError,
    );

    const approval = (
      await approvalsListQuery(ownerDb, SCOPE, { limit: 20, ticketId })
    ).find((row) => row.status === "pending");
    expect(approval).toBeDefined();
  }, 180_000);
});
