import { useState } from "react";
import type { SupportApiClient } from "@support/api-client";
import type { ApprovalEvidenceResponse } from "@support/shared-schemas";
import { useApiClient, useIdentity } from "../auth/session-context.js";
import { describeError } from "../lib/errors.js";
import { draftField } from "../lib/format.js";
import { PERMISSION, can } from "../lib/permissions.js";

type ApprovalEvidence = ApprovalEvidenceResponse;
type Mode = "idle" | "edit" | "reject" | "escalate";

/**
 * The decide actions for one approval — approve / edit / reject / escalate —
 * rendered only for reviewers holding `approvals:review`. `qa_reviewer` and
 * `client_viewer` (read-only on approvals) see the read-only notice instead.
 * The original AI draft stays in the evidence view above; the edit box here is
 * the human's reply, kept visibly separate (M23 acceptance).
 */
export function DecidePanel({
  evidence,
  onDecided,
}: {
  readonly evidence: ApprovalEvidence;
  readonly onDecided: () => void;
}) {
  const client = useApiClient();
  const identity = useIdentity();

  if (!can(identity, PERMISSION.approvalsReview)) {
    return (
      <p className="readonly-note">
        You have read-only access to approvals. Decisions require the reviewer
        role.
      </p>
    );
  }

  return (
    <DecideActions client={client} evidence={evidence} onDecided={onDecided} />
  );
}

function DecideActions({
  client,
  evidence,
  onDecided,
}: {
  readonly client: SupportApiClient;
  readonly evidence: ApprovalEvidence;
  readonly onDecided: () => void;
}) {
  const approvalId = evidence.approval.approval_id;
  const original = evidence.approval.requested_payload as Record<
    string,
    unknown
  >;
  const field = draftField(original);
  const initialDraft = field ? field.text : JSON.stringify(original, null, 2);

  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState(initialDraft);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setSubmitting(true);
    setError(null);

    try {
      await action();
      onDecided();
    } catch (caught) {
      setError(describeError(caught));
      setSubmitting(false);
    }
  }

  function buildApprovedPayload(): Record<string, unknown> {
    if (field) {
      return { ...original, [field.key]: draft };
    }

    // No recognized text field: the box holds raw JSON for the whole payload.
    return JSON.parse(draft) as Record<string, unknown>;
  }

  const trimmedNotes = notes.trim();

  return (
    <div className="decide">
      <h2>Decision</h2>

      {error ? <p className="error">{error}</p> : null}

      {mode === "idle" ? (
        <div className="decide-actions">
          <button
            type="button"
            className="primary"
            disabled={submitting}
            onClick={() =>
              run(() =>
                client.approveApproval(
                  approvalId,
                  trimmedNotes ? { review_notes: trimmedNotes } : {},
                ),
              )
            }
          >
            Approve &amp; send
          </button>
          <button type="button" onClick={() => setMode("edit")}>
            Edit reply
          </button>
          <button type="button" onClick={() => setMode("reject")}>
            Reject
          </button>
          <button type="button" onClick={() => setMode("escalate")}>
            Escalate
          </button>
        </div>
      ) : null}

      {mode === "edit" ? (
        <div className="decide-form">
          <label>
            Your edited reply
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={8}
              aria-label="Edited reply"
            />
          </label>
          <label>
            Review notes (optional)
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              aria-label="Review notes"
            />
          </label>
          <div className="decide-actions">
            <button
              type="button"
              className="primary"
              disabled={submitting}
              onClick={() => {
                let approvedPayload: Record<string, unknown>;
                try {
                  approvedPayload = buildApprovedPayload();
                } catch {
                  setError("The draft is not valid JSON. Fix it and retry.");
                  return;
                }
                void run(() =>
                  client.editApproval(approvalId, {
                    approved_payload: approvedPayload,
                    ...(trimmedNotes ? { review_notes: trimmedNotes } : {}),
                  }),
                );
              }}
            >
              Save &amp; send edited reply
            </button>
            <button type="button" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {mode === "reject" || mode === "escalate" ? (
        <div className="decide-form">
          <label>
            {mode === "reject" ? "Why reject?" : "Why escalate?"} (required)
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              aria-label="Reason"
            />
          </label>
          <div className="decide-actions">
            <button
              type="button"
              className="primary"
              disabled={submitting || trimmedNotes.length === 0}
              onClick={() =>
                run(() =>
                  mode === "reject"
                    ? client.rejectApproval(approvalId, {
                        review_notes: trimmedNotes,
                      })
                    : client.escalateApproval(approvalId, {
                        review_notes: trimmedNotes,
                      }),
                )
              }
            >
              Confirm {mode}
            </button>
            <button type="button" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
