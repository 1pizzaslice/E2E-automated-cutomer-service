// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SupportApiClient } from "@support/api-client";
import type {
  RoleName,
  SessionIdentityResponse,
} from "@support/shared-schemas";
import { SessionProvider, type Session } from "../auth/session-context.js";
import { AppShell } from "./app-shell.js";

function identityWith(
  role: RoleName,
  permissions: readonly string[],
): SessionIdentityResponse {
  return {
    user_id: `usr_${role}`,
    tenant_id: "ten_1",
    email: `${role}@test.example`,
    roles: [role],
    permissions: [...permissions],
  };
}

function renderShell(identity: SessionIdentityResponse) {
  const session: Session = {
    // AppShell reads only identity + signOut; the client is never called here.
    client: {} as unknown as SupportApiClient,
    identity,
    signOut: vi.fn(),
  };

  return render(
    <SessionProvider value={session}>
      <MemoryRouter initialEntries={["/approvals"]}>
        <AppShell />
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe("AppShell navigation gating", () => {
  it("shows Approvals and QA Reviews to a qa_reviewer", () => {
    renderShell(
      identityWith("qa_reviewer", [
        "approvals:read",
        "qa_reviews:read",
        "ai_runs:read",
      ]),
    );

    expect(screen.getByRole("link", { name: "Approvals" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "QA Reviews" }),
    ).toBeInTheDocument();
  });

  it("hides QA Reviews from a client_viewer that lacks qa_reviews:read", () => {
    renderShell(identityWith("client_viewer", ["approvals:read"]));

    expect(screen.getByRole("link", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "QA Reviews" })).toBeNull();
  });

  it("shows the reviewer's email and a sign-out control", () => {
    renderShell(
      identityWith("support_agent", ["approvals:read", "qa_reviews:read"]),
    );

    expect(screen.getByText("support_agent@test.example")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });
});
