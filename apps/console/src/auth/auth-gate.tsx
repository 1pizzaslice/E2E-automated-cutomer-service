import { useEffect, useState, type ReactNode } from "react";
import { ApiClientError } from "@support/api-client";
import { loadConsoleConfig, type ConsoleConfig } from "../config.js";
import { createConsoleClient } from "../lib/api.js";
import { ClerkCredentialsGate } from "./clerk-credentials.js";
import type { Credentials } from "./credentials.js";
import { SessionProvider, type Session } from "./session-context.js";
import { TokenCredentialsGate } from "./token-credentials.js";

type ResolveState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly session: Session };

/**
 * Turns acquired credentials into a resolved `Session`: it calls `GET /v1/me`
 * with a bootstrap client (no tenant yet), then builds the tenant-scoped client
 * the app uses — the tenant is the caller's home tenant, or the credential's
 * hint when the caller is a platform user.
 */
function SessionResolver({
  credentials,
  config,
  children,
}: {
  readonly credentials: Credentials;
  readonly config: ConsoleConfig;
  readonly children: ReactNode;
}) {
  const [state, setState] = useState<ResolveState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    const bootstrap = createConsoleClient({
      baseUrl: config.apiBaseUrl,
      ...(credentials.token ? { token: credentials.token } : {}),
      ...(credentials.getToken ? { getToken: credentials.getToken } : {}),
    });

    bootstrap
      .me()
      .then((identity) => {
        if (cancelled) {
          return;
        }

        const tenantId = identity.tenant_id ?? credentials.tenantHint;
        const client = createConsoleClient({
          baseUrl: config.apiBaseUrl,
          ...(tenantId ? { tenantId } : {}),
          ...(credentials.token ? { token: credentials.token } : {}),
          ...(credentials.getToken ? { getToken: credentials.getToken } : {}),
        });

        setState({
          status: "ready",
          session: { client, identity, signOut: credentials.signOut },
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: describeError(error) });
        }
      });

    return () => {
      cancelled = true;
    };
    // Re-resolve when the token/tenant changes; getToken is stable per session.
  }, [config, credentials.token, credentials.getToken, credentials.tenantHint]);

  if (state.status === "loading") {
    return <div className="screen-message">Loading your session…</div>;
  }

  if (state.status === "error") {
    return (
      <div className="screen-message">
        <h1>Cannot open the console</h1>
        <p>{state.message}</p>
        <button type="button" onClick={credentials.signOut}>
          Sign out
        </button>
      </div>
    );
  }

  return <SessionProvider value={state.session}>{children}</SessionProvider>;
}

function describeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return "Your session is not recognized. Your account may not be provisioned for this workspace.";
    }
    if (error.status === 403) {
      return "You are not a member of this tenant.";
    }
    return error.message;
  }

  return "The API is unreachable. Check your connection and try again.";
}

/**
 * The auth boundary: pick the credential gate by config (Clerk when a
 * publishable key is set, otherwise the dev token form), acquire credentials,
 * resolve the session, and render the app. Everything below it can call
 * `useSession()`.
 */
export function AuthGate({ children }: { readonly children: ReactNode }) {
  const config = loadConsoleConfig();

  const render = (credentials: Credentials) => (
    <SessionResolver credentials={credentials} config={config}>
      {children}
    </SessionResolver>
  );

  if (config.clerkPublishableKey) {
    return (
      <ClerkCredentialsGate publishableKey={config.clerkPublishableKey}>
        {render}
      </ClerkCredentialsGate>
    );
  }

  return <TokenCredentialsGate>{render}</TokenCredentialsGate>;
}
