import { Fragment } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { QaReviewEvidenceResponse } from "@support/shared-schemas";
import { useApiClient, useIdentity } from "../auth/session-context.js";
import {
  AiRunCard,
  Card,
  ConversationCard,
  ToolCallsCard,
} from "../components/evidence-sections.js";
import { QaCompleteForm } from "../components/qa-complete-form.js";
import { formatDateTime } from "../lib/format.js";
import { PERMISSION, can } from "../lib/permissions.js";
import { useAsync } from "../lib/use-async.js";

/**
 * A single QA review (`GET /v1/qa-reviews/{id}/evidence`): the same conversation
 * / AI-run / tool-call evidence a reviewer saw, plus the scorecard. Completing
 * requires `qa_reviews:write`; `support_agent` (read-only QA) sees the evidence
 * but not the form.
 */
export function QaReviewPage() {
  const { qaReviewId = "" } = useParams();
  const client = useApiClient();
  const navigate = useNavigate();

  const evidence = useAsync(
    () => client.qaReviewEvidence(qaReviewId),
    [client, qaReviewId],
  );

  return (
    <section className="evidence">
      <p>
        <Link to="/qa">← Back to QA queue</Link>
      </p>

      {evidence.loading && !evidence.data ? <p>Loading QA review…</p> : null}
      {evidence.error ? <p className="error">{evidence.error}</p> : null}

      {evidence.data ? (
        <QaReviewView
          evidence={evidence.data}
          onCompleted={() => navigate("/qa")}
        />
      ) : null}
    </section>
  );
}

function QaReviewView({
  evidence,
  onCompleted,
}: {
  readonly evidence: QaReviewEvidenceResponse;
  readonly onCompleted: () => void;
}) {
  const identity = useIdentity();
  const { qa_review, ticket, conversation, messages, ai_run, tool_calls } =
    evidence;
  const completed = qa_review.completed_at !== null;
  const canWrite = can(identity, PERMISSION.qaReviewsWrite);

  return (
    <>
      <header className="page-head">
        <h1>
          QA review <span className="mono">{ticket.ticket_id}</span>
        </h1>
        <span className="badge">{qa_review.sample_reason}</span>
        {completed ? (
          <span className="badge status-succeeded">
            completed {formatDateTime(qa_review.completed_at ?? "")}
          </span>
        ) : (
          <span className="badge status-waiting_human">open</span>
        )}
      </header>

      <div className="evidence-grid">
        <div className="evidence-main">
          <ConversationCard
            channelId={conversation.channel_id}
            openedAt={ticket.opened_at}
            messages={messages}
          />

          {completed ? (
            <Card title="Recorded scores">
              <dl className="kv">
                {Object.entries(qa_review.scores).map(([dimension, score]) => (
                  <Fragment key={dimension}>
                    <dt>{dimension}</dt>
                    <dd>{String(score)}</dd>
                  </Fragment>
                ))}
              </dl>
            </Card>
          ) : canWrite ? (
            <QaCompleteForm
              qaReviewId={qa_review.qa_review_id}
              onCompleted={onCompleted}
            />
          ) : (
            <p className="readonly-note">
              You have read-only access to QA reviews. Scoring requires the QA
              reviewer role.
            </p>
          )}
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
