import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="screen-message">
      <h1>Not found</h1>
      <p>
        That page does not exist. <Link to="/approvals">Back to approvals</Link>
        .
      </p>
    </section>
  );
}
