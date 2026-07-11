import { useNavigate } from "react-router-dom";
import { useApiClient } from "../auth/session-context.js";
import { formatDateTime } from "../lib/format.js";
import { useAsync } from "../lib/use-async.js";

/**
 * The QA work queue: open (incomplete) QA reviews (`GET /v1/qa-reviews?
 * completed=false`). Selecting one opens its evidence + scorecard.
 */
export function QaPage() {
  const client = useApiClient();
  const navigate = useNavigate();

  const reviews = useAsync(
    () => client.listQaReviews({ completed: false, limit: 50 }),
    [client],
  );

  return (
    <section>
      <header className="page-head">
        <h1>QA Reviews</h1>
      </header>

      {reviews.loading && !reviews.data ? <p>Loading QA queue…</p> : null}
      {reviews.error ? <p className="error">{reviews.error}</p> : null}

      {reviews.data ? (
        <table className="queue">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Sample reason</th>
              <th>Created</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {reviews.data.qa_reviews.map((review) => (
              <tr key={review.qa_review_id}>
                <td className="mono">{review.ticket_id}</td>
                <td>{review.sample_reason}</td>
                <td>{formatDateTime(review.created_at)}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => navigate(`/qa/${review.qa_review_id}`)}
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
            {reviews.data.qa_reviews.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">
                  No open QA reviews.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
