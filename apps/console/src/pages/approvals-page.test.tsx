// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useParams } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { approvalFixture, identityFor } from "../test/fixtures.js";
import { renderWithSession } from "../test/render.js";
import { ApprovalsPage } from "./approvals-page.js";

function StubEvidence() {
  const { approvalId } = useParams();
  return <div>evidence:{approvalId}</div>;
}

function queueClient() {
  return {
    listApprovals: vi.fn().mockResolvedValue({
      approvals: [
        approvalFixture({ approval_id: "apr_1", ticket_id: "tic_1" }),
        approvalFixture({ approval_id: "apr_2", ticket_id: "tic_2" }),
      ],
      page: { count: 2, limit: 25, offset: 0, has_more: false },
    }),
    approvalSummary: vi.fn().mockResolvedValue({
      counts: {
        pending: 2,
        approved: 0,
        edited: 0,
        rejected: 0,
        escalated: 0,
        expired: 0,
      },
      total: 2,
    }),
  };
}

describe("ApprovalsPage", () => {
  it("renders the pending queue with an open-count badge", async () => {
    renderWithSession(<ApprovalsPage />, {
      identity: identityFor("support_agent"),
      client: queueClient(),
      initialEntries: ["/approvals"],
    });

    expect(await screen.findByText("tic_1")).toBeInTheDocument();
    expect(screen.getByText("tic_2")).toBeInTheDocument();
    expect(screen.getByLabelText("pending approvals")).toHaveTextContent(
      "2 pending",
    );
  });

  it("opens the evidence view for the selected approval", async () => {
    const user = userEvent.setup();
    renderWithSession(
      <Routes>
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/approvals/:approvalId" element={<StubEvidence />} />
      </Routes>,
      {
        identity: identityFor("support_agent"),
        client: queueClient(),
        initialEntries: ["/approvals"],
      },
    );

    const reviewButtons = await screen.findAllByRole("button", {
      name: "Review",
    });
    await user.click(reviewButtons[0]!);

    expect(await screen.findByText("evidence:apr_1")).toBeInTheDocument();
  });
});
