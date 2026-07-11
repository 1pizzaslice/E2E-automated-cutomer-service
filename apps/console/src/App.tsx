import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "./auth/auth-gate.js";
import { ApprovalsPage } from "./pages/approvals-page.js";
import { EvidencePage } from "./pages/evidence-page.js";
import { NotFoundPage } from "./pages/not-found-page.js";
import { QaPage } from "./pages/qa-page.js";
import { QaReviewPage } from "./pages/qa-review-page.js";
import { AppShell } from "./shell/app-shell.js";

/**
 * Root of the reviewer console (Milestone 23). `AuthGate` resolves the reviewer
 * session (Clerk or the dev token form → `GET /v1/me`), then the router mounts
 * the permission-gated shell over the queue, evidence, and QA routes.
 */
export function App() {
  return (
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/approvals" replace />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="approvals/:approvalId" element={<EvidencePage />} />
            <Route path="qa" element={<QaPage />} />
            <Route path="qa/:qaReviewId" element={<QaReviewPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthGate>
  );
}
