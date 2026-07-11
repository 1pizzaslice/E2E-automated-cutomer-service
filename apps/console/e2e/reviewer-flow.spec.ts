import { expect, test, type Route } from "@playwright/test";
import {
  approvalFixture,
  evidenceFixture,
  identityFor,
} from "../src/test/fixtures.js";

/**
 * The SOPS §4 reviewer loop in a real browser: sign in → queue → evidence →
 * approve → the reply sends (M23 acceptance). The API is mocked at the network
 * boundary so the real console bundle, router, and fetch layer are exercised
 * without a backend. A tenant-bound support_agent has approvals:review, so the
 * decide actions render.
 */
test("reviewer approves a reply end to end", async ({ page }) => {
  let approveBody: unknown;

  await page.route("**/v1/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/v1/me") {
      return route.fulfill({ json: identityFor("support_agent") });
    }
    if (path === "/v1/approvals/summary") {
      return route.fulfill({
        json: {
          counts: {
            pending: 1,
            approved: 0,
            edited: 0,
            rejected: 0,
            escalated: 0,
            expired: 0,
          },
          total: 1,
        },
      });
    }
    if (path === "/v1/approvals" && request.method() === "GET") {
      return route.fulfill({
        json: {
          approvals: [approvalFixture()],
          page: { count: 1, limit: 25, offset: 0, has_more: false },
        },
      });
    }
    if (path === "/v1/approvals/apr_1/evidence") {
      return route.fulfill({ json: evidenceFixture() });
    }
    if (path === "/v1/approvals/apr_1/approve" && request.method() === "POST") {
      approveBody = request.postDataJSON();
      return route.fulfill({
        json: {
          approval: approvalFixture({ status: "approved" }),
          workflow_signal: {
            delivered: true,
            workflow_id: "wf_1",
            reason: null,
          },
        },
      });
    }

    return route.fulfill({
      status: 404,
      json: {
        error: {
          code: "NOT_FOUND",
          message: "no mock for this route",
          details: [],
          request_id: "e2e",
        },
      },
    });
  });

  // Pre-seed the dev token so the console is signed in (no Clerk in the tier).
  await page.addInitScript(() => {
    window.localStorage.setItem("console.dev.token", "e2e-token");
  });

  await page.goto("/");

  // Lands on the queue with the live open-count badge.
  await expect(page.getByLabel("pending approvals")).toHaveText("1 pending");
  await expect(page.getByText("tic_1")).toBeVisible();

  // Open the evidence for the first approval.
  await page.getByRole("button", { name: "Review" }).first().click();
  await expect(page.getByText("The original AI draft reply.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI run" })).toBeVisible();

  // Approve → the reply sends → back to the queue.
  await page.getByRole("button", { name: /Approve & send/ }).click();
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();

  expect(approveBody).toEqual({});
});
