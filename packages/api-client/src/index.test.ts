import { describe, expect, it } from "vitest";
import { ApiClientError, API_ROUTES, SupportApiClient } from "./index.js";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function recordingFetch(response: { status?: number; body: unknown }): {
  fetch: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const status = response.status ?? 200;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(response.body),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { fetch: fetchImpl, calls };
}

const approvalFixture = {
  approval_id: "apr_1",
  tenant_id: "ten_1",
  ticket_id: "tic_1",
  ai_run_id: null,
  approval_type: "reply",
  status: "approved",
  requested_payload: { draft: "AI draft." },
  approved_payload: { draft: "AI draft." },
  reviewer_user_id: "usr_1",
  review_notes: null,
  created_at: "2026-06-19T00:00:00.000Z",
  resolved_at: "2026-06-19T00:00:00.000Z",
};

describe("SupportApiClient", () => {
  it("serializes query params and sends auth + tenant headers", async () => {
    const { fetch, calls } = recordingFetch({
      body: { approvals: [], page: { count: 0, limit: 25, offset: 5 } },
    });
    const client = new SupportApiClient({
      baseUrl: "https://api.test/",
      token: "tok_123",
      tenantId: "ten_1",
      fetch,
    });

    const result = await client.listApprovals({
      status: "pending",
      order: "created_asc",
      offset: 5,
      limit: 25,
    });

    expect(result.page.offset).toBe(5);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    const url = new URL(call.url);
    expect(url.pathname).toBe("/v1/approvals");
    expect(url.searchParams.get("status")).toBe("pending");
    expect(url.searchParams.get("order")).toBe("created_asc");
    expect(url.searchParams.get("offset")).toBe("5");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok_123");
    expect(headers["x-tenant-id"]).toBe("ten_1");
  });

  it("posts a JSON body for a decision", async () => {
    const { fetch, calls } = recordingFetch({
      body: {
        approval: approvalFixture,
        workflow_signal: { delivered: true, workflow_id: null, reason: null },
      },
    });
    const client = new SupportApiClient({ baseUrl: "https://api.test", fetch });

    const result = await client.editApproval("apr 1", {
      approved_payload: { draft: "Edited." },
    });

    expect(result.approval.approval_id).toBe("apr_1");
    const call = calls[0]!;
    // Path segment is URL-encoded.
    expect(call.url).toBe("https://api.test/v1/approvals/apr%201/edit");
    expect(call.init?.method).toBe("POST");
    expect(JSON.parse(call.init?.body as string)).toEqual({
      approved_payload: { draft: "Edited." },
    });
  });

  it("throws a typed ApiClientError on a non-2xx response", async () => {
    const { fetch } = recordingFetch({
      status: 404,
      body: {
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "Approval was not found.",
          details: [],
          request_id: "req_1",
        },
      },
    });
    const client = new SupportApiClient({ baseUrl: "https://api.test", fetch });

    await expect(client.getApproval("apr_missing")).rejects.toMatchObject({
      name: "ApiClientError",
      status: 404,
      code: "RESOURCE_NOT_FOUND",
    });
    expect(ApiClientError).toBeDefined();
  });

  it("exposes a non-empty route manifest", () => {
    expect(API_ROUTES.length).toBeGreaterThan(40);
    expect(API_ROUTES).toContainEqual({
      method: "GET",
      path: "/v1/approvals/summary",
    });
  });
});
