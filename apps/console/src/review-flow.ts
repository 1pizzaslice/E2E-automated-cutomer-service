import type { SupportApiClient } from "@support/api-client";

// The evidence shape is derived from the client method itself, so this module
// depends on nothing but @support/api-client — the whole point of the Milestone
// 20 contract proof. Milestone 23 renders this loop as a UI.
type ApprovalEvidence = Awaited<
  ReturnType<SupportApiClient["approvalEvidence"]>
>;

/**
 * A reviewer's decision on one approval. `edit` carries the human-edited draft
 * (`approvedPayload`); the original AI draft stays visible in the evidence's
 * `approval.requested_payload`.
 */
export type ReviewDecision =
  | { readonly action: "approve"; readonly reviewNotes?: string }
  | {
      readonly action: "edit";
      readonly approvedPayload: Record<string, unknown>;
      readonly reviewNotes?: string;
    }
  | { readonly action: "reject"; readonly reviewNotes: string }
  | { readonly action: "escalate"; readonly reviewNotes: string };

/** Given the evidence for the next approval, decide what to do with it. */
export type ReviewStrategy = (evidence: ApprovalEvidence) => ReviewDecision;

export interface ReviewFlowResult {
  /** Open approvals waiting, from the queue summary. */
  readonly pendingCount: number;
  /** The approval acted on this pass, or null when the queue was empty. */
  readonly reviewed: {
    readonly approvalId: string;
    readonly ticketId: string;
    readonly action: ReviewDecision["action"];
    /** Whether the workflow accepted the resume signal. */
    readonly delivered: boolean;
  } | null;
}

/**
 * The reviewer's core loop expressed purely over the typed client
 * (login → queue → evidence → decide, Milestone 20 acceptance):
 *
 *   1. read the open-counts summary (queue badge),
 *   2. pull the oldest pending approval,
 *   3. load its evidence composite,
 *   4. apply the caller's strategy and submit the decision.
 *
 * The caller supplies an authenticated `SupportApiClient` (the "login" — a
 * client carrying the reviewer's session token and tenant). Everything else
 * flows through the client contract, so this compiles against the OpenAPI
 * guarantees alone.
 */
export async function runReviewFlow(
  client: SupportApiClient,
  strategy: ReviewStrategy,
): Promise<ReviewFlowResult> {
  const summary = await client.approvalSummary();
  const queue = await client.listApprovals({
    status: "pending",
    order: "created_asc",
    limit: 20,
  });

  const next = queue.approvals[0];

  if (!next) {
    return { pendingCount: summary.counts.pending, reviewed: null };
  }

  const evidence = await client.approvalEvidence(next.approval_id);
  const decision = strategy(evidence);
  const id = next.approval_id;

  const outcome = await submitDecision(client, id, decision);

  return {
    pendingCount: summary.counts.pending,
    reviewed: {
      approvalId: id,
      ticketId: next.ticket_id,
      action: decision.action,
      delivered: outcome.workflow_signal.delivered,
    },
  };
}

function submitDecision(
  client: SupportApiClient,
  approvalId: string,
  decision: ReviewDecision,
) {
  switch (decision.action) {
    case "approve":
      return client.approveApproval(
        approvalId,
        decision.reviewNotes ? { review_notes: decision.reviewNotes } : {},
      );
    case "edit":
      return client.editApproval(approvalId, {
        approved_payload: decision.approvedPayload,
        ...(decision.reviewNotes ? { review_notes: decision.reviewNotes } : {}),
      });
    case "reject":
      return client.rejectApproval(approvalId, {
        review_notes: decision.reviewNotes,
      });
    case "escalate":
      return client.escalateApproval(approvalId, {
        review_notes: decision.reviewNotes,
      });
  }
}
