/**
 * The client-facing HTTP surface of the Support API (Milestone 20). This is the
 * single source of truth the drift test asserts against: every route registered
 * in `packages/api` (minus the internal service and provider-webhook routes,
 * which are not called by API clients) must appear here, and vice versa. Adding
 * a route to `routes.ts` without adding it here fails the drift test.
 *
 * Paths use OpenAPI `{param}` templates so they line up with the served
 * document and the Fastify route table after normalization.
 */
export interface ApiRoute {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
}

export const API_ROUTES: readonly ApiRoute[] = [
  { method: "GET", path: "/health" },
  { method: "GET", path: "/ready" },
  { method: "GET", path: "/openapi.json" },

  { method: "GET", path: "/v1/me" },

  { method: "GET", path: "/v1/tenants" },
  { method: "POST", path: "/v1/tenants" },
  { method: "GET", path: "/v1/tenants/{tenant_id}" },
  { method: "PATCH", path: "/v1/tenants/{tenant_id}" },

  { method: "GET", path: "/v1/customers" },
  { method: "POST", path: "/v1/customers" },
  { method: "GET", path: "/v1/customers/{customer_id}" },
  { method: "PATCH", path: "/v1/customers/{customer_id}" },

  { method: "GET", path: "/v1/conversations" },
  { method: "GET", path: "/v1/conversations/{conversation_id}" },
  { method: "GET", path: "/v1/conversations/{conversation_id}/messages" },
  {
    method: "GET",
    path: "/v1/conversations/{conversation_id}/messages/{message_id}",
  },

  { method: "GET", path: "/v1/tickets" },
  { method: "POST", path: "/v1/tickets" },
  { method: "GET", path: "/v1/tickets/{ticket_id}" },
  { method: "PATCH", path: "/v1/tickets/{ticket_id}" },
  { method: "GET", path: "/v1/tickets/{ticket_id}/audit-events" },
  { method: "GET", path: "/v1/tickets/{ticket_id}/events" },

  { method: "GET", path: "/v1/approvals" },
  { method: "GET", path: "/v1/approvals/summary" },
  { method: "GET", path: "/v1/approvals/{approval_id}" },
  { method: "GET", path: "/v1/approvals/{approval_id}/evidence" },
  { method: "POST", path: "/v1/approvals/{approval_id}/approve" },
  { method: "POST", path: "/v1/approvals/{approval_id}/edit" },
  { method: "POST", path: "/v1/approvals/{approval_id}/reject" },
  { method: "POST", path: "/v1/approvals/{approval_id}/escalate" },

  { method: "GET", path: "/v1/ai-runs" },
  { method: "GET", path: "/v1/ai-runs/{ai_run_id}" },

  { method: "GET", path: "/v1/qa-reviews" },
  { method: "POST", path: "/v1/qa-reviews" },
  { method: "GET", path: "/v1/qa-reviews/{qa_review_id}" },
  { method: "POST", path: "/v1/qa-reviews/{qa_review_id}/complete" },
  { method: "GET", path: "/v1/qa-reviews/{qa_review_id}/evidence" },

  { method: "GET", path: "/v1/audit-events" },
  { method: "GET", path: "/v1/audit-events/{audit_event_id}" },

  { method: "GET", path: "/v1/policies" },
  { method: "POST", path: "/v1/policies" },
  { method: "GET", path: "/v1/policies/automation" },
  { method: "GET", path: "/v1/policies/{policy_id}" },
  { method: "GET", path: "/v1/policies/{policy_id}/versions" },
  { method: "POST", path: "/v1/policies/{policy_id}/versions" },
  { method: "POST", path: "/v1/policies/{policy_id}/archive" },
  { method: "POST", path: "/v1/policy-versions/{policy_version_id}/activate" },

  { method: "GET", path: "/v1/kb/documents" },
  { method: "POST", path: "/v1/kb/documents" },
  { method: "GET", path: "/v1/kb/documents/{kb_document_id}" },
  { method: "PATCH", path: "/v1/kb/documents/{kb_document_id}" },
  { method: "POST", path: "/v1/kb/documents/{kb_document_id}/ingest" },
  { method: "POST", path: "/v1/kb/search" },

  { method: "GET", path: "/v1/reports/pilot-weekly" },
] as const;

/** `"{method} {path}"` keys, for set-based drift comparison. */
export function apiRouteKeys(): Set<string> {
  return new Set(API_ROUTES.map((route) => `${route.method} ${route.path}`));
}
