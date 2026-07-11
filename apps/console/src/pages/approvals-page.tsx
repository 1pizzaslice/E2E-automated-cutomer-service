import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApiClient } from "../auth/session-context.js";
import { formatAge } from "../lib/format.js";
import { useAsync, useInterval } from "../lib/use-async.js";

const PAGE_SIZE = 25;
const POLL_MS = 10_000;

/**
 * The reviewer queue: oldest-pending-first approvals with a live open-count
 * badge, paginated, and polled for freshness (Milestone 20 `order`/`offset`/
 * `has_more` + the summary endpoint). Selecting a row opens its evidence.
 */
export function ApprovalsPage() {
  const client = useApiClient();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);

  const queue = useAsync(
    () =>
      client.listApprovals({
        status: "pending",
        order: "created_asc",
        limit: PAGE_SIZE,
        offset,
      }),
    [client, offset],
  );
  const summary = useAsync(() => client.approvalSummary(), [client]);

  useInterval(() => {
    queue.reload();
    summary.reload();
  }, POLL_MS);

  return (
    <section>
      <header className="page-head">
        <h1>Approvals</h1>
        {summary.data ? (
          <span className="badge" aria-label="pending approvals">
            {summary.data.counts.pending} pending
          </span>
        ) : null}
      </header>

      {queue.loading && !queue.data ? <p>Loading queue…</p> : null}
      {queue.error ? <p className="error">{queue.error}</p> : null}

      {queue.data ? (
        <>
          <table className="queue">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Type</th>
                <th>Waiting</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {queue.data.approvals.map((approval) => (
                <tr key={approval.approval_id}>
                  <td className="mono">{approval.ticket_id}</td>
                  <td>{approval.approval_type}</td>
                  <td>{formatAge(approval.created_at)}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/approvals/${approval.approval_id}`)
                      }
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
              {queue.data.approvals.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    The queue is empty.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <div className="pager">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() =>
                setOffset((value) => Math.max(0, value - PAGE_SIZE))
              }
            >
              Previous
            </button>
            <span>
              {offset + 1}–{offset + queue.data.approvals.length}
            </span>
            <button
              type="button"
              disabled={!queue.data.page.has_more}
              onClick={() => setOffset((value) => value + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
