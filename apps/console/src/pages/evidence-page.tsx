import { Link, useNavigate, useParams } from "react-router-dom";
import type { ApprovalEvidenceResponse } from "@support/shared-schemas";
import { useApiClient, useIdentity } from "../auth/session-context.js";
import { DecidePanel } from "../components/decide-panel.js";
import {
  AiRunCard,
  Card,
  ConversationCard,
  ToolCallsCard,
} from "../components/evidence-sections.js";
import { JsonBlock } from "../components/json-block.js";
import { draftField } from "../lib/format.js";
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
          <ConversationCard
            channelId={conversation.channel_id}
            openedAt={ticket.opened_at}
            messages={messages}
          />

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
          <ToolCallsCard toolCalls={tool_calls} />
        </aside>
      </div>
    </>
  );
}
