import { useCallback, useState } from "react";
import { safeStorage } from "../lib/storage.js";
import type { CredentialsGateProps } from "./credentials.js";

const TOKEN_KEY = "console.dev.token";
const TENANT_KEY = "console.dev.tenant";

/**
 * The dev/local credential gate (active when no Clerk key is configured). It
 * takes a bearer token — a real IdP session token or a locally-minted one — and
 * an optional tenant id, persisting them to localStorage so a Playwright run can
 * pre-seed them. The API still enforces the token; this only decides who to send.
 */
export function TokenCredentialsGate({ children }: CredentialsGateProps) {
  const [token, setToken] = useState(() => safeStorage.get(TOKEN_KEY) ?? "");
  const [tenant, setTenant] = useState(() => safeStorage.get(TENANT_KEY) ?? "");
  const [signedIn, setSignedIn] = useState(() =>
    Boolean(safeStorage.get(TOKEN_KEY)),
  );

  const signOut = useCallback(() => {
    safeStorage.remove(TOKEN_KEY);
    safeStorage.remove(TENANT_KEY);
    setSignedIn(false);
  }, []);

  if (signedIn && token) {
    return (
      <>
        {children({
          token,
          ...(tenant ? { tenantHint: tenant } : {}),
          signOut,
        })}
      </>
    );
  }

  return (
    <form
      className="signin"
      onSubmit={(event) => {
        event.preventDefault();
        safeStorage.set(TOKEN_KEY, token);
        if (tenant) {
          safeStorage.set(TENANT_KEY, tenant);
        }
        setSignedIn(true);
      }}
    >
      <h1>Reviewer Console</h1>
      <p className="signin-hint">
        Development sign-in. Paste a bearer token; add a tenant id only if you
        are a platform user.
      </p>
      <label>
        Bearer token
        <textarea
          value={token}
          onChange={(event) => setToken(event.target.value)}
          rows={4}
          required
          aria-label="Bearer token"
        />
      </label>
      <label>
        Tenant id (optional)
        <input
          value={tenant}
          onChange={(event) => setTenant(event.target.value)}
          aria-label="Tenant id"
        />
      </label>
      <button type="submit">Sign in</button>
    </form>
  );
}
