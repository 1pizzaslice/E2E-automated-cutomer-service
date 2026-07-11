/**
 * Runtime configuration for the console, read from Vite env vars at build time.
 * The console is a static SPA, so these are baked into the bundle — none are
 * secrets (the Clerk publishable key is public by design; the API base URL is
 * the same host the browser already talks to).
 */
export interface ConsoleConfig {
  /** Base URL of the Support API, e.g. `https://staging.example.com`. */
  readonly apiBaseUrl: string;
  /** Clerk publishable key. Empty string selects the dev token provider. */
  readonly clerkPublishableKey: string;
}

export function loadConsoleConfig(
  env: ImportMetaEnv = import.meta.env,
): ConsoleConfig {
  return {
    // Same-origin by default: served behind Caddy, the console and the API
    // share a host, so a relative base resolves against the current origin.
    apiBaseUrl: env.VITE_API_BASE_URL ?? "",
    clerkPublishableKey: env.VITE_CLERK_PUBLISHABLE_KEY ?? "",
  };
}
