import { createHash } from "node:crypto";
import {
  activeSlaPolicyForTenantQuery,
  aiRunByIdQuery,
  approvalByIdQuery,
  channelByIdQuery,
  conversationByIdQuery,
  completeAiRunByIdQuery,
  createAiRunQuery,
  createApprovalQuery,
  createAuditEventQuery,
  createDatabaseFromEnv,
  createOutboundMessageQuery,
  createTicketEventQuery,
  createTicketIfAbsentQuery,
  customerIdentityForCustomerQuery,
  linkMessageToTicketByIdQuery,
  messageByIdQuery,
  messageByIdempotencyKeyQuery,
  resolvePendingApprovalByIdQuery,
  ticketByIdQuery,
  updateMessageSendResultByIdQuery,
  updateTicketByIdQuery,
  withTenantTransaction,
  type AiRun,
  type Approval,
  type JsonObject,
  type Message,
  type NewTicket,
  type Ticket,
} from "@support/db";
import {
  createEnvSecretResolver,
  type OutboundChannelSender,
} from "@support/integrations";
import {
  createNoopSupportMetrics,
  type SupportMetrics,
} from "@support/observability";
import {
  NormalizedOutboundMessageSchema,
  type DomainEventActorType,
  type NormalizedOutboundMessage,
  type SupportAuditAction,
} from "@support/shared-schemas";
import { classifyInitialTriage, escalatePriority } from "../triage.js";
import type {
  ApplyTicketStateTransitionActivityInput,
  ApplyTicketStateTransitionActivityResult,
  CreateApprovalActivityInput,
  CreateApprovalActivityResult,
  CreateOrUpdateTicketActivityInput,
  CreateOrUpdateTicketActivityResult,
  ExpireApprovalActivityInput,
  ExpireApprovalActivityResult,
  RecordAuditEventActivityInput,
  RecordInboundMessageActivityInput,
  RunAiGraphActivityInput,
  RunAiGraphActivityResult,
  RunInitialTriageActivityInput,
  RunInitialTriageActivityResult,
  SendOutboundMessageActivityInput,
  SendOutboundMessageActivityResult,
  TicketLifecycleSlaTimer,
  TicketLifecycleTicketSnapshot,
} from "../workflows/ticket-lifecycle-types.js";

/**
 * Production implementations for the ticket lifecycle persistence activities:
 * `createOrUpdateTicket`, `runInitialTriage`, `recordInboundMessage`,
 * `applyTicketStateTransition`, `expireApproval`, `createApproval`,
 * `sendOutboundMessage`, and `recordAuditEvent`. They sit behind the same
 * activity contracts the workflow already calls, so wiring them into a worker
 * is composing this factory's result into
 * `createTicketLifecycleActivities({ implementations })`. The one remaining
 * caller-supplied activity is `runAiGraph` (the deterministic in-process
 * stand-in lives in `deterministic-ai-graph.ts` until the Milestone 14
 * sidecar bridge lands).
 */

/**
 * Thrown for permanent activity failures (missing conversation/approval/
 * recipient, contract violations, non-retryable provider rejections). The
 * name matches the `nonRetryableErrorTypes` entry in the ticket lifecycle
 * retry policies, so Temporal fails fast instead of retrying.
 */
export class NonRetryableActivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableActivityError";
  }
}

export interface TicketLifecycleApprovalRecord {
  readonly approvalId: string;
  readonly ticketId: string;
  readonly aiRunId: string | null;
  readonly status: Approval["status"];
  readonly requestedPayload: JsonObject;
  readonly approvedPayload: JsonObject | null;
  readonly reviewerUserId: string | null;
}

export interface CreateApprovalRecordInput {
  readonly tenantId: string;
  readonly approvalId: string;
  readonly ticketId: string;
  readonly aiRunId: string | null;
  readonly approvalType: Approval["approvalType"];
  readonly requestedPayload: JsonObject;
}

export interface OutboundMessageRecord {
  readonly messageId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly sendStatus: string | null;
  readonly providerMessageId: string | null;
  readonly sentAt: Date | null;
}

export interface CreateOutboundMessageRecordInput {
  readonly tenantId: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly ticketId: string;
  readonly channelId: string;
  readonly bodyText: string;
  readonly approvalId: string;
  readonly aiRunId: string | null;
  readonly sentByUserId: string | null;
  readonly idempotencyKey: string;
}

export interface RecordSendResultInput {
  readonly tenantId: string;
  readonly messageId: string;
  readonly sendStatus: "sent" | "failed";
  readonly providerMessageId: string | null;
  readonly sentAt: Date | null;
}

export interface AppendAuditEventInput {
  readonly tenantId: string;
  readonly auditEventId: string;
  readonly actorType: DomainEventActorType;
  readonly actorId: string | null;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: SupportAuditAction;
  readonly metadata: Record<string, unknown>;
  readonly correlationId: string | null;
}

export interface RecordAiRunResultInput {
  readonly tenantId: string;
  readonly aiRunId: string;
  readonly ticketId: string;
  readonly conversationId: string;
  readonly runType: AiRun["runType"];
  readonly promptVersion: string;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly inputRefs: JsonObject;
  readonly retrievedContextRefs: JsonObject;
  readonly structuredOutput: JsonObject | null;
  readonly confidence: number | null;
  readonly riskLevel: string | null;
  readonly automationRecommendation: AiRun["automationRecommendation"];
  readonly guardrailResults: JsonObject;
  readonly status: "succeeded" | "failed";
  readonly latencyMs: number | null;
  /** Token/cost usage reported by the runtime (Milestone 15); null when the
   * implementation does not report usage (e.g. the TS deterministic stand-in). */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costEstimate: number | null;
  readonly traceId: string | null;
  readonly completedAt: Date;
}

export interface RecordAiRunResultOutcome {
  readonly aiRunId: string;
  /** False when the run was already recorded (activity retry replay). */
  readonly created: boolean;
  /**
   * False when the owning ticket row does not exist yet, so the append-only
   * evidence row cannot satisfy its foreign keys and is skipped rather than
   * failing the workflow (mirrors the Milestone 10 `ai_run_id` FK guard).
   */
  readonly persisted: boolean;
}

export interface OutboundSendContext {
  readonly conversation: {
    readonly conversationId: string;
    readonly channelId: string;
    readonly customerId: string;
    readonly externalThreadId: string | null;
  };
  readonly channel: {
    readonly channelId: string;
    readonly type: string;
    readonly provider: string;
    readonly config: JsonObject;
  };
  readonly recipient: {
    readonly identityType: string;
    readonly identityValue: string;
    readonly displayName: string | null;
  } | null;
  readonly approval: TicketLifecycleApprovalRecord | null;
}

export interface TicketLifecycleTicketRecord {
  readonly ticketId: string;
  readonly conversationId: string;
  readonly customerId: string;
  readonly status: Ticket["status"];
  readonly priority: Ticket["priority"];
  readonly automationMode: Ticket["automationMode"];
  readonly assignedQueue: string | null;
  readonly assignedUserId: string | null;
  readonly slaPolicyId: string | null;
  readonly topic: string | null;
  readonly subtopic: string | null;
  readonly language: string | null;
  readonly openedAt: Date;
  readonly firstResponseDueAt: Date | null;
  readonly nextResponseDueAt: Date | null;
  readonly resolutionDueAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly closedAt: Date | null;
}

export interface CreateOrLoadTicketRecordInput {
  readonly tenantId: string;
  readonly ticketId: string;
  readonly conversationId: string;
  readonly initialMessageId: string;
  readonly correlationId: string;
  readonly openedAt: Date;
}

export interface CreateOrLoadTicketRecordOutcome {
  readonly ticket: TicketLifecycleTicketRecord;
  /** False when the deterministic ticket row already existed (retry/reopen). */
  readonly created: boolean;
}

export interface RecordInboundMessageRecordInput {
  readonly tenantId: string;
  readonly ticketId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly correlationId: string;
  readonly receivedAt: string;
}

export interface RecordInboundMessageRecordOutcome {
  /** True when this call linked the intake-persisted row to the ticket. */
  readonly linked: boolean;
  /** Null when the ticket row does not exist yet (link deferred to create). */
  readonly ticketStatus: Ticket["status"] | null;
  readonly transition: {
    readonly fromStatus: Ticket["status"];
    readonly toStatus: Ticket["status"];
  } | null;
}

export interface InboundMessageForTriage {
  readonly messageId: string;
  readonly bodyText: string | null;
}

export interface ApplyInitialTriageRecordInput {
  readonly tenantId: string;
  readonly ticketId: string;
  readonly correlationId: string;
  readonly priority: Ticket["priority"];
  readonly topic: string | null;
  readonly subtopic: string | null;
  readonly language: string | null;
  readonly reasonCode: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface ApplyInitialTriageRecordOutcome {
  readonly ticket: TicketLifecycleTicketRecord;
  readonly fromStatus: Ticket["status"];
}

export interface ApplyTicketStateTransitionRecordInput {
  readonly tenantId: string;
  readonly ticketId: string;
  readonly correlationId: string;
  readonly toStatus: Ticket["status"];
  readonly reasonCode: string | null;
  readonly metadata: Record<string, unknown>;
  readonly actorType: DomainEventActorType;
  readonly actorId: string | null;
  readonly transitionKey: string;
}

export interface ApplyTicketStateTransitionRecordOutcome {
  readonly applied: boolean;
  readonly fromStatus: Ticket["status"];
  readonly toStatus: Ticket["status"];
}

export interface ExpireApprovalRecordInput {
  readonly tenantId: string;
  readonly ticketId: string;
  readonly approvalId: string;
  readonly correlationId: string;
  readonly expiredAt: Date;
}

export interface ExpireApprovalRecordOutcome {
  readonly expired: boolean;
  readonly status: Approval["status"];
}

/**
 * Persistence boundary for the ticket lifecycle activities. The database
 * implementation runs every tenant-scoped statement under
 * `withTenantTransaction`/RLS; the in-memory implementation mirrors the same
 * dedup semantics for offline activity tests.
 */
export interface TicketLifecyclePersistenceStore {
  createOrLoadTicket(
    input: CreateOrLoadTicketRecordInput,
  ): Promise<CreateOrLoadTicketRecordOutcome>;
  recordInboundMessage(
    input: RecordInboundMessageRecordInput,
  ): Promise<RecordInboundMessageRecordOutcome>;
  getInboundMessageForTriage(params: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly messageId: string;
  }): Promise<InboundMessageForTriage | null>;
  applyInitialTriage(
    input: ApplyInitialTriageRecordInput,
  ): Promise<ApplyInitialTriageRecordOutcome>;
  applyTicketStateTransition(
    input: ApplyTicketStateTransitionRecordInput,
  ): Promise<ApplyTicketStateTransitionRecordOutcome>;
  expireApproval(
    input: ExpireApprovalRecordInput,
  ): Promise<ExpireApprovalRecordOutcome>;
  createApproval(
    input: CreateApprovalRecordInput,
  ): Promise<{ approval: TicketLifecycleApprovalRecord; created: boolean }>;
  getOutboundSendContext(params: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly approvalId: string;
  }): Promise<OutboundSendContext | null>;
  findMessageByIdempotencyKey(params: {
    readonly tenantId: string;
    readonly idempotencyKey: string;
  }): Promise<OutboundMessageRecord | null>;
  createOutboundMessage(
    input: CreateOutboundMessageRecordInput,
  ): Promise<OutboundMessageRecord>;
  recordSendResult(
    input: RecordSendResultInput,
  ): Promise<OutboundMessageRecord>;
  appendAuditEvent(input: AppendAuditEventInput): Promise<void>;
  recordAiRunResult(
    input: RecordAiRunResultInput,
  ): Promise<RecordAiRunResultOutcome>;
  close?(): Promise<void>;
}

/**
 * Resolves an outbound provider credential from an opaque reference stored in
 * the channel config (`send_credential_ref`). Mirrors the inbound
 * `WebhookSecretResolver`: secrets stay out of channel rows (BACKEND_SPEC
 * §4.1) and the default reads the reference from the environment through the
 * shared validating secret resolver, so malformed references resolve to null
 * instead of addressing arbitrary process state.
 */
export interface OutboundCredentialResolver {
  resolve(ref: string): Promise<string | null>;
}

export function createEnvOutboundCredentialResolver(
  env: NodeJS.ProcessEnv = process.env,
): OutboundCredentialResolver {
  return createEnvSecretResolver(env);
}

export interface TicketLifecyclePersistenceActivities {
  createOrUpdateTicket(
    input: CreateOrUpdateTicketActivityInput,
  ): Promise<CreateOrUpdateTicketActivityResult>;
  runInitialTriage(
    input: RunInitialTriageActivityInput,
  ): Promise<RunInitialTriageActivityResult>;
  recordInboundMessage(input: RecordInboundMessageActivityInput): Promise<void>;
  applyTicketStateTransition(
    input: ApplyTicketStateTransitionActivityInput,
  ): Promise<ApplyTicketStateTransitionActivityResult>;
  expireApproval(
    input: ExpireApprovalActivityInput,
  ): Promise<ExpireApprovalActivityResult>;
  createApproval(
    input: CreateApprovalActivityInput,
  ): Promise<CreateApprovalActivityResult>;
  sendOutboundMessage(
    input: SendOutboundMessageActivityInput,
  ): Promise<SendOutboundMessageActivityResult>;
  recordAuditEvent(input: RecordAuditEventActivityInput): Promise<void>;
}

export interface TicketLifecyclePersistenceActivityDependencies {
  readonly store: TicketLifecyclePersistenceStore;
  readonly outboundSender: OutboundChannelSender;
  readonly credentialResolver?: OutboundCredentialResolver;
  readonly now?: () => Date;
  /**
   * Reviewer-decision window before a pending approval expires (BACKEND_SPEC
   * section 12). Returned on every `createApproval` result so the workflow
   * arms the expiry timer from history-recorded data. `null`/omitted disables
   * expiry.
   */
  readonly approvalExpiresInMs?: number | null;
}

/**
 * Deterministic approval id for a workflow run. The `createApproval` activity
 * can be retried by Temporal, so the id derives from the workflow identity
 * (tenant, ticket, correlation) and the insert is conflict-safe: a retry
 * returns the already-created approval instead of a duplicate.
 */
export function deterministicApprovalId(
  tenantId: string,
  ticketId: string,
  correlationId: string,
): string {
  return `apr_${sha24([tenantId, ticketId, correlationId])}`;
}

/**
 * Fallback AI run id for failed runs that never produced one (input
 * validation failures return `ai_run_id: null`). Derived from the same
 * workflow identity as the runtime's own deterministic id, so activity
 * retries land on the same row.
 */
export function deterministicAiRunId(
  tenantId: string,
  ticketId: string,
  correlationId: string,
): string {
  return `air_${sha24([tenantId, ticketId, correlationId])}`;
}

/** Provenance recorded on `ai_runs` rows for the v1 deterministic runtime. */
export const AI_RUN_PROMPT_VERSION = "support_graph.v1";
export const AI_RUN_MODEL_PROVIDER = "deterministic";
export const AI_RUN_MODEL_ID = "deterministic-support-model.v1";

/**
 * Serializes the runtime-reported prompt-version map ("support_classifier.v1"
 * → "v1", ...) into the single `ai_runs.prompt_version` column: the sorted
 * prompt ids (which already carry their versions) joined by commas.
 */
export function formatPromptVersions(
  promptVersions: Readonly<Record<string, string>>,
  fallback: string,
): string {
  const promptIds = Object.keys(promptVersions).sort();

  return promptIds.length > 0 ? promptIds.join(",") : fallback;
}

/**
 * Provenance stamped on every persisted `ai_runs` row. The defaults describe
 * the in-process deterministic stand-in; the Milestone 14 sidecar composition
 * overrides `modelId` with the Python runtime's deterministic model id so the
 * row records which implementation actually produced the run.
 */
export interface AiRunProvenance {
  readonly promptVersion: string;
  readonly modelProvider: string;
  readonly modelId: string;
}

export interface PersistedRunAiGraphDependencies {
  readonly store: TicketLifecyclePersistenceStore;
  readonly now?: () => Date;
  readonly metrics?: SupportMetrics;
  readonly provenance?: AiRunProvenance;
}

/**
 * Wraps any `runAiGraph` activity implementation with AI run persistence
 * (BACKEND_SPEC §11) and AI run metrics. After the inner graph completes,
 * the run's structured output, confidence/risk/automation recommendation,
 * guardrail results, latency, and `trace_id` are written to `ai_runs` —
 * which is what lets `approvals.ai_run_id` / `messages.ai_run_id` link up
 * (the Milestone 10 FK guard finds the row from here on). Failed runs are
 * persisted too: they are operational evidence, and their `ai_run_id` is
 * backfilled deterministically when the runtime could not produce one.
 */
export function createPersistedRunAiGraph(
  runAiGraph: (
    input: RunAiGraphActivityInput,
  ) => Promise<RunAiGraphActivityResult>,
  dependencies: PersistedRunAiGraphDependencies,
): (input: RunAiGraphActivityInput) => Promise<RunAiGraphActivityResult> {
  const now = dependencies.now ?? (() => new Date());
  const metrics = dependencies.metrics ?? createNoopSupportMetrics();
  const provenance = dependencies.provenance ?? {
    promptVersion: AI_RUN_PROMPT_VERSION,
    modelProvider: AI_RUN_MODEL_PROVIDER,
    modelId: AI_RUN_MODEL_ID,
  };

  return async (input) => {
    const startedAt = now();
    const result = await runAiGraph(input);
    const completedAt = now();
    const latencyMs = Math.max(0, completedAt.getTime() - startedAt.getTime());

    const aiRunId =
      result.ai_run_id ??
      deterministicAiRunId(
        input.tenant_id,
        input.ticket_id,
        input.correlation_id,
      );

    // Since Milestone 15 the runtime reports its own provenance and usage on
    // the result (`model`): which provider/model actually produced the run,
    // the versioned prompts used, and token/cost totals. When present it wins
    // over the composition-time defaults, which remain the fallback for the
    // deterministic TS stand-in and pre-Milestone-15 sidecars.
    const usage = result.model ?? null;

    await dependencies.store.recordAiRunResult({
      tenantId: input.tenant_id,
      aiRunId,
      ticketId: input.ticket_id,
      conversationId: input.ticket.conversation_id,
      runType: "full_graph",
      promptVersion: usage
        ? formatPromptVersions(usage.prompt_versions, provenance.promptVersion)
        : provenance.promptVersion,
      modelProvider: usage?.provider ?? provenance.modelProvider,
      modelId: usage?.model_id ?? provenance.modelId,
      inputRefs: {
        correlation_id: input.correlation_id,
        initial_message_id: input.initial_message_id,
      },
      retrievedContextRefs:
        result.status === "succeeded"
          ? {
              evidence_ids:
                result.draft?.evidence.map((evidence) => evidence.ref_id) ?? [],
            }
          : {},
      structuredOutput:
        result.status === "succeeded"
          ? {
              classification: result.classification,
              routing_decision: result.routing_decision,
              tool_calls: result.tool_calls,
              draft: result.draft,
              guardrails: result.guardrails,
              final_recommendation: result.final_recommendation,
              eval_signals: result.eval_signals,
            }
          : {
              error_code: result.error_code,
              error_message: result.error_message,
              retryable: result.retryable,
              reason_codes: result.reason_codes,
              eval_signals: result.eval_signals,
            },
      confidence:
        result.status === "succeeded"
          ? result.final_recommendation.confidence
          : null,
      riskLevel:
        result.status === "succeeded"
          ? result.final_recommendation.risk_level
          : null,
      automationRecommendation:
        result.status === "succeeded"
          ? result.final_recommendation.automation_mode
          : null,
      guardrailResults: result.status === "succeeded" ? result.guardrails : {},
      status: result.status,
      latencyMs,
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
      costEstimate: usage?.cost_estimate ?? null,
      traceId: result.trace_id,
      completedAt,
    });

    metrics.recordAiRun({
      status: result.status,
      automationMode:
        result.status === "succeeded"
          ? result.final_recommendation.automation_mode
          : null,
      riskLevel:
        result.status === "succeeded"
          ? result.final_recommendation.risk_level
          : null,
      durationMs: latencyMs,
    });

    return result.status === "failed" && result.ai_run_id === null
      ? { ...result, ai_run_id: aiRunId }
      : result;
  };
}

export function createTicketLifecyclePersistenceActivities(
  dependencies: TicketLifecyclePersistenceActivityDependencies,
): TicketLifecyclePersistenceActivities {
  const now = dependencies.now ?? (() => new Date());
  const credentialResolver =
    dependencies.credentialResolver ?? createEnvOutboundCredentialResolver();
  const approvalExpiresInMs = dependencies.approvalExpiresInMs ?? null;

  return {
    async createOrUpdateTicket(input) {
      const conversationId = conversationIdFromTicketId(input.ticket_id);
      const { ticket, created } = await dependencies.store.createOrLoadTicket({
        tenantId: input.tenant_id,
        ticketId: input.ticket_id,
        conversationId,
        initialMessageId: input.initial_message_id,
        correlationId: input.correlation_id,
        openedAt: now(),
      });

      return {
        ticket: ticketSnapshotFromRecord(ticket),
        created,
        previous_status: created ? null : ticket.status,
        sla_timers: buildSlaTimers(ticket, now()),
      };
    },

    async runInitialTriage(input) {
      const message = await dependencies.store.getInboundMessageForTriage({
        tenantId: input.tenant_id,
        conversationId: input.ticket.conversation_id,
        messageId: input.initial_message_id,
      });

      if (!message) {
        // Intake commits the message row before signaling the workflow, so a
        // missing row is transient read skew at worst: let Temporal retry.
        throw new Error(
          `Inbound message ${input.initial_message_id} was not found for triage.`,
        );
      }

      const classification = classifyInitialTriage(message.bodyText);
      const priority = escalatePriority(
        input.ticket.priority,
        classification.priority,
      );
      const { fromStatus } = await dependencies.store.applyInitialTriage({
        tenantId: input.tenant_id,
        ticketId: input.ticket_id,
        correlationId: input.correlation_id,
        priority,
        topic: classification.topic,
        subtopic: classification.subtopic,
        language: classification.language,
        reasonCode: classification.reasonCode,
        metadata: {
          route: classification.route,
          sensitive_flags: classification.sensitiveFlags,
          initial_message_id: input.initial_message_id,
        },
      });

      return {
        status: "triaged",
        route: classification.route,
        reason_code: classification.reasonCode,
        metadata: {
          topic: classification.topic,
          subtopic: classification.subtopic,
          language: classification.language,
          priority,
          sensitive_flags: classification.sensitiveFlags,
          from_status: fromStatus,
        },
      };
    },

    async recordInboundMessage(input) {
      await dependencies.store.recordInboundMessage({
        tenantId: input.tenant_id,
        ticketId: input.ticket_id,
        conversationId: input.message.conversation_id,
        messageId: input.message.message_id,
        correlationId: input.correlation_id,
        receivedAt: input.message.received_at,
      });
    },

    async applyTicketStateTransition(input) {
      const outcome = await dependencies.store.applyTicketStateTransition({
        tenantId: input.tenant_id,
        ticketId: input.ticket_id,
        correlationId: input.correlation_id,
        toStatus: input.to_status,
        reasonCode: input.reason_code,
        metadata: input.metadata,
        actorType: input.actor.type,
        actorId: input.actor.id,
        transitionKey: input.transition_key,
      });

      return {
        applied: outcome.applied,
        from_status: outcome.fromStatus,
        to_status: outcome.toStatus,
      };
    },

    async expireApproval(input) {
      const outcome = await dependencies.store.expireApproval({
        tenantId: input.tenant_id,
        ticketId: input.ticket_id,
        approvalId: input.approval_id,
        correlationId: input.correlation_id,
        expiredAt: now(),
      });

      return { expired: outcome.expired, status: outcome.status };
    },

    async createApproval(input) {
      const approvalId = deterministicApprovalId(
        input.tenant_id,
        input.ticket_id,
        input.correlation_id,
      );
      const aiRunId = extractAiRunId(input.metadata);
      const { created } = await dependencies.store.createApproval({
        tenantId: input.tenant_id,
        approvalId,
        ticketId: input.ticket_id,
        aiRunId,
        approvalType: "reply",
        requestedPayload: {
          ...input.metadata,
          reason_code: input.reason_code,
        },
      });

      if (created) {
        await dependencies.store.appendAuditEvent({
          tenantId: input.tenant_id,
          auditEventId: `aud_${sha24([
            input.tenant_id,
            "approval.requested",
            approvalId,
          ])}`,
          actorType: "system",
          actorId: "workflow",
          entityType: "approval",
          entityId: approvalId,
          action: "approval.requested",
          metadata: {
            ticket_id: input.ticket_id,
            reason_code: input.reason_code,
            ai_run_id: aiRunId,
          },
          correlationId: input.correlation_id,
        });
      }

      return {
        approval_id: approvalId,
        status: "pending",
        expires_in_ms: approvalExpiresInMs,
      };
    },

    async sendOutboundMessage(input) {
      const existing = await dependencies.store.findMessageByIdempotencyKey({
        tenantId: input.tenant_id,
        idempotencyKey: input.idempotency_key,
      });

      if (existing && existing.sendStatus === "sent") {
        return replaySentResult(existing, now);
      }

      const context = await dependencies.store.getOutboundSendContext({
        tenantId: input.tenant_id,
        conversationId: input.conversation_id,
        approvalId: input.approval_id,
      });

      if (!context) {
        throw new NonRetryableActivityError(
          `Conversation ${input.conversation_id} was not found for the outbound send.`,
        );
      }

      const approval = context.approval;

      if (!approval) {
        throw new NonRetryableActivityError(
          `Approval ${input.approval_id} was not found for the outbound send.`,
        );
      }

      if (
        context.channel.type !== "email" &&
        context.channel.type !== "whatsapp"
      ) {
        throw new NonRetryableActivityError(
          `Channel ${context.channel.channelId} type "${context.channel.type}" has no outbound sender.`,
        );
      }

      if (!context.recipient) {
        throw new NonRetryableActivityError(
          `Customer ${context.conversation.customerId} has no ${context.channel.type} identity to deliver to.`,
        );
      }

      const draftText =
        extractDraftText(approval.approvedPayload) ??
        extractDraftText(approval.requestedPayload);

      if (draftText === null) {
        throw new NonRetryableActivityError(
          `Approval ${input.approval_id} has no draft text to send.`,
        );
      }

      let outboundMessage: NormalizedOutboundMessage;

      try {
        outboundMessage = NormalizedOutboundMessageSchema.parse({
          tenant_id: input.tenant_id,
          conversation_id: context.conversation.conversationId,
          ticket_id: input.ticket_id,
          channel_id: context.channel.channelId,
          channel: context.channel.type,
          provider: context.channel.provider,
          to: {
            type: context.recipient.identityType,
            value: context.recipient.identityValue,
            display_name: context.recipient.displayName,
          },
          direction: "outbound",
          subject: null,
          body: { text: draftText, html: null },
          external_thread_id: context.conversation.externalThreadId,
          approval_id: input.approval_id,
          ai_run_id: approval.aiRunId,
          sent_by_type: "human",
          sent_by_user_id: approval.reviewerUserId,
          idempotency_key: input.idempotency_key,
        });
      } catch (error) {
        throw new NonRetryableActivityError(
          `Outbound message failed contract validation: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const record =
        existing ??
        (await dependencies.store.createOutboundMessage({
          tenantId: input.tenant_id,
          messageId: `msg_out_${sha24([input.idempotency_key])}`,
          conversationId: context.conversation.conversationId,
          ticketId: input.ticket_id,
          channelId: context.channel.channelId,
          bodyText: draftText,
          approvalId: input.approval_id,
          aiRunId: approval.aiRunId,
          sentByUserId: approval.reviewerUserId,
          idempotencyKey: input.idempotency_key,
        }));

      if (record.sendStatus === "sent") {
        return replaySentResult(record, now);
      }

      const credentialRef = readCredentialRef(context.channel.config);
      const credential = credentialRef
        ? await credentialResolver.resolve(credentialRef)
        : null;
      const sendResult = await dependencies.outboundSender.send({
        message: outboundMessage,
        channelConfig: context.channel.config,
        credential,
      });

      if (sendResult.status === "sent") {
        const sentAt = now();
        await dependencies.store.recordSendResult({
          tenantId: input.tenant_id,
          messageId: record.messageId,
          sendStatus: "sent",
          providerMessageId: sendResult.provider_message_id,
          sentAt,
        });

        return {
          status: "sent",
          message_id: record.messageId,
          conversation_id: context.conversation.conversationId,
          channel_id: context.channel.channelId,
          external_message_id: sendResult.provider_message_id,
          sent_at: sentAt.toISOString(),
        };
      }

      await dependencies.store.recordSendResult({
        tenantId: input.tenant_id,
        messageId: record.messageId,
        sendStatus: "failed",
        providerMessageId: null,
        sentAt: null,
      });
      await dependencies.store.appendAuditEvent({
        tenantId: input.tenant_id,
        auditEventId: `aud_${sha24([
          input.tenant_id,
          "message.send_failed",
          record.messageId,
          sendResult.error_code,
        ])}`,
        actorType: "system",
        actorId: "workflow",
        entityType: "message",
        entityId: record.messageId,
        action: "message.send_failed",
        metadata: {
          ticket_id: input.ticket_id,
          approval_id: input.approval_id,
          conversation_id: context.conversation.conversationId,
          channel_id: context.channel.channelId,
          error_code: sendResult.error_code,
          error_message: sendResult.error_message,
          retryable: sendResult.retryable,
        },
        correlationId: input.correlation_id,
      });

      if (!sendResult.retryable) {
        throw new NonRetryableActivityError(
          `Outbound send failed permanently (${sendResult.error_code}): ${sendResult.error_message}`,
        );
      }

      throw new Error(
        `Outbound send failed (${sendResult.error_code}): ${sendResult.error_message}`,
      );
    },

    async recordAuditEvent(input) {
      await dependencies.store.appendAuditEvent({
        tenantId: input.tenant_id,
        auditEventId: `aud_${sha24([
          input.tenant_id,
          input.ticket_id,
          input.action,
          input.correlation_id,
          stableStringify(input.metadata),
        ])}`,
        actorType: input.actor.type,
        actorId: input.actor.id,
        entityType: "ticket",
        entityId: input.ticket_id,
        action: input.action,
        metadata: input.metadata,
        correlationId: input.correlation_id,
      });
    },
  };
}

/**
 * Database-backed persistence store. The client connects lazily on first use
 * so workers that never run these activities open no connection; every
 * tenant-scoped statement runs under `withTenantTransaction`/RLS.
 */
export function createDatabaseTicketLifecyclePersistenceStore(
  options: { readonly now?: () => Date } = {},
): TicketLifecyclePersistenceStore {
  let database: ReturnType<typeof createDatabaseFromEnv> | undefined;
  const now = options.now ?? (() => new Date());

  function getDatabase() {
    database ??= createDatabaseFromEnv();
    return database;
  }

  return {
    async createOrLoadTicket(input) {
      const scope = { tenantId: input.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const existingRows = await ticketByIdQuery(db, scope, input.ticketId);

        if (existingRows[0]) {
          await linkMessageToTicketByIdQuery(
            db,
            scope,
            input.initialMessageId,
            input.ticketId,
          );
          return { ticket: mapTicketRow(existingRows[0]), created: false };
        }

        const conversationRows = await conversationByIdQuery(
          db,
          scope,
          input.conversationId,
        );
        const conversation = conversationRows[0];

        if (!conversation) {
          throw new NonRetryableActivityError(
            `Conversation ${input.conversationId} was not found for ticket creation.`,
          );
        }

        const slaRows = await activeSlaPolicyForTenantQuery(db, scope);
        const slaPolicy = slaRows[0] ?? null;
        const values: Omit<NewTicket, "tenantId"> = {
          ticketId: input.ticketId,
          conversationId: input.conversationId,
          customerId: conversation.customerId,
          status: "new",
          priority: slaPolicy?.priority ?? "p2",
          automationMode: "human_approve",
          slaPolicyId: slaPolicy?.slaPolicyId ?? null,
          openedAt: input.openedAt,
          firstResponseDueAt: slaPolicy
            ? addMinutes(input.openedAt, slaPolicy.firstResponseMinutes)
            : null,
          nextResponseDueAt: slaPolicy
            ? addMinutes(input.openedAt, slaPolicy.nextResponseMinutes)
            : null,
          resolutionDueAt: slaPolicy
            ? addMinutes(input.openedAt, slaPolicy.resolutionMinutes)
            : null,
        };
        const inserted = await createTicketIfAbsentQuery(db, scope, values);
        let row = inserted[0];
        const created = row !== undefined;

        if (!row) {
          const reread = await ticketByIdQuery(db, scope, input.ticketId);

          if (!reread[0]) {
            throw new Error(
              `Ticket ${input.ticketId} conflicted on insert but could not be read back.`,
            );
          }

          row = reread[0];
        }

        await linkMessageToTicketByIdQuery(
          db,
          scope,
          input.initialMessageId,
          input.ticketId,
        );

        if (created) {
          await createTicketEventQuery(db, scope, {
            ticketEventId: `tev_${sha24([
              input.tenantId,
              input.ticketId,
              "ticket-created",
            ])}`,
            ticketId: input.ticketId,
            eventType: "ticket_created",
            fromStatus: null,
            toStatus: "new",
            actorType: "system",
            actorId: "workflow",
            reasonCode: null,
            metadata: {
              conversation_id: input.conversationId,
              initial_message_id: input.initialMessageId,
            },
          });
          await createAuditEventQuery(db, scope, {
            auditEventId: `aud_${sha24([
              input.tenantId,
              "ticket.created",
              input.ticketId,
            ])}`,
            actorType: "system",
            actorId: "workflow",
            entityType: "ticket",
            entityId: input.ticketId,
            action: "ticket.created",
            metadata: {
              conversation_id: input.conversationId,
              customer_id: conversation.customerId,
              initial_message_id: input.initialMessageId,
              sla_policy_id: slaPolicy?.slaPolicyId ?? null,
            },
            correlationId: input.correlationId,
          });
        }

        return { ticket: mapTicketRow(row), created };
      });
    },

    async recordInboundMessage(input) {
      const scope = { tenantId: input.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const messageRows = await messageByIdQuery(
          db,
          scope,
          input.conversationId,
          input.messageId,
        );
        const message = messageRows[0];

        if (!message) {
          // Intake commits before signaling; treat a missing row as transient
          // and let the Temporal retry policy re-read.
          throw new Error(
            `Inbound message ${input.messageId} was not found for reconciliation.`,
          );
        }

        if (message.ticketId !== null && message.ticketId !== input.ticketId) {
          throw new NonRetryableActivityError(
            `Message ${input.messageId} is already linked to ticket ${message.ticketId}, not ${input.ticketId}.`,
          );
        }

        const ticketRows = await ticketByIdQuery(db, scope, input.ticketId);
        const ticket = ticketRows[0];

        if (!ticket) {
          // The signal can outrun `createOrUpdateTicket`; the initial-message
          // link is that activity's job, so skip instead of FK-failing.
          return { linked: false, ticketStatus: null, transition: null };
        }

        let linked = false;

        if (message.ticketId === null) {
          const linkedRows = await linkMessageToTicketByIdQuery(
            db,
            scope,
            input.messageId,
            input.ticketId,
          );
          linked = linkedRows[0] !== undefined;
        }

        if (ticket.status !== "waiting_customer") {
          return { linked, ticketStatus: ticket.status, transition: null };
        }

        await updateTicketByIdQuery(db, scope, input.ticketId, {
          status: "waiting_human",
          updatedAt: now(),
        });
        await createTicketEventQuery(db, scope, {
          ticketEventId: `tev_${sha24([
            input.tenantId,
            input.ticketId,
            "customer-replied",
            input.messageId,
          ])}`,
          ticketId: input.ticketId,
          eventType: "ticket_state_transition",
          fromStatus: "waiting_customer",
          toStatus: "waiting_human",
          actorType: "system",
          actorId: "workflow",
          reasonCode: "customer_replied",
          metadata: {
            message_id: input.messageId,
            received_at: input.receivedAt,
          },
        });
        await createAuditEventQuery(db, scope, {
          auditEventId: `aud_${sha24([
            input.tenantId,
            input.ticketId,
            "ticket.updated",
            "customer-replied",
            input.messageId,
          ])}`,
          actorType: "system",
          actorId: "workflow",
          entityType: "ticket",
          entityId: input.ticketId,
          action: "ticket.updated",
          metadata: {
            from_status: "waiting_customer",
            to_status: "waiting_human",
            reason_code: "customer_replied",
            message_id: input.messageId,
            received_at: input.receivedAt,
          },
          correlationId: input.correlationId,
        });

        return {
          linked,
          ticketStatus: "waiting_human",
          transition: {
            fromStatus: "waiting_customer",
            toStatus: "waiting_human",
          },
        };
      });
    },

    async getInboundMessageForTriage(params) {
      const scope = { tenantId: params.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await messageByIdQuery(
          db,
          scope,
          params.conversationId,
          params.messageId,
        );

        return rows[0]
          ? { messageId: rows[0].messageId, bodyText: rows[0].bodyText }
          : null;
      });
    },

    async applyInitialTriage(input) {
      const scope = { tenantId: input.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const ticketRows = await ticketByIdQuery(db, scope, input.ticketId);
        const ticket = ticketRows[0];

        if (!ticket) {
          throw new NonRetryableActivityError(
            `Ticket ${input.ticketId} was not found for triage.`,
          );
        }

        const fromStatus = ticket.status;
        const updatedRows = await updateTicketByIdQuery(
          db,
          scope,
          input.ticketId,
          {
            status: "triaged",
            priority: input.priority,
            topic: input.topic,
            subtopic: input.subtopic,
            language: input.language,
            updatedAt: now(),
          },
        );
        const updated = updatedRows[0];

        if (!updated) {
          throw new Error(
            `Ticket ${input.ticketId} disappeared while applying triage.`,
          );
        }

        if (fromStatus !== "triaged") {
          await createTicketEventQuery(db, scope, {
            ticketEventId: `tev_${sha24([
              input.tenantId,
              input.ticketId,
              "initial-triage",
            ])}`,
            ticketId: input.ticketId,
            eventType: "ticket_state_transition",
            fromStatus,
            toStatus: "triaged",
            actorType: "system",
            actorId: "workflow",
            reasonCode: input.reasonCode,
            metadata: input.metadata,
          });
          await createAuditEventQuery(db, scope, {
            auditEventId: `aud_${sha24([
              input.tenantId,
              input.ticketId,
              "ticket.updated",
              "initial-triage",
            ])}`,
            actorType: "system",
            actorId: "workflow",
            entityType: "ticket",
            entityId: input.ticketId,
            action: "ticket.updated",
            metadata: {
              from_status: fromStatus,
              to_status: "triaged",
              reason_code: input.reasonCode,
              priority: input.priority,
              topic: input.topic,
              subtopic: input.subtopic,
              language: input.language,
            },
            correlationId: input.correlationId,
          });
        }

        return { ticket: mapTicketRow(updated), fromStatus };
      });
    },

    async applyTicketStateTransition(input) {
      const scope = { tenantId: input.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const ticketRows = await ticketByIdQuery(db, scope, input.ticketId);
        const ticket = ticketRows[0];

        if (!ticket) {
          throw new NonRetryableActivityError(
            `Ticket ${input.ticketId} was not found for the ${input.toStatus} transition.`,
          );
        }

        const fromStatus = ticket.status;

        if (fromStatus === input.toStatus) {
          return { applied: false, fromStatus, toStatus: input.toStatus };
        }

        const patch: Partial<NewTicket> = {
          status: input.toStatus,
          updatedAt: now(),
        };

        if (input.toStatus === "resolved") {
          patch.resolvedAt = now();
        }
        if (input.toStatus === "closed") {
          patch.closedAt = now();
        }

        await updateTicketByIdQuery(db, scope, input.ticketId, patch);
        await createTicketEventQuery(db, scope, {
          ticketEventId: `tev_${sha24([
            input.tenantId,
            input.ticketId,
            input.transitionKey,
          ])}`,
          ticketId: input.ticketId,
          eventType: "ticket_state_transition",
          fromStatus,
          toStatus: input.toStatus,
          actorType: input.actorType,
          actorId: input.actorId,
          reasonCode: input.reasonCode,
          metadata: input.metadata,
        });

        const action =
          input.toStatus === "closed" ? "ticket.closed" : "ticket.updated";
        await createAuditEventQuery(db, scope, {
          auditEventId: `aud_${sha24([
            input.tenantId,
            input.ticketId,
            action,
            input.transitionKey,
          ])}`,
          actorType: input.actorType,
          actorId: input.actorId,
          entityType: "ticket",
          entityId: input.ticketId,
          action,
          metadata: {
            from_status: fromStatus,
            to_status: input.toStatus,
            reason_code: input.reasonCode,
            transition_key: input.transitionKey,
            ...input.metadata,
          },
          correlationId: input.correlationId,
        });

        return { applied: true, fromStatus, toStatus: input.toStatus };
      });
    },

    async expireApproval(input) {
      const scope = { tenantId: input.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const resolved = await resolvePendingApprovalByIdQuery(
          db,
          scope,
          input.approvalId,
          { status: "expired", resolvedAt: input.expiredAt },
        );

        if (resolved[0]) {
          await appendApprovalExpiredAudit(db, scope, input);
          return { expired: true, status: "expired" as const };
        }

        const existingRows = await approvalByIdQuery(
          db,
          scope,
          input.approvalId,
        );
        const existing = existingRows[0];

        if (!existing) {
          throw new NonRetryableActivityError(
            `Approval ${input.approvalId} was not found while expiring.`,
          );
        }

        if (existing.status === "expired") {
          // Activity retry replay: the expiry landed on a previous attempt.
          // The audit id is deterministic, so re-appending is a no-op.
          await appendApprovalExpiredAudit(db, scope, input);
          return { expired: true, status: "expired" as const };
        }

        return { expired: false, status: existing.status };
      });
    },

    async createApproval(input) {
      const scope = { tenantId: input.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        // `approvals.ai_run_id` is a foreign key into `ai_runs`. Runs are
        // persisted by `createPersistedRunAiGraph` before the workflow asks
        // for an approval, so the row normally exists; the guard remains for
        // runs recorded by other paths, and the id is always available inside
        // `requested_payload.ai_graph.ai_run_id` either way.
        const aiRunId =
          input.aiRunId !== null &&
          (await aiRunByIdQuery(db, scope, input.aiRunId))[0]
            ? input.aiRunId
            : null;
        const inserted = await createApprovalQuery(db, scope, {
          approvalId: input.approvalId,
          ticketId: input.ticketId,
          aiRunId,
          approvalType: input.approvalType,
          status: "pending",
          requestedPayload: input.requestedPayload,
        });

        if (inserted[0]) {
          return { approval: mapApprovalRow(inserted[0]), created: true };
        }

        const existing = await approvalByIdQuery(db, scope, input.approvalId);

        if (!existing[0]) {
          throw new Error(
            `Approval ${input.approvalId} conflicted on insert but could not be read back.`,
          );
        }

        return { approval: mapApprovalRow(existing[0]), created: false };
      });
    },

    async getOutboundSendContext(params) {
      const scope = { tenantId: params.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const conversationRows = await conversationByIdQuery(
          db,
          scope,
          params.conversationId,
        );
        const conversation = conversationRows[0];

        if (!conversation) {
          return null;
        }

        const channelRows = await channelByIdQuery(db, conversation.channelId);
        const channel = channelRows[0];

        if (!channel || channel.tenantId !== params.tenantId) {
          return null;
        }

        const approvalRows = await approvalByIdQuery(
          db,
          scope,
          params.approvalId,
        );
        const identityRows = await customerIdentityForCustomerQuery(db, scope, {
          customerId: conversation.customerId,
          channel: channel.type,
        });
        const identity = identityRows[0];

        return {
          conversation: {
            conversationId: conversation.conversationId,
            channelId: conversation.channelId,
            customerId: conversation.customerId,
            externalThreadId: conversation.externalThreadId,
          },
          channel: {
            channelId: channel.channelId,
            type: channel.type,
            provider: channel.provider,
            config: channel.config,
          },
          recipient: identity
            ? {
                identityType: identity.identityType,
                identityValue: identity.identityValue,
                displayName: null,
              }
            : null,
          approval: approvalRows[0] ? mapApprovalRow(approvalRows[0]) : null,
        };
      });
    },

    async findMessageByIdempotencyKey(params) {
      const scope = { tenantId: params.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await messageByIdempotencyKeyQuery(
          db,
          scope,
          params.idempotencyKey,
        );

        return rows[0] ? mapMessageRow(rows[0]) : null;
      });
    },

    async createOutboundMessage(input) {
      const scope = { tenantId: input.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const inserted = await createOutboundMessageQuery(db, scope, {
          messageId: input.messageId,
          conversationId: input.conversationId,
          ticketId: input.ticketId,
          channelId: input.channelId,
          direction: "outbound",
          bodyText: input.bodyText,
          bodyHtmlRef: null,
          attachments: [],
          externalMessageId: null,
          externalThreadId: null,
          rawPayloadRef: null,
          createdByType: "human",
          createdByUserId: input.sentByUserId,
          sendStatus: "queued",
          sentByType: "human",
          aiRunId: input.aiRunId,
          approvalId: input.approvalId,
          idempotencyKey: input.idempotencyKey,
        });

        if (inserted[0]) {
          return mapMessageRow(inserted[0]);
        }

        const existing = await messageByIdempotencyKeyQuery(
          db,
          scope,
          input.idempotencyKey,
        );

        if (!existing[0]) {
          throw new Error(
            `Outbound message for key ${input.idempotencyKey} conflicted on insert but could not be read back.`,
          );
        }

        return mapMessageRow(existing[0]);
      });
    },

    async recordSendResult(input) {
      const scope = { tenantId: input.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await updateMessageSendResultByIdQuery(
          db,
          scope,
          input.messageId,
          {
            sendStatus: input.sendStatus,
            providerMessageId: input.providerMessageId,
            sentAt: input.sentAt,
          },
        );

        if (!rows[0]) {
          throw new Error(
            `Outbound message ${input.messageId} was not found while recording the send result.`,
          );
        }

        return mapMessageRow(rows[0]);
      });
    },

    async appendAuditEvent(input) {
      const scope = { tenantId: input.tenantId };

      await withTenantTransaction(getDatabase().client, scope, async (db) => {
        await createAuditEventQuery(db, scope, {
          auditEventId: input.auditEventId,
          actorType: input.actorType,
          actorId: input.actorId,
          entityType: input.entityType,
          entityId: input.entityId,
          action: input.action,
          metadata: input.metadata,
          correlationId: input.correlationId,
        });
      });
    },

    async recordAiRunResult(input) {
      const scope = { tenantId: input.tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        // `ai_runs.ticket_id`/`conversation_id` are non-null foreign keys.
        // A run can only be recorded once its ticket row exists; when it
        // does not (placeholder ticket activities in tests), the evidence is
        // skipped instead of failing the workflow with an FK violation.
        const ticketRows = await ticketByIdQuery(db, scope, input.ticketId);

        if (!ticketRows[0]) {
          return { aiRunId: input.aiRunId, created: false, persisted: false };
        }

        const inserted = await createAiRunQuery(db, scope, {
          aiRunId: input.aiRunId,
          ticketId: input.ticketId,
          conversationId: input.conversationId,
          runType: input.runType,
          promptVersion: input.promptVersion,
          modelProvider: input.modelProvider,
          modelId: input.modelId,
          inputRefs: input.inputRefs,
          retrievedContextRefs: input.retrievedContextRefs,
          structuredOutput: input.structuredOutput,
          confidence: input.confidence,
          riskLevel: input.riskLevel,
          automationRecommendation: input.automationRecommendation,
          guardrailResults: input.guardrailResults,
          status: input.status,
          latencyMs: input.latencyMs,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          costEstimate: input.costEstimate,
          traceId: input.traceId,
          completedAt: input.completedAt,
        });

        if (inserted[0] === undefined) {
          // The row already exists: either an activity retry replaying the
          // same deterministic run id, or the `started` anchor the tool
          // registry created mid-run so `tool_calls.ai_run_id` could resolve
          // (Milestone 14 service bridge). Complete it with the terminal
          // outcome and real provenance — the modeled lifecycle transition
          // from `started` to the run's final state.
          await completeAiRunByIdQuery(db, scope, input.aiRunId, {
            promptVersion: input.promptVersion,
            modelProvider: input.modelProvider,
            modelId: input.modelId,
            inputRefs: input.inputRefs,
            retrievedContextRefs: input.retrievedContextRefs,
            structuredOutput: input.structuredOutput,
            confidence: input.confidence,
            riskLevel: input.riskLevel,
            automationRecommendation: input.automationRecommendation,
            guardrailResults: input.guardrailResults,
            status: input.status,
            latencyMs: input.latencyMs,
            inputTokens: input.inputTokens,
            outputTokens: input.outputTokens,
            costEstimate: input.costEstimate,
            traceId: input.traceId,
            completedAt: input.completedAt,
          });
        }

        return {
          aiRunId: input.aiRunId,
          created: inserted[0] !== undefined,
          persisted: true,
        };
      });
    },

    async close() {
      await database?.client.end();
    },
  };
}

export interface InMemoryTicketLifecyclePersistenceFixtures {
  readonly conversations?: readonly {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly channelId: string;
    readonly customerId: string;
    readonly externalThreadId: string | null;
  }[];
  readonly channels?: readonly {
    readonly tenantId: string;
    readonly channelId: string;
    readonly type: string;
    readonly provider: string;
    readonly config: JsonObject;
  }[];
  readonly identities?: readonly {
    readonly tenantId: string;
    readonly customerId: string;
    readonly channel: string;
    readonly identityType: string;
    readonly identityValue: string;
    readonly displayName?: string | null;
  }[];
  readonly approvals?: readonly ({
    readonly tenantId: string;
  } & TicketLifecycleApprovalRecord)[];
  readonly slaPolicies?: readonly {
    readonly tenantId: string;
    readonly slaPolicyId: string;
    readonly priority: Ticket["priority"];
    readonly firstResponseMinutes: number;
    readonly nextResponseMinutes: number;
    readonly resolutionMinutes: number;
    readonly status: "draft" | "active" | "archived";
  }[];
  readonly inboundMessages?: readonly {
    readonly tenantId: string;
    readonly messageId: string;
    readonly conversationId: string;
    readonly bodyText: string | null;
    readonly ticketId?: string | null;
  }[];
  readonly tickets?: readonly ({
    readonly tenantId: string;
  } & TicketLifecycleTicketRecord)[];
}

export interface InMemoryInboundMessageRecord {
  readonly tenantId: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly bodyText: string | null;
  readonly ticketId: string | null;
}

export interface InMemoryTicketEventRecord {
  readonly tenantId: string;
  readonly ticketEventId: string;
  readonly ticketId: string;
  readonly eventType: string;
  readonly fromStatus: Ticket["status"] | null;
  readonly toStatus: Ticket["status"] | null;
  readonly actorType: DomainEventActorType;
  readonly actorId: string | null;
  readonly reasonCode: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface InMemoryTicketLifecyclePersistenceStore extends TicketLifecyclePersistenceStore {
  listApprovals(): readonly ({
    tenantId: string;
  } & TicketLifecycleApprovalRecord)[];
  listMessages(): readonly ({
    tenantId: string;
    ticketId: string;
    bodyText: string;
    approvalId: string;
    idempotencyKey: string;
  } & OutboundMessageRecord)[];
  listAuditEvents(): readonly AppendAuditEventInput[];
  listAiRuns(): readonly RecordAiRunResultInput[];
  listTickets(): readonly ({
    tenantId: string;
  } & TicketLifecycleTicketRecord)[];
  listTicketEvents(): readonly InMemoryTicketEventRecord[];
  listInboundMessages(): readonly InMemoryInboundMessageRecord[];
  setApprovalDecision(params: {
    readonly tenantId: string;
    readonly approvalId: string;
    readonly status: Approval["status"];
    readonly approvedPayload: JsonObject | null;
    readonly reviewerUserId: string | null;
  }): void;
}

/**
 * In-memory persistence store mirroring the database semantics (deterministic
 * id dedup, idempotency-key uniqueness, tenant scoping) for offline activity
 * tests. Unlike the database store it has no `ai_runs` foreign key, so every
 * candidate `aiRunId` is treated as existing and linked verbatim.
 */
export function createInMemoryTicketLifecyclePersistenceStore(
  fixtures: InMemoryTicketLifecyclePersistenceFixtures = {},
  options: { readonly now?: () => Date } = {},
): InMemoryTicketLifecyclePersistenceStore {
  const now = options.now ?? (() => new Date());
  const approvals = new Map<
    string,
    { tenantId: string } & TicketLifecycleApprovalRecord
  >();
  const messages = new Map<
    string,
    {
      tenantId: string;
      ticketId: string;
      bodyText: string;
      approvalId: string;
      idempotencyKey: string;
    } & OutboundMessageRecord
  >();
  const auditEvents = new Map<string, AppendAuditEventInput>();
  const aiRuns = new Map<string, RecordAiRunResultInput>();
  const tickets = new Map<
    string,
    { tenantId: string } & TicketLifecycleTicketRecord
  >();
  const ticketEvents = new Map<string, InMemoryTicketEventRecord>();
  const inboundMessages = new Map<string, InMemoryInboundMessageRecord>();
  const conversations = [...(fixtures.conversations ?? [])];
  const channels = [...(fixtures.channels ?? [])];
  const identities = [...(fixtures.identities ?? [])];
  const slaPolicies = [...(fixtures.slaPolicies ?? [])];

  for (const approval of fixtures.approvals ?? []) {
    approvals.set(`${approval.tenantId}:${approval.approvalId}`, {
      ...approval,
    });
  }

  for (const ticket of fixtures.tickets ?? []) {
    tickets.set(`${ticket.tenantId}:${ticket.ticketId}`, { ...ticket });
  }

  for (const message of fixtures.inboundMessages ?? []) {
    inboundMessages.set(`${message.tenantId}:${message.messageId}`, {
      tenantId: message.tenantId,
      messageId: message.messageId,
      conversationId: message.conversationId,
      bodyText: message.bodyText,
      ticketId: message.ticketId ?? null,
    });
  }

  function messageByKey(tenantId: string, idempotencyKey: string) {
    for (const record of messages.values()) {
      if (
        record.tenantId === tenantId &&
        record.idempotencyKey === idempotencyKey
      ) {
        return record;
      }
    }

    return null;
  }

  function appendTicketEvent(event: InMemoryTicketEventRecord) {
    const key = `${event.tenantId}:${event.ticketEventId}`;

    if (!ticketEvents.has(key)) {
      ticketEvents.set(key, event);
    }
  }

  function appendAudit(input: AppendAuditEventInput) {
    const key = `${input.tenantId}:${input.auditEventId}`;

    if (!auditEvents.has(key)) {
      auditEvents.set(key, input);
    }
  }

  function linkInboundMessage(
    tenantId: string,
    messageId: string,
    ticketId: string,
  ): boolean {
    const key = `${tenantId}:${messageId}`;
    const record = inboundMessages.get(key);

    if (!record || record.ticketId === ticketId) {
      return false;
    }

    if (record.ticketId !== null) {
      throw new NonRetryableActivityError(
        `Message ${messageId} is already linked to ticket ${record.ticketId}, not ${ticketId}.`,
      );
    }

    inboundMessages.set(key, { ...record, ticketId });
    return true;
  }

  return {
    async createOrLoadTicket(input) {
      const key = `${input.tenantId}:${input.ticketId}`;
      const existing = tickets.get(key);

      if (existing) {
        linkInboundMessage(
          input.tenantId,
          input.initialMessageId,
          input.ticketId,
        );
        return { ticket: { ...existing }, created: false };
      }

      const conversation = conversations.find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.conversationId === input.conversationId,
      );

      if (!conversation) {
        throw new NonRetryableActivityError(
          `Conversation ${input.conversationId} was not found for ticket creation.`,
        );
      }

      const slaPolicy =
        slaPolicies.find(
          (candidate) =>
            candidate.tenantId === input.tenantId &&
            candidate.status === "active",
        ) ?? null;
      const ticket: { tenantId: string } & TicketLifecycleTicketRecord = {
        tenantId: input.tenantId,
        ticketId: input.ticketId,
        conversationId: input.conversationId,
        customerId: conversation.customerId,
        status: "new",
        priority: slaPolicy?.priority ?? "p2",
        automationMode: "human_approve",
        assignedQueue: null,
        assignedUserId: null,
        slaPolicyId: slaPolicy?.slaPolicyId ?? null,
        topic: null,
        subtopic: null,
        language: null,
        openedAt: input.openedAt,
        firstResponseDueAt: slaPolicy
          ? addMinutes(input.openedAt, slaPolicy.firstResponseMinutes)
          : null,
        nextResponseDueAt: slaPolicy
          ? addMinutes(input.openedAt, slaPolicy.nextResponseMinutes)
          : null,
        resolutionDueAt: slaPolicy
          ? addMinutes(input.openedAt, slaPolicy.resolutionMinutes)
          : null,
        resolvedAt: null,
        closedAt: null,
      };
      tickets.set(key, ticket);
      linkInboundMessage(
        input.tenantId,
        input.initialMessageId,
        input.ticketId,
      );
      appendTicketEvent({
        tenantId: input.tenantId,
        ticketEventId: `tev_${sha24([
          input.tenantId,
          input.ticketId,
          "ticket-created",
        ])}`,
        ticketId: input.ticketId,
        eventType: "ticket_created",
        fromStatus: null,
        toStatus: "new",
        actorType: "system",
        actorId: "workflow",
        reasonCode: null,
        metadata: {
          conversation_id: input.conversationId,
          initial_message_id: input.initialMessageId,
        },
      });
      appendAudit({
        tenantId: input.tenantId,
        auditEventId: `aud_${sha24([
          input.tenantId,
          "ticket.created",
          input.ticketId,
        ])}`,
        actorType: "system",
        actorId: "workflow",
        entityType: "ticket",
        entityId: input.ticketId,
        action: "ticket.created",
        metadata: {
          conversation_id: input.conversationId,
          customer_id: conversation.customerId,
          initial_message_id: input.initialMessageId,
          sla_policy_id: slaPolicy?.slaPolicyId ?? null,
        },
        correlationId: input.correlationId,
      });

      return { ticket: { ...ticket }, created: true };
    },

    async recordInboundMessage(input) {
      const messageKey = `${input.tenantId}:${input.messageId}`;
      const message = inboundMessages.get(messageKey);

      if (!message) {
        throw new Error(
          `Inbound message ${input.messageId} was not found for reconciliation.`,
        );
      }

      if (message.ticketId !== null && message.ticketId !== input.ticketId) {
        throw new NonRetryableActivityError(
          `Message ${input.messageId} is already linked to ticket ${message.ticketId}, not ${input.ticketId}.`,
        );
      }

      const ticketKey = `${input.tenantId}:${input.ticketId}`;
      const ticket = tickets.get(ticketKey);

      if (!ticket) {
        return { linked: false, ticketStatus: null, transition: null };
      }

      const linked =
        message.ticketId === null &&
        linkInboundMessage(input.tenantId, input.messageId, input.ticketId);

      if (ticket.status !== "waiting_customer") {
        return { linked, ticketStatus: ticket.status, transition: null };
      }

      tickets.set(ticketKey, { ...ticket, status: "waiting_human" });
      appendTicketEvent({
        tenantId: input.tenantId,
        ticketEventId: `tev_${sha24([
          input.tenantId,
          input.ticketId,
          "customer-replied",
          input.messageId,
        ])}`,
        ticketId: input.ticketId,
        eventType: "ticket_state_transition",
        fromStatus: "waiting_customer",
        toStatus: "waiting_human",
        actorType: "system",
        actorId: "workflow",
        reasonCode: "customer_replied",
        metadata: {
          message_id: input.messageId,
          received_at: input.receivedAt,
        },
      });
      appendAudit({
        tenantId: input.tenantId,
        auditEventId: `aud_${sha24([
          input.tenantId,
          input.ticketId,
          "ticket.updated",
          "customer-replied",
          input.messageId,
        ])}`,
        actorType: "system",
        actorId: "workflow",
        entityType: "ticket",
        entityId: input.ticketId,
        action: "ticket.updated",
        metadata: {
          from_status: "waiting_customer",
          to_status: "waiting_human",
          reason_code: "customer_replied",
          message_id: input.messageId,
          received_at: input.receivedAt,
        },
        correlationId: input.correlationId,
      });

      return {
        linked,
        ticketStatus: "waiting_human",
        transition: {
          fromStatus: "waiting_customer",
          toStatus: "waiting_human",
        },
      };
    },

    async getInboundMessageForTriage(params) {
      const record = inboundMessages.get(
        `${params.tenantId}:${params.messageId}`,
      );

      return record
        ? { messageId: record.messageId, bodyText: record.bodyText }
        : null;
    },

    async applyInitialTriage(input) {
      const key = `${input.tenantId}:${input.ticketId}`;
      const ticket = tickets.get(key);

      if (!ticket) {
        throw new NonRetryableActivityError(
          `Ticket ${input.ticketId} was not found for triage.`,
        );
      }

      const fromStatus = ticket.status;
      const updated = {
        ...ticket,
        status: "triaged" as const,
        priority: input.priority,
        topic: input.topic,
        subtopic: input.subtopic,
        language: input.language,
      };
      tickets.set(key, updated);

      if (fromStatus !== "triaged") {
        appendTicketEvent({
          tenantId: input.tenantId,
          ticketEventId: `tev_${sha24([
            input.tenantId,
            input.ticketId,
            "initial-triage",
          ])}`,
          ticketId: input.ticketId,
          eventType: "ticket_state_transition",
          fromStatus,
          toStatus: "triaged",
          actorType: "system",
          actorId: "workflow",
          reasonCode: input.reasonCode,
          metadata: input.metadata,
        });
        appendAudit({
          tenantId: input.tenantId,
          auditEventId: `aud_${sha24([
            input.tenantId,
            input.ticketId,
            "ticket.updated",
            "initial-triage",
          ])}`,
          actorType: "system",
          actorId: "workflow",
          entityType: "ticket",
          entityId: input.ticketId,
          action: "ticket.updated",
          metadata: {
            from_status: fromStatus,
            to_status: "triaged",
            reason_code: input.reasonCode,
            priority: input.priority,
            topic: input.topic,
            subtopic: input.subtopic,
            language: input.language,
          },
          correlationId: input.correlationId,
        });
      }

      return { ticket: { ...updated }, fromStatus };
    },

    async applyTicketStateTransition(input) {
      const key = `${input.tenantId}:${input.ticketId}`;
      const ticket = tickets.get(key);

      if (!ticket) {
        throw new NonRetryableActivityError(
          `Ticket ${input.ticketId} was not found for the ${input.toStatus} transition.`,
        );
      }

      const fromStatus = ticket.status;

      if (fromStatus === input.toStatus) {
        return { applied: false, fromStatus, toStatus: input.toStatus };
      }

      tickets.set(key, {
        ...ticket,
        status: input.toStatus,
        resolvedAt: input.toStatus === "resolved" ? now() : ticket.resolvedAt,
        closedAt: input.toStatus === "closed" ? now() : ticket.closedAt,
      });
      appendTicketEvent({
        tenantId: input.tenantId,
        ticketEventId: `tev_${sha24([
          input.tenantId,
          input.ticketId,
          input.transitionKey,
        ])}`,
        ticketId: input.ticketId,
        eventType: "ticket_state_transition",
        fromStatus,
        toStatus: input.toStatus,
        actorType: input.actorType,
        actorId: input.actorId,
        reasonCode: input.reasonCode,
        metadata: input.metadata,
      });

      const action =
        input.toStatus === "closed" ? "ticket.closed" : "ticket.updated";
      appendAudit({
        tenantId: input.tenantId,
        auditEventId: `aud_${sha24([
          input.tenantId,
          input.ticketId,
          action,
          input.transitionKey,
        ])}`,
        actorType: input.actorType,
        actorId: input.actorId,
        entityType: "ticket",
        entityId: input.ticketId,
        action,
        metadata: {
          from_status: fromStatus,
          to_status: input.toStatus,
          reason_code: input.reasonCode,
          transition_key: input.transitionKey,
          ...input.metadata,
        },
        correlationId: input.correlationId,
      });

      return { applied: true, fromStatus, toStatus: input.toStatus };
    },

    async expireApproval(input) {
      const key = `${input.tenantId}:${input.approvalId}`;
      const approval = approvals.get(key);

      if (!approval) {
        throw new NonRetryableActivityError(
          `Approval ${input.approvalId} was not found while expiring.`,
        );
      }

      if (approval.status !== "pending" && approval.status !== "expired") {
        return { expired: false, status: approval.status };
      }

      approvals.set(key, { ...approval, status: "expired" });
      appendAudit({
        tenantId: input.tenantId,
        auditEventId: `aud_${sha24([
          input.tenantId,
          "approval.expired",
          input.approvalId,
        ])}`,
        actorType: "system",
        actorId: "workflow",
        entityType: "approval",
        entityId: input.approvalId,
        action: "approval.expired",
        metadata: {
          ticket_id: input.ticketId,
          expired_at: input.expiredAt.toISOString(),
        },
        correlationId: input.correlationId,
      });

      return { expired: true, status: "expired" };
    },

    async createApproval(input) {
      const key = `${input.tenantId}:${input.approvalId}`;
      const existing = approvals.get(key);

      if (existing) {
        return { approval: existing, created: false };
      }

      const approval = {
        tenantId: input.tenantId,
        approvalId: input.approvalId,
        ticketId: input.ticketId,
        aiRunId: input.aiRunId,
        status: "pending" as const,
        requestedPayload: input.requestedPayload,
        approvedPayload: null,
        reviewerUserId: null,
      };
      approvals.set(key, approval);

      return { approval, created: true };
    },

    async getOutboundSendContext(params) {
      const conversation = conversations.find(
        (candidate) =>
          candidate.tenantId === params.tenantId &&
          candidate.conversationId === params.conversationId,
      );

      if (!conversation) {
        return null;
      }

      const channel = channels.find(
        (candidate) =>
          candidate.tenantId === params.tenantId &&
          candidate.channelId === conversation.channelId,
      );

      if (!channel) {
        return null;
      }

      const identity = identities.find(
        (candidate) =>
          candidate.tenantId === params.tenantId &&
          candidate.customerId === conversation.customerId &&
          candidate.channel === channel.type,
      );
      const approval =
        approvals.get(`${params.tenantId}:${params.approvalId}`) ?? null;

      return {
        conversation: {
          conversationId: conversation.conversationId,
          channelId: conversation.channelId,
          customerId: conversation.customerId,
          externalThreadId: conversation.externalThreadId,
        },
        channel: {
          channelId: channel.channelId,
          type: channel.type,
          provider: channel.provider,
          config: channel.config,
        },
        recipient: identity
          ? {
              identityType: identity.identityType,
              identityValue: identity.identityValue,
              displayName: identity.displayName ?? null,
            }
          : null,
        approval,
      };
    },

    async findMessageByIdempotencyKey(params) {
      return messageByKey(params.tenantId, params.idempotencyKey);
    },

    async createOutboundMessage(input) {
      const conflicting = messageByKey(input.tenantId, input.idempotencyKey);

      if (conflicting) {
        return conflicting;
      }

      const record = {
        tenantId: input.tenantId,
        messageId: input.messageId,
        conversationId: input.conversationId,
        ticketId: input.ticketId,
        channelId: input.channelId,
        bodyText: input.bodyText,
        approvalId: input.approvalId,
        idempotencyKey: input.idempotencyKey,
        sendStatus: "queued",
        providerMessageId: null,
        sentAt: null,
      };
      messages.set(`${input.tenantId}:${input.messageId}`, record);

      return record;
    },

    async recordSendResult(input) {
      const key = `${input.tenantId}:${input.messageId}`;
      const record = messages.get(key);

      if (!record) {
        throw new Error(
          `Outbound message ${input.messageId} was not found while recording the send result.`,
        );
      }

      const updated = {
        ...record,
        sendStatus: input.sendStatus,
        providerMessageId: input.providerMessageId,
        sentAt: input.sentAt,
      };
      messages.set(key, updated);

      return updated;
    },

    async appendAuditEvent(input) {
      const key = `${input.tenantId}:${input.auditEventId}`;

      if (!auditEvents.has(key)) {
        auditEvents.set(key, input);
      }
    },

    async recordAiRunResult(input) {
      const key = `${input.tenantId}:${input.aiRunId}`;

      if (aiRuns.has(key)) {
        return { aiRunId: input.aiRunId, created: false, persisted: true };
      }

      aiRuns.set(key, input);

      return { aiRunId: input.aiRunId, created: true, persisted: true };
    },

    listApprovals() {
      return [...approvals.values()];
    },
    listMessages() {
      return [...messages.values()];
    },
    listAuditEvents() {
      return [...auditEvents.values()];
    },
    listAiRuns() {
      return [...aiRuns.values()];
    },
    listTickets() {
      return [...tickets.values()];
    },
    listTicketEvents() {
      return [...ticketEvents.values()];
    },
    listInboundMessages() {
      return [...inboundMessages.values()];
    },
    setApprovalDecision(params) {
      const key = `${params.tenantId}:${params.approvalId}`;
      const approval = approvals.get(key);

      if (!approval) {
        throw new Error(`Approval ${params.approvalId} is not seeded.`);
      }

      approvals.set(key, {
        ...approval,
        status: params.status,
        approvedPayload: params.approvedPayload,
        reviewerUserId: params.reviewerUserId,
      });
    },
  };
}

function replaySentResult(
  record: OutboundMessageRecord,
  now: () => Date,
): SendOutboundMessageActivityResult {
  return {
    status: "sent",
    message_id: record.messageId,
    conversation_id: record.conversationId,
    channel_id: record.channelId,
    external_message_id: record.providerMessageId,
    sent_at: (record.sentAt ?? now()).toISOString(),
  };
}

function mapApprovalRow(row: Approval): TicketLifecycleApprovalRecord {
  return {
    approvalId: row.approvalId,
    ticketId: row.ticketId,
    aiRunId: row.aiRunId,
    status: row.status,
    requestedPayload: row.requestedPayload,
    approvedPayload: row.approvedPayload,
    reviewerUserId: row.reviewerUserId,
  };
}

function mapMessageRow(row: Message): OutboundMessageRecord {
  return {
    messageId: row.messageId,
    conversationId: row.conversationId,
    channelId: row.channelId,
    sendStatus: row.sendStatus,
    providerMessageId: row.providerMessageId,
    sentAt: row.sentAt,
  };
}

function mapTicketRow(row: Ticket): TicketLifecycleTicketRecord {
  return {
    ticketId: row.ticketId,
    conversationId: row.conversationId,
    customerId: row.customerId,
    status: row.status,
    priority: row.priority,
    automationMode: row.automationMode,
    assignedQueue: row.assignedQueue,
    assignedUserId: row.assignedUserId,
    slaPolicyId: row.slaPolicyId,
    topic: row.topic,
    subtopic: row.subtopic,
    language: row.language,
    openedAt: row.openedAt,
    firstResponseDueAt: row.firstResponseDueAt,
    nextResponseDueAt: row.nextResponseDueAt,
    resolutionDueAt: row.resolutionDueAt,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
  };
}

async function appendApprovalExpiredAudit(
  db: Parameters<typeof createAuditEventQuery>[0],
  scope: { readonly tenantId: string },
  input: ExpireApprovalRecordInput,
): Promise<void> {
  await createAuditEventQuery(db, scope, {
    auditEventId: `aud_${sha24([
      input.tenantId,
      "approval.expired",
      input.approvalId,
    ])}`,
    actorType: "system",
    actorId: "workflow",
    entityType: "approval",
    entityId: input.approvalId,
    action: "approval.expired",
    metadata: {
      ticket_id: input.ticketId,
      expired_at: input.expiredAt.toISOString(),
    },
    correlationId: input.correlationId,
  });
}

/**
 * The workflow's deterministic ticket id embeds its conversation
 * (`tkt_{conversation_id}`, established by intake in
 * `ticketIdForConversation`). Activities recover the conversation from it
 * instead of widening the workflow input contract.
 */
export function conversationIdFromTicketId(ticketId: string): string {
  if (!ticketId.startsWith("tkt_") || ticketId.length <= "tkt_".length) {
    throw new NonRetryableActivityError(
      `Ticket id "${ticketId}" does not follow the tkt_{conversation_id} convention.`,
    );
  }

  return ticketId.slice("tkt_".length);
}

export function ticketSnapshotFromRecord(
  record: TicketLifecycleTicketRecord,
): TicketLifecycleTicketSnapshot {
  return {
    ticket_id: record.ticketId,
    conversation_id: record.conversationId,
    customer_id: record.customerId,
    status: record.status,
    priority: record.priority,
    automation_mode: record.automationMode,
    assigned_queue: record.assignedQueue,
    assigned_user_id: record.assignedUserId,
    sla_policy_id: record.slaPolicyId,
    opened_at: record.openedAt.toISOString(),
    first_response_due_at: record.firstResponseDueAt?.toISOString() ?? null,
    next_response_due_at: record.nextResponseDueAt?.toISOString() ?? null,
    resolution_due_at: record.resolutionDueAt?.toISOString() ?? null,
  };
}

/**
 * SLA timers for the workflow, measured against the activity clock. A due
 * date already in the past yields a non-positive `timer_ms`, which the
 * workflow treats as immediately breached.
 */
export function buildSlaTimers(
  record: TicketLifecycleTicketRecord,
  now: Date,
): readonly TicketLifecycleSlaTimer[] {
  const timers: TicketLifecycleSlaTimer[] = [];
  const deadlines = [
    ["first_response", record.firstResponseDueAt],
    ["next_response", record.nextResponseDueAt],
    ["resolution", record.resolutionDueAt],
  ] as const;

  for (const [deadlineType, dueAt] of deadlines) {
    if (dueAt !== null) {
      timers.push({
        deadline_type: deadlineType,
        due_at: dueAt.toISOString(),
        timer_ms: dueAt.getTime() - now.getTime(),
      });
    }
  }

  return timers;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function readCredentialRef(config: JsonObject): string | null {
  const ref = config["send_credential_ref"];
  return typeof ref === "string" && ref.length > 0 ? ref : null;
}

function extractAiRunId(metadata: Record<string, unknown>): string | null {
  const aiGraph = metadata["ai_graph"];

  if (aiGraph && typeof aiGraph === "object") {
    const aiRunId = (aiGraph as Record<string, unknown>)["ai_run_id"];

    if (typeof aiRunId === "string" && aiRunId.length > 0) {
      return aiRunId;
    }
  }

  return null;
}

/**
 * Pull the human-facing reply text out of an approval payload. Supports the
 * shapes the platform produces: a top-level `draft_text` (human edits through
 * the approval edit endpoint), a plain-string `draft`, and the workflow's
 * `ai_graph.draft.draft_text` metadata from `runAiGraph`.
 */
function extractDraftText(payload: JsonObject | null): string | null {
  if (!payload) {
    return null;
  }

  const direct = payload["draft_text"];

  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
  }

  const draft = payload["draft"];

  if (typeof draft === "string" && draft.trim().length > 0) {
    return draft;
  }

  if (draft && typeof draft === "object") {
    const nested = (draft as Record<string, unknown>)["draft_text"];

    if (typeof nested === "string" && nested.trim().length > 0) {
      return nested;
    }
  }

  const aiGraph = payload["ai_graph"];

  if (aiGraph && typeof aiGraph === "object") {
    return extractDraftText({
      draft: (aiGraph as Record<string, unknown>)["draft"],
    });
  }

  return null;
}

function sha24(parts: readonly (string | null)[]): string {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "").join("|"))
    .digest("hex")
    .slice(0, 24);
}

/**
 * Deterministic JSON encoding (sorted object keys) so retried audit writes
 * hash to the same audit event id regardless of key insertion order.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`,
      );
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}
