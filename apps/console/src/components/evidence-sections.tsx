import type { ReactNode } from "react";
import type {
  AiRunResponse,
  MessageResponse,
  ToolCallResponse,
} from "@support/shared-schemas";
import { loadConsoleConfig } from "../config.js";
import { formatDateTime } from "../lib/format.js";
import { JsonBlock } from "./json-block.js";

/** A titled panel — the console's basic content container. */
export function Card({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** The customer conversation thread (shared by approval + QA evidence). */
export function ConversationCard({
  channelId,
  openedAt,
  messages,
}: {
  readonly channelId: string;
  readonly openedAt: string;
  readonly messages: readonly MessageResponse[];
}) {
  return (
    <Card title="Conversation">
      <p className="muted">
        {channelId} · opened {formatDateTime(openedAt)}
      </p>
      <ol className="thread">
        {messages.map((message) => (
          <li key={message.message_id} className={`msg ${message.direction}`}>
            <div className="msg-meta">
              <span>{message.created_by_type}</span>
              <span>{message.direction}</span>
              <span>{formatDateTime(message.created_at)}</span>
            </div>
            <div className="msg-body">
              {message.body_text ?? <em>(no text body)</em>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** The AI run's provenance, guardrails, and trace link. Callers gate this on
 * `ai_runs:read` before rendering. */
export function AiRunCard({ aiRun }: { readonly aiRun: AiRunResponse | null }) {
  if (!aiRun) {
    return (
      <Card title="AI run">
        <p className="muted">No AI run is linked to this item.</p>
      </Card>
    );
  }

  const traceTemplate = loadConsoleConfig().traceUrlTemplate;

  return (
    <Card title="AI run">
      <dl className="kv">
        <dt>Model</dt>
        <dd>
          {aiRun.model_provider}/{aiRun.model_id}
        </dd>
        <dt>Type</dt>
        <dd>{aiRun.run_type}</dd>
        <dt>Status</dt>
        <dd>{aiRun.status}</dd>
        {aiRun.confidence !== null ? (
          <>
            <dt>Confidence</dt>
            <dd>{aiRun.confidence.toFixed(2)}</dd>
          </>
        ) : null}
        {aiRun.risk_level !== null ? (
          <>
            <dt>Risk</dt>
            <dd>{aiRun.risk_level}</dd>
          </>
        ) : null}
        {aiRun.automation_recommendation !== null ? (
          <>
            <dt>Recommendation</dt>
            <dd>{aiRun.automation_recommendation}</dd>
          </>
        ) : null}
        {aiRun.trace_id !== null ? (
          <>
            <dt>Trace</dt>
            <dd>
              {traceTemplate ? (
                <a
                  href={traceTemplate.replace("{trace_id}", aiRun.trace_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="mono"
                >
                  {aiRun.trace_id}
                </a>
              ) : (
                <span className="mono">{aiRun.trace_id}</span>
              )}
            </dd>
          </>
        ) : null}
      </dl>

      <details>
        <summary>Retrieved context &amp; citations</summary>
        <JsonBlock value={aiRun.retrieved_context_refs} />
      </details>
      <details>
        <summary>Guardrail results</summary>
        <JsonBlock value={aiRun.guardrail_results} />
      </details>
    </Card>
  );
}

/** The tools the AI invoked during the run. */
export function ToolCallsCard({
  toolCalls,
}: {
  readonly toolCalls: readonly ToolCallResponse[];
}) {
  return (
    <Card title={`Tool calls (${toolCalls.length})`}>
      {toolCalls.length === 0 ? (
        <p className="muted">No tools were called.</p>
      ) : (
        <ul className="tool-calls">
          {toolCalls.map((call) => (
            <li key={call.tool_call_id}>
              <div className="tool-head">
                <span className="mono">{call.tool_definition_id}</span>
                <span className={`badge status-${call.status}`}>
                  {call.status}
                </span>
                <span className="badge">{call.side_effect_class}</span>
              </div>
              {call.error_message ? (
                <p className="error">{call.error_message}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
