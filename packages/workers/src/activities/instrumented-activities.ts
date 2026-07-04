import {
  createNoopSupportMetrics,
  SUPPORT_ATTR,
  withSpan,
  type StructuredLogger,
  type SupportCriticalFailureMode,
  type SupportMetrics,
} from "@support/observability";
import type { TicketLifecycleActivities } from "./ticket-lifecycle-activities.js";

export interface InstrumentTicketLifecycleActivitiesOptions {
  readonly metrics?: SupportMetrics;
  readonly logger?: StructuredLogger;
  readonly now?: () => Date;
}

type ActivityName = keyof TicketLifecycleActivities;

/**
 * Wraps every ticket lifecycle activity with a span, workflow-activity
 * metrics, and structured logs carrying the correlation ids
 * (DEVELOPMENT_RULES §13/§14: every workflow step is traced and measured).
 * Critical failure modes are mapped from the domain outcome:
 *
 * - `runAiGraph` returning `status: "failed"` -> `ai_graph_failed`
 * - `sendOutboundMessage` throwing               -> `outbound_send_failed`
 * - `emitDomainEvent` for an SLA breach          -> `sla_breached`
 *
 * The wrapper never swallows errors: activity failures propagate unchanged
 * so Temporal retry semantics are untouched.
 */
export function instrumentTicketLifecycleActivities(
  activities: TicketLifecycleActivities,
  options: InstrumentTicketLifecycleActivitiesOptions = {},
): TicketLifecycleActivities {
  const metrics = options.metrics ?? createNoopSupportMetrics();
  const logger = options.logger;
  const now = options.now ?? (() => new Date());

  function wrap<Name extends ActivityName>(
    name: Name,
  ): TicketLifecycleActivities[Name] {
    const activity = activities[name].bind(activities) as (
      input: unknown,
    ) => Promise<unknown>;

    const wrapped = async (input: unknown): Promise<unknown> => {
      const attributes = readCorrelationAttributes(input);
      const startedAtMs = now().getTime();

      return withSpan(
        `activity.${name}`,
        { [SUPPORT_ATTR.activity]: name, ...attributes },
        async (span) => {
          try {
            const result = await activity(input);
            const durationMs = Math.max(0, now().getTime() - startedAtMs);

            metrics.recordWorkflowActivity({
              activity: name,
              outcome: "succeeded",
              durationMs,
            });
            span.setAttribute(SUPPORT_ATTR.outcome, "succeeded");

            const domainFailure = detectDomainFailure(name, input, result);
            if (domainFailure) {
              metrics.recordCriticalFailure(domainFailure);
              span.setAttribute(SUPPORT_ATTR.failureMode, domainFailure);
              logger?.warn(`activity ${name} reported a domain failure`, {
                activity: name,
                failure_mode: domainFailure,
                ...attributes,
              });
            } else {
              logger?.info(`activity ${name} completed`, {
                activity: name,
                duration_ms: durationMs,
                ...attributes,
              });
            }

            return result;
          } catch (error) {
            const durationMs = Math.max(0, now().getTime() - startedAtMs);

            metrics.recordWorkflowActivity({
              activity: name,
              outcome: "failed",
              durationMs,
            });
            span.setAttribute(SUPPORT_ATTR.outcome, "failed");

            if (name === "sendOutboundMessage") {
              metrics.recordCriticalFailure("outbound_send_failed");
              span.setAttribute(
                SUPPORT_ATTR.failureMode,
                "outbound_send_failed",
              );
            }

            logger?.error(`activity ${name} failed`, {
              activity: name,
              duration_ms: durationMs,
              error_message:
                error instanceof Error ? error.message : String(error),
              ...attributes,
            });

            throw error;
          }
        },
      );
    };

    return wrapped as TicketLifecycleActivities[Name];
  }

  return {
    createOrUpdateTicket: wrap("createOrUpdateTicket"),
    runInitialTriage: wrap("runInitialTriage"),
    runAiGraph: wrap("runAiGraph"),
    createApproval: wrap("createApproval"),
    sendOutboundMessage: wrap("sendOutboundMessage"),
    recordInboundMessage: wrap("recordInboundMessage"),
    recordAuditEvent: wrap("recordAuditEvent"),
    emitDomainEvent: wrap("emitDomainEvent"),
  };
}

/**
 * Pull the standard correlation ids off any activity input (they all carry
 * `tenant_id`; most carry `ticket_id`/`correlation_id`).
 */
function readCorrelationAttributes(input: unknown): Record<string, string> {
  if (input === null || typeof input !== "object") {
    return {};
  }

  const record = input as Record<string, unknown>;
  const attributes: Record<string, string> = {};

  if (typeof record.tenant_id === "string") {
    attributes[SUPPORT_ATTR.tenantId] = record.tenant_id;
  }
  if (typeof record.ticket_id === "string") {
    attributes[SUPPORT_ATTR.ticketId] = record.ticket_id;
  }
  if (typeof record.correlation_id === "string") {
    attributes[SUPPORT_ATTR.correlationId] = record.correlation_id;
  }

  return attributes;
}

function detectDomainFailure(
  name: ActivityName,
  input: unknown,
  result: unknown,
): SupportCriticalFailureMode | null {
  if (
    name === "runAiGraph" &&
    result !== null &&
    typeof result === "object" &&
    (result as Record<string, unknown>).status === "failed"
  ) {
    return "ai_graph_failed";
  }

  if (
    name === "emitDomainEvent" &&
    input !== null &&
    typeof input === "object" &&
    (input as Record<string, unknown>).event_type === "ticket_sla_breached"
  ) {
    return "sla_breached";
  }

  return null;
}
