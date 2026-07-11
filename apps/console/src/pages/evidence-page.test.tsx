// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { evidenceFixture, identityFor } from "../test/fixtures.js";
import { renderWithSession } from "../test/render.js";
import { EvidencePage } from "./evidence-page.js";

function renderEvidence(
  role: "support_agent" | "qa_reviewer" | "client_viewer",
  client: Record<string, unknown>,
) {
  return renderWithSession(
    <Routes>
      <Route path="/approvals" element={<div>queue</div>} />
      <Route path="/approvals/:approvalId" element={<EvidencePage />} />
    </Routes>,
    {
      identity: identityFor(role),
      client,
      initialEntries: ["/approvals/apr_1"],
    },
  );
}

describe("EvidencePage", () => {
  it("shows the AI draft, the AI run, and decide actions for a reviewer", async () => {
    renderEvidence("support_agent", {
      approvalEvidence: vi.fn().mockResolvedValue(evidenceFixture()),
    });

    expect(
      await screen.findByText("The original AI draft reply."),
    ).toBeInTheDocument();
    // AI run card visible (support_agent holds ai_runs:read).
    expect(screen.getByRole("heading", { name: "AI run" })).toBeInTheDocument();
    expect(screen.getByText("anthropic/claude-sonnet-5")).toBeInTheDocument();
    // Decide actions present.
    expect(
      screen.getByRole("button", { name: /Approve & send/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit reply" }),
    ).toBeInTheDocument();
  });

  it("hides the AI run and decide actions from a client_viewer", async () => {
    renderEvidence("client_viewer", {
      approvalEvidence: vi.fn().mockResolvedValue(evidenceFixture()),
    });

    expect(
      await screen.findByText("The original AI draft reply."),
    ).toBeInTheDocument();
    // No ai_runs:read → the AI run card never renders.
    expect(screen.queryByRole("heading", { name: "AI run" })).toBeNull();
    // No approvals:review → read-only, no decide buttons.
    expect(screen.queryByRole("button", { name: /Approve & send/ })).toBeNull();
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
  });

  it("submits an edited draft as approved_payload, keeping the original visible", async () => {
    const user = userEvent.setup();
    const editApproval = vi.fn().mockResolvedValue({
      approval: {},
      workflow_signal: { delivered: true, workflow_id: "wf", reason: null },
    });

    renderEvidence("support_agent", {
      approvalEvidence: vi.fn().mockResolvedValue(evidenceFixture()),
      editApproval,
    });

    await screen.findByText("The original AI draft reply.");
    await user.click(screen.getByRole("button", { name: "Edit reply" }));

    const editor = screen.getByLabelText("Edited reply");
    // The editor is seeded with the AI draft; the original stays in evidence.
    expect(editor).toHaveValue("The original AI draft reply.");
    await user.clear(editor);
    await user.type(editor, "Tightened reply from the reviewer.");

    await user.click(
      screen.getByRole("button", { name: /Save & send edited reply/ }),
    );

    expect(editApproval).toHaveBeenCalledWith("apr_1", {
      approved_payload: { draft: "Tightened reply from the reviewer." },
    });
    // onDecided navigates back to the queue.
    expect(await screen.findByText("queue")).toBeInTheDocument();
  });
});
