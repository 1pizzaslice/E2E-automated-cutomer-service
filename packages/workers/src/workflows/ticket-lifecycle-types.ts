import type {
  AutomationMode,
  DomainEventActor,
  SupportAuditAction,
  TicketPriority,
  TicketStateTransitionEventName,
  TicketStatus,
} from "@support/shared-schemas";

export const TICKET_LIFECYCLE_TASK_QUEUE = "support-ticket-lifecycle";
export const TICKET_LIFECYCLE_WORKFLOW_TYPE = "ticketLifecycleWorkflow";
export const TICKET_LIFECYCLE_DEFAULT_ACTIVITY_RETRY_POLICY = {
  initialInterval: "1 second",
  backoffCoefficient: 2,
  maximumInterval: "30 seconds",
  maximumAttempts: 3,
  nonRetryableErrorTypes: [
    "ValidationError",
    "NonRetryableActivityError",
    "TenantAccessDenied",
  ],
};
export const TICKET_LIFECYCLE_SIDE_EFFECT_ACTIVITY_RETRY_POLICY = {
  initialInterval: "1 second",
  backoffCoefficient: 2,
  maximumInterval: "1 minute",
  maximumAttempts: 5,
  nonRetryableErrorTypes: [
    "ValidationError",
    "NonRetryableActivityError",
    "TenantAccessDenied",
  ],
};

export interface TicketLifecycleWorkflowInput {
  readonly tenant_id: string;
  readonly ticket_id: string;
  readonly initial_message_id: string;
  readonly correlation_id: string;
}

export interface TicketLifecycleMessageReceivedSignal {
  readonly message_id: string;
  readonly conversation_id: string;
  readonly channel_id: string;
  readonly received_at: string;
  readonly external_message_id: string | null;
  readonly external_thread_id: string | null;
  readonly idempotency_key: string | null;
}

export interface TicketLifecycleApprovalCompletedSignal {
  readonly approval_id: string;
  readonly status: "approved" | "rejected" | "edited" | "escalated";
  readonly actor_id: string;
  readonly decided_at: string;
  readonly notes: string | null;
}

export interface TicketLifecycleManualEscalationSignal {
  readonly requested_by_actor_id: string;
  readonly reason_code: string;
  readonly requested_at: string;
}

export interface TicketLifecycleCloseRequestedSignal {
  readonly requested_by_actor_id: string;
  readonly reason_code: string;
  readonly requested_at: string;
}

export type TicketLifecycleWorkflowPhase =
  | "starting"
  | "creating_ticket"
  | "triaging"
  | "running_ai"
  | "waiting_for_approval"
  | "sla_breached"
  | "sending_response"
  | "responded"
  | "manual_escalated"
  | "approval_expired"
  | "closed"
  | "completed";

export type TicketLifecycleSlaDeadline =
  | "first_response"
  | "next_response"
  | "resolution";

export interface TicketLifecycleTicketSnapshot {
  readonly ticket_id: string;
  readonly conversation_id: string;
  readonly customer_id: string;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly automation_mode: AutomationMode;
  readonly assigned_queue: string | null;
  readonly assigned_user_id: string | null;
  readonly sla_policy_id: string | null;
  readonly opened_at: string;
  readonly first_response_due_at: string | null;
  readonly next_response_due_at: string | null;
  readonly resolution_due_at: string | null;
}

export interface TicketLifecycleSlaTimer {
  readonly deadline_type: TicketLifecycleSlaDeadline;
  readonly due_at: string;
  readonly timer_ms: number;
}

export interface CreateOrUpdateTicketActivityInput extends TicketLifecycleWorkflowInput {}

export interface CreateOrUpdateTicketActivityResult {
  readonly ticket: TicketLifecycleTicketSnapshot;
  readonly created: boolean;
  readonly previous_status: TicketStatus | null;
  readonly sla_timers: readonly TicketLifecycleSlaTimer[];
}

export interface RunInitialTriageActivityInput {
  readonly tenant_id: string;
  readonly ticket_id: string;
  readonly initial_message_id: string;
  readonly correlation_id: string;
  readonly ticket: TicketLifecycleTicketSnapshot;
}

export interface RunInitialTriageActivityResult {
  readonly status: "triaged";
  readonly route: "human_approval" | "manual_escalation";
  readonly reason_code: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface RunAiGraphActivityInput {
  readonly tenant_id: string;
  readonly ticket_id: string;
  readonly initial_message_id: string;
  readonly correlation_id: string;
  readonly ticket: TicketLifecycleTicketSnapshot;
  readonly triage: RunInitialTriageActivityResult;
}

export type TicketLifecycleAiRiskLevel = "low" | "medium" | "high";

export interface TicketLifecycleAiRoutingDecision {
  readonly topic: string | null;
  readonly subtopic: string | null;
  readonly language: string | null;
  readonly sentiment: string | null;
  readonly urgency: string | null;
  readonly priority: TicketPriority;
  readonly risk_level: TicketLifecycleAiRiskLevel;
  readonly confidence: number;
  readonly automation_mode: AutomationMode;
  readonly assigned_queue: string | null;
  readonly reason_codes: readonly string[];
  readonly required_tools: readonly string[];
  readonly required_evidence: readonly string[];
}

export interface TicketLifecycleAiDraftEvidence {
  readonly type: string;
  readonly ref_id: string;
  readonly summary: string;
}

export interface TicketLifecycleAiDraft {
  readonly draft_text: string;
  readonly customer_language: string;
  readonly tone: string;
  readonly evidence: readonly TicketLifecycleAiDraftEvidence[];
  readonly actions: readonly Record<string, unknown>[];
  readonly risk_level: TicketLifecycleAiRiskLevel;
  readonly confidence: number;
  readonly needs_human: boolean;
  readonly human_review_reasons: readonly string[];
}

export interface TicketLifecycleAiFinalRecommendation {
  readonly automation_mode: AutomationMode;
  readonly risk_level: TicketLifecycleAiRiskLevel;
  readonly confidence: number;
  readonly reason_codes: readonly string[];
}

export type RunAiGraphActivityResult =
  | RunAiGraphSucceededActivityResult
  | RunAiGraphFailedActivityResult;

export interface RunAiGraphSucceededActivityResult {
  readonly status: "succeeded";
  readonly ai_run_id: string;
  readonly trace_id: string | null;
  readonly classification: Record<string, unknown>;
  readonly routing_decision: TicketLifecycleAiRoutingDecision;
  readonly tool_calls: readonly Record<string, unknown>[];
  readonly draft: TicketLifecycleAiDraft | null;
  readonly guardrails: Record<string, unknown>;
  readonly final_recommendation: TicketLifecycleAiFinalRecommendation;
  readonly eval_signals: Record<string, unknown>;
}

export interface RunAiGraphFailedActivityResult {
  readonly status: "failed";
  readonly ai_run_id: string | null;
  readonly trace_id: string | null;
  readonly error_code: string;
  readonly error_message: string;
  readonly retryable: boolean;
  readonly reason_codes: readonly string[];
  readonly eval_signals: Record<string, unknown>;
}

export interface CreateApprovalActivityInput {
  readonly tenant_id: string;
  readonly ticket_id: string;
  readonly correlation_id: string;
  readonly reason_code: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface CreateApprovalActivityResult {
  readonly approval_id: string;
  readonly status: "pending";
  /**
   * How long the workflow should wait for a reviewer decision before the
   * approval expires (BACKEND_SPEC section 12). Resolved activity-side from
   * worker configuration so the value is recorded in workflow history and
   * replays deterministically. `null` disables the expiry timer.
   */
  readonly expires_in_ms: number | null;
}

export type TicketLifecycleOutboundApprovalStatus = "approved" | "edited";

export interface SendOutboundMessageActivityInput {
  readonly tenant_id: string;
  readonly ticket_id: string;
  readonly conversation_id: string;
  readonly correlation_id: string;
  readonly approval_id: string;
  readonly approval_status: TicketLifecycleOutboundApprovalStatus;
  readonly idempotency_key: string;
}

export interface SendOutboundMessageActivityResult {
  readonly status: "sent";
  readonly message_id: string;
  readonly conversation_id: string;
  readonly channel_id: string;
  readonly external_message_id: string | null;
  readonly sent_at: string;
}

export interface RecordInboundMessageActivityInput extends TicketLifecycleWorkflowInput {
  readonly message: TicketLifecycleMessageReceivedSignal;
}

/**
 * Persist one workflow-owned ticket status transition (BACKEND_SPEC section
 * 6.2). The store reads the current status as `from_status` (the workflow
 * owns sequencing, the row owns truth), writes the ticket event and audit
 * event, and no-ops when the ticket is already in `to_status` so Temporal
 * retries replay instead of duplicating.
 */
export interface ApplyTicketStateTransitionActivityInput {
  readonly tenant_id: string;
  readonly ticket_id: string;
  readonly correlation_id: string;
  readonly to_status: TicketStatus;
  readonly reason_code: string | null;
  readonly metadata: Record<string, unknown>;
  readonly actor: DomainEventActor;
  /**
   * Stable per-transition-point key (e.g. "approval-requested"). Scopes the
   * deterministic ticket event / audit event ids so distinct transitions in
   * one workflow never collide while activity retries dedup.
   */
  readonly transition_key: string;
}

export interface ApplyTicketStateTransitionActivityResult {
  readonly applied: boolean;
  readonly from_status: TicketStatus;
  readonly to_status: TicketStatus;
}

export interface ExpireApprovalActivityInput {
  readonly tenant_id: string;
  readonly ticket_id: string;
  readonly correlation_id: string;
  readonly approval_id: string;
}

export interface ExpireApprovalActivityResult {
  /**
   * False when a reviewer decision won the race: the approval was no longer
   * pending, nothing changed, and `status` carries the decision that landed.
   */
  readonly expired: boolean;
  readonly status: string;
}

export interface RecordAuditEventActivityInput {
  readonly tenant_id: string;
  readonly ticket_id: string;
  readonly correlation_id: string;
  /**
   * Constrained to the canonical audit taxonomy so audit completeness is
   * checkable at compile time (BACKEND_SPEC section 13 rules).
   */
  readonly action: SupportAuditAction;
  readonly actor: DomainEventActor;
  readonly metadata: Record<string, unknown>;
}

export type EmitTicketLifecycleDomainEventActivityInput =
  | EmitTicketCreatedDomainEventInput
  | EmitTicketStateTransitionDomainEventInput
  | EmitTicketSlaBreachedDomainEventInput
  | EmitMessageSentDomainEventInput
  | EmitAiRunCompletedDomainEventInput
  | EmitToolCallCompletedDomainEventInput;

export interface EmitTicketCreatedDomainEventInput {
  readonly event_type: "ticket_created";
  readonly event_id: string;
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly actor: DomainEventActor;
  readonly ticket: TicketLifecycleTicketSnapshot;
}

export interface EmitTicketStateTransitionDomainEventInput {
  readonly event_type: "ticket_state_transition";
  readonly event_id: string;
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly actor: DomainEventActor;
  readonly event_name: TicketStateTransitionEventName;
  readonly ticket_id: string;
  readonly from_status: TicketStatus;
  readonly to_status: TicketStatus;
  readonly reason_code: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface EmitTicketSlaBreachedDomainEventInput {
  readonly event_type: "ticket_sla_breached";
  readonly event_id: string;
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly actor: DomainEventActor;
  readonly ticket_id: string;
  readonly breached_deadline: TicketLifecycleSlaDeadline;
  readonly due_at: string;
  readonly metadata: Record<string, unknown>;
}

export interface EmitMessageSentDomainEventInput {
  readonly event_type: "message_sent";
  readonly event_id: string;
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly actor: DomainEventActor;
  readonly message_id: string;
  readonly conversation_id: string;
  readonly ticket_id: string;
  readonly channel_id: string;
  readonly sent_at: string;
}

export interface EmitAiRunCompletedDomainEventInput {
  readonly event_type: "ai_run_completed";
  readonly event_id: string;
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly actor: DomainEventActor;
  readonly ai_run_id: string;
  readonly ticket_id: string;
  readonly status: string;
  readonly metadata: Record<string, unknown>;
}

export interface EmitToolCallCompletedDomainEventInput {
  readonly event_type: "tool_call_completed";
  readonly event_id: string;
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly actor: DomainEventActor;
  readonly tool_call_id: string;
  readonly ticket_id: string;
  readonly tool_name: string;
  readonly status: string;
  readonly metadata: Record<string, unknown>;
}

export interface TicketLifecycleWorkflowResult {
  readonly tenant_id: string;
  readonly ticket_id: string;
  readonly phase: TicketLifecycleWorkflowPhase;
  readonly processed_message_ids: readonly string[];
  readonly approval_id: string | null;
  readonly approval_status:
    | TicketLifecycleApprovalCompletedSignal["status"]
    | null;
  readonly manual_escalation_reason_code: string | null;
  readonly close_reason_code: string | null;
  readonly first_response_due_at: string | null;
  readonly sla_breached_deadline: TicketLifecycleSlaDeadline | null;
  readonly sla_breached_due_at: string | null;
  readonly ai_run_id: string | null;
  readonly ai_status: RunAiGraphActivityResult["status"] | null;
  readonly ai_automation_mode: AutomationMode | null;
  readonly ai_failure_code: string | null;
  readonly outbound_message_id: string | null;
}

export interface TicketLifecycleWorkflowState extends TicketLifecycleWorkflowResult {
  readonly triage_route: RunInitialTriageActivityResult["route"] | null;
}
