import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  AiRunResponse,
  ApprovalEvidenceResponse,
} from "@support/shared-schemas";
import { useApiClient, useIdentity } from "../auth/session-context.js";
import { DecidePanel } from "../components/decide-panel.js";
import { JsonBlock } from "../components/json-block.js";
import { loadConsoleConfig } from "../config.js";
import { draftField, formatDateTime } from "../lib/format.js";
import { PERMISSION, can } from "../lib/permissions.js";
import { useAsync } from "../lib/use-async.js";

/**
 * The reviewer evidence composite (Milestone 20 `GET /v1/approvals/{id}/
 * evidence`): the conversation, the AI's proposed reply, the AI run's provenance
 * and guardrails (gated by `ai_runs:read` — hidden from `client_viewer`), the
 * tool calls, and the decide actions. Everything renders from one composite
 * fetch so a reviewer sees the whole picture on one screen.
 */
export function EvidencePage() {
  const { approvalId = "" } = useParams();
  const client = useApiClient();
  const navigate = useNavigate();

  const evidence = useAsync(
    () => client.approvalEvidence(approvalId),
    [client, approvalId],
  );

  return (
    <section className="evidence">
      <p>
        <Link to="/approvals">← Back to queue</Link>
      </p>

      {evidence.loading && !evidence.data ? <p>Loading evidence…</p> : null}
      {evidence.error ? <p className="error">{evidence.error}</p> : null}

      {evidence.data ? (
        <EvidenceView
          evidence={evidence.data}
          onDecided={() => navigate("/approvals")}
        />
      ) : null}
    </section>
  );
}

function EvidenceView({
  evidence,
  onDecided,
}: {
  readonly evidence: ApprovalEvidenceResponse;
  readonly onDecided: () => void;
}) {
  const identity = useIdentity();
  const { ticket, conversation, messages, approval, tool_calls, ai_run } =
    evidence;
  const draft = draftField(
    approval.requested_payload as Record<string, unknown>,
  );

  return (
    <>
      <header className="page-head">
        <h1>
          Ticket <span className="mono">{ticket.ticket_id}</span>
        </h1>
        <span className={`badge status-${ticket.status}`}>{ticket.status}</span>
        <span className="badge">{ticket.priority}</span>
        <span className="badge">{approval.approval_type}</span>
      </header>

      <div className="evidence-grid">
        <div className="evidence-main">
          <Card title="Conversation">
            <p className="muted">
              {conversation.channel_id} · opened{" "}
              {formatDateTime(ticket.opened_at)}
            </p>
            <ol className="thread">
              {messages.map((message) => (
                <li
                  key={message.message_id}
                  className={`msg ${message.direction}`}
                >
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

          <Card title="Proposed AI reply">
            {draft ? (
              <blockquote className="draft">{draft.text}</blockquote>
            ) : (
              <JsonBlock value={approval.requested_payload} />
            )}
          </Card>

          <DecidePanel evidence={evidence} onDecided={onDecided} />
        </div>

        <aside className="evidence-side">
          {can(identity, PERMISSION.aiRunsRead) ? (
            <AiRunCard aiRun={ai_run} />
          ) : null}

          <Card title={`Tool calls (${tool_calls.length})`}>
            {tool_calls.length === 0 ? (
              <p className="muted">No tools were called.</p>
            ) : (
              <ul className="tool-calls">
                {tool_calls.map((call) => (
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
        </aside>
      </div>
    </>
  );
}

function AiRunCard({ aiRun }: { readonly aiRun: AiRunResponse | null }) {
  if (!aiRun) {
    return (
      <Card title="AI run">
        <p className="muted">No AI run is linked to this approval.</p>
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

function Card({
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
