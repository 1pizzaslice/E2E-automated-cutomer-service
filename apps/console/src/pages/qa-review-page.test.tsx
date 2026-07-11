// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { identityFor, qaEvidenceFixture } from "../test/fixtures.js";
import { renderWithSession } from "../test/render.js";
import { QaReviewPage } from "./qa-review-page.js";

function renderReview(
  role: "qa_reviewer" | "support_agent",
  client: Record<string, unknown>,
) {
  return renderWithSession(
    <Routes>
      <Route path="/qa" element={<div>qa-queue</div>} />
      <Route path="/qa/:qaReviewId" element={<QaReviewPage />} />
    </Routes>,
    {
      identity: identityFor(role),
      client,
      initialEntries: ["/qa/qa_1"],
    },
  );
}

describe("QaReviewPage", () => {
  it("submits scores and a defect from the taxonomy for a qa_reviewer", async () => {
    const user = userEvent.setup();
    const completeQaReview = vi.fn().mockResolvedValue({});

    renderReview("qa_reviewer", {
      qaReviewEvidence: vi.fn().mockResolvedValue(qaEvidenceFixture()),
      completeQaReview,
    });

    // Evidence renders (shared conversation card).
    expect(
      await screen.findByText("Where is my order #1234?"),
    ).toBeInTheDocument();

    // Score one dimension and flag a defect from the closed taxonomy.
    await user.selectOptions(screen.getByLabelText("Tone"), "3");
    await user.click(screen.getByLabelText("hallucination"));

    await user.click(screen.getByRole("button", { name: "Submit QA review" }));

    expect(completeQaReview).toHaveBeenCalledTimes(1);
    const [id, body] = completeQaReview.mock.calls[0]!;
    expect(id).toBe("qa_1");
    expect(body.scores.tone).toBe(3);
    expect(body.scores.grounding).toBe(5);
    expect(body.defects).toEqual([
      { category: "hallucination", severity: "medium" },
    ]);
    // Returned to the QA queue after completing.
    expect(await screen.findByText("qa-queue")).toBeInTheDocument();
  });

  it("is read-only for a support_agent lacking qa_reviews:write", async () => {
    renderReview("support_agent", {
      qaReviewEvidence: vi.fn().mockResolvedValue(qaEvidenceFixture()),
    });

    expect(
      await screen.findByText("Where is my order #1234?"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit QA review" }),
    ).toBeNull();
    expect(screen.getByText(/read-only access to QA/i)).toBeInTheDocument();
  });
});
