import type {
  AutomationMode,
  DomainEventActor,
  TicketPriority,
  TicketStateTransitionEventName,
  TicketStatus,
} from "@support/shared-schemas";

export const TICKET_LIFECYCLE_TASK_QUEUE = "support-ticket-lifecycle";
export const TICKET_LIFECYCLE_WORKFLOW_TYPE = "ticketLifecycleWorkflow";

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
  | "waiting_for_approval"
  | "manual_escalated"
  | "closed"
  | "completed";

export interface TicketLifecycleTicketSnapshot {
  readonly ticket_id: string;
  readonly conversation_id: string;
  readonly customer_id: string;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly automation_mode: AutomationMode;
  readonly assigned_queue: string | null;
  readonly assigned_user_id: string | null;
  readonly opened_at: string;
}

export interface CreateOrUpdateTicketActivityInput extends TicketLifecycleWorkflowInput {}

export interface CreateOrUpdateTicketActivityResult {
  readonly ticket: TicketLifecycleTicketSnapshot;
  readonly created: boolean;
  readonly previous_status: TicketStatus | null;
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
}

export interface RecordInboundMessageActivityInput extends TicketLifecycleWorkflowInput {
  readonly message: TicketLifecycleMessageReceivedSignal;
}

export interface RecordAuditEventActivityInput {
  readonly tenant_id: string;
  readonly ticket_id: string;
  readonly correlation_id: string;
  readonly action: string;
  readonly actor: DomainEventActor;
  readonly metadata: Record<string, unknown>;
}

export type EmitTicketLifecycleDomainEventActivityInput =
  | EmitTicketCreatedDomainEventInput
  | EmitTicketStateTransitionDomainEventInput;

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
}

export interface TicketLifecycleWorkflowState extends TicketLifecycleWorkflowResult {
  readonly triage_route: RunInitialTriageActivityResult["route"] | null;
}
