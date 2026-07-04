import {
  emitAiRunCompletedEvent,
  emitMessageSentEvent,
  emitTicketCreatedEvent,
  emitTicketSlaBreachedEvent,
  emitTicketStateTransitionEvent,
  emitToolCallCompletedEvent,
} from "../domain-events.js";
import type { DomainEventPublisher } from "../event-publisher.js";
import type {
  ApplyTicketStateTransitionActivityInput,
  ApplyTicketStateTransitionActivityResult,
  CreateApprovalActivityInput,
  CreateApprovalActivityResult,
  CreateOrUpdateTicketActivityInput,
  CreateOrUpdateTicketActivityResult,
  EmitTicketLifecycleDomainEventActivityInput,
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
} from "../workflows/ticket-lifecycle-types.js";

export interface TicketLifecycleActivities {
  createOrUpdateTicket(
    input: CreateOrUpdateTicketActivityInput,
  ): Promise<CreateOrUpdateTicketActivityResult>;
  runInitialTriage(
    input: RunInitialTriageActivityInput,
  ): Promise<RunInitialTriageActivityResult>;
  runAiGraph(input: RunAiGraphActivityInput): Promise<RunAiGraphActivityResult>;
  createApproval(
    input: CreateApprovalActivityInput,
  ): Promise<CreateApprovalActivityResult>;
  sendOutboundMessage(
    input: SendOutboundMessageActivityInput,
  ): Promise<SendOutboundMessageActivityResult>;
  recordInboundMessage(input: RecordInboundMessageActivityInput): Promise<void>;
  applyTicketStateTransition(
    input: ApplyTicketStateTransitionActivityInput,
  ): Promise<ApplyTicketStateTransitionActivityResult>;
  expireApproval(
    input: ExpireApprovalActivityInput,
  ): Promise<ExpireApprovalActivityResult>;
  recordAuditEvent(input: RecordAuditEventActivityInput): Promise<void>;
  emitDomainEvent(
    input: EmitTicketLifecycleDomainEventActivityInput,
  ): Promise<void>;
}

export interface TicketLifecycleActivityDependencies {
  readonly domainEventPublisher: DomainEventPublisher;
  readonly now?: () => Date;
  readonly implementations: Omit<TicketLifecycleActivities, "emitDomainEvent">;
}

export function createTicketLifecycleActivities(
  dependencies: TicketLifecycleActivityDependencies,
): TicketLifecycleActivities {
  const now = dependencies.now ?? (() => new Date());

  return {
    ...dependencies.implementations,
    async emitDomainEvent(input) {
      const occurredAt = now().toISOString();

      if (input.event_type === "ticket_created") {
        await emitTicketCreatedEvent(dependencies.domainEventPublisher, {
          event_id: input.event_id,
          tenant_id: input.tenant_id,
          correlation_id: input.correlation_id,
          causation_id: input.causation_id,
          occurred_at: occurredAt,
          actor: input.actor,
          payload: {
            ticket_id: input.ticket.ticket_id,
            conversation_id: input.ticket.conversation_id,
            customer_id: input.ticket.customer_id,
            status: "new",
            priority: input.ticket.priority,
            automation_mode: input.ticket.automation_mode,
            assigned_queue: input.ticket.assigned_queue,
            assigned_user_id: input.ticket.assigned_user_id,
            opened_at: input.ticket.opened_at,
          },
        });
        return;
      }

      if (input.event_type === "ticket_sla_breached") {
        await emitTicketSlaBreachedEvent(dependencies.domainEventPublisher, {
          event_id: input.event_id,
          tenant_id: input.tenant_id,
          correlation_id: input.correlation_id,
          causation_id: input.causation_id,
          occurred_at: occurredAt,
          actor: input.actor,
          payload: {
            ticket_id: input.ticket_id,
            breached_deadline: input.breached_deadline,
            due_at: input.due_at,
            metadata: input.metadata,
          },
        });
        return;
      }

      if (input.event_type === "message_sent") {
        await emitMessageSentEvent(dependencies.domainEventPublisher, {
          event_id: input.event_id,
          tenant_id: input.tenant_id,
          correlation_id: input.correlation_id,
          causation_id: input.causation_id,
          occurred_at: occurredAt,
          actor: input.actor,
          payload: {
            message_id: input.message_id,
            conversation_id: input.conversation_id,
            ticket_id: input.ticket_id,
            channel_id: input.channel_id,
            sent_at: input.sent_at,
          },
        });
        return;
      }

      if (input.event_type === "ai_run_completed") {
        await emitAiRunCompletedEvent(dependencies.domainEventPublisher, {
          event_id: input.event_id,
          tenant_id: input.tenant_id,
          correlation_id: input.correlation_id,
          causation_id: input.causation_id,
          occurred_at: occurredAt,
          actor: input.actor,
          payload: {
            ai_run_id: input.ai_run_id,
            ticket_id: input.ticket_id,
            status: input.status,
            metadata: input.metadata,
          },
        });
        return;
      }

      if (input.event_type === "tool_call_completed") {
        await emitToolCallCompletedEvent(dependencies.domainEventPublisher, {
          event_id: input.event_id,
          tenant_id: input.tenant_id,
          correlation_id: input.correlation_id,
          causation_id: input.causation_id,
          occurred_at: occurredAt,
          actor: input.actor,
          payload: {
            tool_call_id: input.tool_call_id,
            ticket_id: input.ticket_id,
            tool_name: input.tool_name,
            status: input.status,
            metadata: input.metadata,
          },
        });
        return;
      }

      await emitTicketStateTransitionEvent(dependencies.domainEventPublisher, {
        event_id: input.event_id,
        tenant_id: input.tenant_id,
        correlation_id: input.correlation_id,
        causation_id: input.causation_id,
        occurred_at: occurredAt,
        actor: input.actor,
        event_name: input.event_name,
        payload: {
          ticket_id: input.ticket_id,
          from_status: input.from_status,
          to_status: input.to_status,
          reason_code: input.reason_code,
          metadata: input.metadata,
        },
      });
    },
  };
}
