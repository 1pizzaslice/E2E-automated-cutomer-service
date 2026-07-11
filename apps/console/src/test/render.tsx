import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { SupportApiClient } from "@support/api-client";
import type { SessionIdentityResponse } from "@support/shared-schemas";
import { SessionProvider, type Session } from "../auth/session-context.js";

/**
 * Render `ui` inside a session + router, so components that call
 * `useSession`/`useApiClient`/router hooks work. `client` is a partial fake —
 * only the methods the component under test calls need to be provided.
 */
export function renderWithSession(
  ui: ReactNode,
  options: {
    readonly identity: SessionIdentityResponse;
    readonly client: Partial<SupportApiClient>;
    readonly initialEntries?: readonly string[];
    readonly signOut?: () => void;
  },
) {
  const session: Session = {
    identity: options.identity,
    client: options.client as SupportApiClient,
    signOut: options.signOut ?? (() => {}),
  };

  return render(
    <SessionProvider value={session}>
      <MemoryRouter initialEntries={[...(options.initialEntries ?? ["/"])]}>
        {ui}
      </MemoryRouter>
    </SessionProvider>,
  );
}
