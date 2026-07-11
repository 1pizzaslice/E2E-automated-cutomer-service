import { SupportApiClient } from "@support/api-client";

export interface ConsoleClientOptions {
  readonly baseUrl: string;
  readonly tenantId?: string;
  /** Static bearer token — the dev/token-auth path. */
  readonly token?: string;
  /**
   * Dynamic bearer token — the Clerk path. Clerk session tokens are short-lived
   * (~60s), so a static token would expire mid-session; instead we inject a
   * fresh token per request via a fetch wrapper. Returns null when signed out.
   */
  readonly getToken?: () => Promise<string | null>;
}

/**
 * Build a `SupportApiClient` for the console. With `getToken`, a fetch wrapper
 * attaches a fresh bearer on every request (so Clerk token rotation is
 * transparent); with a static `token`, the client attaches it directly.
 */
export function createConsoleClient(
  options: ConsoleClientOptions,
): SupportApiClient {
  if (options.getToken) {
    const getToken = options.getToken;
    const authedFetch: typeof fetch = async (input, init) => {
      const token = await getToken();
      const headers = new Headers(init?.headers);

      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }

      return fetch(input, { ...init, headers });
    };

    return new SupportApiClient({
      baseUrl: options.baseUrl,
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      fetch: authedFetch,
    });
  }

  return new SupportApiClient({
    baseUrl: options.baseUrl,
    ...(options.token ? { token: options.token } : {}),
    ...(options.tenantId ? { tenantId: options.tenantId } : {}),
  });
}
