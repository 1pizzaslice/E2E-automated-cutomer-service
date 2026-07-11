import { createContext, useContext } from "react";
import type { SupportApiClient } from "@support/api-client";
import type { SessionIdentityResponse } from "@support/shared-schemas";

/**
 * The resolved reviewer session: a tenant-scoped API client, the caller's
 * identity from `GET /v1/me`, and a sign-out action. Provided by `AuthGate`
 * once credentials and identity resolve; component tests provide it directly to
 * exercise the shell/pages without a real credential provider.
 */
export interface Session {
  readonly client: SupportApiClient;
  readonly identity: SessionIdentityResponse;
  readonly signOut: () => void;
}

const SessionContext = createContext<Session | null>(null);

export const SessionProvider = SessionContext.Provider;

export function useSession(): Session {
  const session = useContext(SessionContext);

  if (!session) {
    throw new Error(
      "useSession must be used within an authenticated <AuthGate>.",
    );
  }

  return session;
}

export function useApiClient(): SupportApiClient {
  return useSession().client;
}

export function useIdentity(): SessionIdentityResponse {
  return useSession().identity;
}
