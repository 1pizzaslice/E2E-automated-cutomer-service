import {
  AiRuntimeRunRequestSchema,
  AiRuntimeRunResultSchema,
  type AiRuntimeRunRequest,
  type AiRuntimeRunResult,
} from "@support/shared-schemas";
import {
  getActiveTraceContext,
  type StructuredLogger,
} from "@support/observability";
import type { AutomationPolicyStore } from "../automation-policy.js";
import type {
  RunAiGraphActivityInput,
  RunAiGraphActivityResult,
  RunAiGraphFailedActivityResult,
} from "../workflows/ticket-lifecycle-types.js";
import type { AiGraphContextStore } from "./ai-graph-context.js";

/**
 * Production `runAiGraph` activity (Milestone 14): the AI decision is made by
 * the Python runtime sidecar over HTTP (`POST /internal/ai/run`, ADR-0020).
 * This activity builds the sidecar's `RuntimeRequest` from workflow input plus
 * database context (conversation messages, customer, tenant, and the tenant's
 * automation policy — the Milestone 12 bridge), calls the sidecar with an
 * explicit timeout, and classifies every failure.
 *
 * Error contract: this activity NEVER throws for sidecar problems. The
 * `createPersistedRunAiGraph` wrapper persists whatever result is returned,
 * and the workflow routes any `failed` result to human approval — so a
 * sidecar outage degrades to an audited failed AI run, never a failed
 * workflow. Transient transport errors and 5xx responses are retried
 * in-activity a bounded number of times before returning a structured
 * `retryable: true` failure; auth/contract problems return `retryable: false`
 * immediately. Only context/policy database errors propagate (plain `Error`)
 * so Temporal's activity retry policy handles them like every other
 * persistence activity.
 */

export const AI_SIDECAR_ERROR_CODES = {
  /** Transport failure or timeout after exhausting in-activity retries. */
  unavailable: "AI_SIDECAR_UNAVAILABLE",
  /** Sidecar answered 5xx after exhausting in-activity retries. */
  serverError: "AI_SIDECAR_ERROR",
  /** Sidecar rejected the bearer token (deployment misconfiguration). */
  unauthorized: "AI_SIDECAR_UNAUTHORIZED",
  /** Sidecar rejected the request as invalid (contract drift). */
  rejected: "AI_SIDECAR_REJECTED",
  /** Sidecar answered 200 with a body that does not match the contract. */
  contract: "AI_SIDECAR_CONTRACT_ERROR",
  /** Conversation context needed to build the request does not exist. */
  contextUnavailable: "AI_CONTEXT_UNAVAILABLE",
} as const;

export interface HttpRunAiGraphOptions {
  /** Sidecar base URL, e.g. `http://localhost:8090`. */
  readonly baseUrl: string;
  /**
   * Internal bearer token (already resolved from its env reference). `null`
   * sends no Authorization header; the sidecar answers 401 and the run fails
   * permanently, surfacing the misconfiguration while still routing to human.
   */
  readonly serviceToken: string | null;
  readonly policyStore: AutomationPolicyStore;
  readonly contextStore: AiGraphContextStore;
  /** Per-attempt request timeout. */
  readonly timeoutMs?: number;
  /** Total attempts for transient failures (transport errors and 5xx). */
  readonly maxAttempts?: number;
  /** Base delay between in-activity retries (doubles per attempt). */
  readonly retryDelayMs?: number;
  readonly maxToolCalls?: number;
  readonly maxRetrievedChunks?: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly logger?: StructuredLogger;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_TOOL_CALLS = 4;
const DEFAULT_MAX_RETRIEVED_CHUNKS = 8;

export function createHttpRunAiGraph(
  options: HttpRunAiGraphOptions,
): (input: RunAiGraphActivityInput) => Promise<RunAiGraphActivityResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const runUrl = `${options.baseUrl.replace(/\/+$/, "")}/internal/ai/run`;

  return async (input) => {
    // Database reads may throw plain errors: Temporal retries them like any
    // other persistence activity. Only sidecar failures use the structured
    // failed-result path.
    const [policy, context] = await Promise.all([
      options.policyStore.getActiveAutomationPolicy(input.tenant_id),
      options.contextStore.loadConversationContext({
        tenantId: input.tenant_id,
        conversationId: input.ticket.conversation_id,
      }),
    ]);

    if (
      !context ||
      !context.messages.some(
        (message) => message.role === "customer" && !message.is_internal,
      )
    ) {
      return failedResult(input, {
        errorCode: AI_SIDECAR_ERROR_CODES.contextUnavailable,
        errorMessage: context
          ? "Conversation has no customer-visible message to run the AI graph on."
          : "Conversation context was not found for this ticket.",
        retryable: false,
        reasonCodes: ["ai_context_unavailable", "route_to_human"],
        stage: "context_load",
      });
    }

    const requestCandidate: AiRuntimeRunRequest = {
      tenant_id: input.tenant_id,
      ticket_id: input.ticket_id,
      conversation_id: input.ticket.conversation_id,
      correlation_id: input.correlation_id,
      messages: [...context.messages],
      customer: context.customer,
      ...(context.tenant
        ? {
            tenant: {
              brand_name: context.tenant.brand_name,
              tone: "helpful_professional",
              timezone: context.tenant.timezone,
            },
          }
        : {}),
      policy: {
        auto_send_allowed_topics: [...policy.autoSendAllowedTopics],
        active_policy_version_ids: policy.policyVersionId
          ? [policy.policyVersionId]
          : [],
      },
      options: {
        allow_auto_send: policy.autoSendEnabled,
        max_tool_calls: options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
        max_retrieved_chunks:
          options.maxRetrievedChunks ?? DEFAULT_MAX_RETRIEVED_CHUNKS,
      },
      ai_run_type: "full_graph",
    };

    const parsedRequest = AiRuntimeRunRequestSchema.safeParse(requestCandidate);
    if (!parsedRequest.success) {
      // Building an invalid request is a programming/contract bug, not a
      // transient condition — fail the run, route to human, keep the workflow
      // alive.
      return failedResult(input, {
        errorCode: AI_SIDECAR_ERROR_CODES.contract,
        errorMessage: `runAiGraph request failed contract validation: ${parsedRequest.error.message}`,
        retryable: false,
        reasonCodes: ["ai_sidecar_contract_error", "route_to_human"],
        stage: "request_build",
      });
    }

    const traceId = getActiveTraceContext()?.trace_id ?? null;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-correlation-id": input.correlation_id,
      ...(traceId ? { "x-trace-id": traceId } : {}),
      ...(options.serviceToken
        ? { authorization: `Bearer ${options.serviceToken}` }
        : {}),
    };
    const body = JSON.stringify(parsedRequest.data);

    let lastTransient: { errorCode: string; errorMessage: string } | null =
      null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        await sleep(retryDelayMs * 2 ** (attempt - 2));
      }

      let response: Response;
      try {
        response = await fetchImpl(runUrl, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastTransient = {
          errorCode: AI_SIDECAR_ERROR_CODES.unavailable,
          errorMessage: `AI runtime sidecar is unreachable: ${describeError(error)}`,
        };
        warn(options.logger, input, attempt, lastTransient);
        continue;
      }

      if (response.status >= 500) {
        lastTransient = {
          errorCode: AI_SIDECAR_ERROR_CODES.serverError,
          errorMessage: `AI runtime sidecar answered HTTP ${response.status}.`,
        };
        warn(options.logger, input, attempt, lastTransient);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        return failedResult(input, {
          errorCode: AI_SIDECAR_ERROR_CODES.unauthorized,
          errorMessage: `AI runtime sidecar rejected the service token (HTTP ${response.status}).`,
          retryable: false,
          reasonCodes: ["ai_sidecar_unauthorized", "route_to_human"],
          stage: "sidecar_auth",
        });
      }

      if (!response.ok) {
        return failedResult(input, {
          errorCode: AI_SIDECAR_ERROR_CODES.rejected,
          errorMessage: `AI runtime sidecar rejected the request (HTTP ${response.status}).`,
          retryable: false,
          reasonCodes: ["ai_sidecar_rejected", "route_to_human"],
          stage: "sidecar_request",
        });
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        return failedResult(input, {
          errorCode: AI_SIDECAR_ERROR_CODES.contract,
          errorMessage: `AI runtime sidecar returned a non-JSON body: ${describeError(error)}`,
          retryable: false,
          reasonCodes: ["ai_sidecar_contract_error", "route_to_human"],
          stage: "sidecar_response",
        });
      }

      const parsedResult = AiRuntimeRunResultSchema.safeParse(payload);
      if (!parsedResult.success) {
        return failedResult(input, {
          errorCode: AI_SIDECAR_ERROR_CODES.contract,
          errorMessage: `AI runtime sidecar response failed contract validation: ${parsedResult.error.message}`,
          retryable: false,
          reasonCodes: ["ai_sidecar_contract_error", "route_to_human"],
          stage: "sidecar_response",
        });
      }

      return mapRuntimeResult(input, parsedResult.data, traceId);
    }

    return failedResult(input, {
      errorCode: lastTransient?.errorCode ?? AI_SIDECAR_ERROR_CODES.unavailable,
      errorMessage:
        lastTransient?.errorMessage ??
        "AI runtime sidecar is unreachable (no attempt recorded).",
      retryable: true,
      reasonCodes: ["ai_sidecar_unavailable", "route_to_human"],
      stage: "sidecar_transport",
      attempts: maxAttempts,
    });
  };
}

/**
 * Maps the sidecar's wire result to the Temporal activity contract. The shapes
 * already mirror each other (the Python runtime was written against this
 * boundary); the two deliberate differences are documented here:
 * `routing_decision.priority` keeps the workflow-owned ticket priority (the
 * runtime's own `p1`-`p4` vocabulary stays inside `classification`), and
 * `approval_package` is not part of the activity contract (the workflow builds
 * approval metadata itself) so it is dropped.
 */
function mapRuntimeResult(
  input: RunAiGraphActivityInput,
  result: AiRuntimeRunResult,
  activityTraceId: string | null,
): RunAiGraphActivityResult {
  if (result.status === "failed") {
    return {
      status: "failed",
      ai_run_id: result.ai_run_id,
      trace_id: result.trace_id ?? activityTraceId,
      error_code: result.error_code,
      error_message: result.error_message,
      retryable: result.retryable,
      reason_codes: result.reason_codes,
      eval_signals: result.eval_signals,
    };
  }

  return {
    status: "succeeded",
    ai_run_id: result.ai_run_id,
    trace_id: result.trace_id ?? activityTraceId,
    classification: result.classification,
    routing_decision: {
      topic: result.routing_decision.topic,
      subtopic: result.routing_decision.subtopic,
      language: result.routing_decision.language,
      sentiment: result.routing_decision.sentiment,
      urgency: result.routing_decision.urgency,
      priority: input.ticket.priority,
      risk_level: result.routing_decision.risk_level,
      confidence: result.routing_decision.confidence,
      automation_mode: result.routing_decision.automation_mode,
      assigned_queue:
        result.routing_decision.assigned_queue ?? input.ticket.assigned_queue,
      reason_codes: result.routing_decision.reason_codes,
      required_tools: result.routing_decision.required_tools,
      required_evidence: result.routing_decision.required_evidence,
    },
    tool_calls: result.tool_calls,
    draft: result.draft,
    guardrails: result.guardrails,
    final_recommendation: result.final_recommendation,
    eval_signals: result.eval_signals,
  };
}

function failedResult(
  input: RunAiGraphActivityInput,
  failure: {
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    reasonCodes: readonly string[];
    stage: string;
    attempts?: number;
  },
): RunAiGraphFailedActivityResult {
  return {
    status: "failed",
    ai_run_id: null,
    trace_id: getActiveTraceContext()?.trace_id ?? null,
    error_code: failure.errorCode,
    error_message: failure.errorMessage,
    retryable: failure.retryable,
    reason_codes: failure.reasonCodes,
    eval_signals: {
      stage: failure.stage,
      correlation_id: input.correlation_id,
      ...(failure.attempts !== undefined ? { attempts: failure.attempts } : {}),
    },
  };
}

function warn(
  logger: StructuredLogger | undefined,
  input: RunAiGraphActivityInput,
  attempt: number,
  failure: { errorCode: string; errorMessage: string },
): void {
  logger?.warn("ai sidecar attempt failed", {
    tenant_id: input.tenant_id,
    ticket_id: input.ticket_id,
    correlation_id: input.correlation_id,
    attempt,
    error_code: failure.errorCode,
    error_message: failure.errorMessage,
  });
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError" ? "request timed out" : error.message;
  }

  return String(error);
}
