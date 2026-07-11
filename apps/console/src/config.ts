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
  /**
   * Optional trace-viewer URL template with a `{trace_id}` placeholder (e.g.
   * `https://grafana.example.com/explore?traceID={trace_id}`). When set, the AI
   * run's trace id renders as a link; otherwise as plain text.
   */
  readonly traceUrlTemplate: string;
}

export function loadConsoleConfig(
  env: ImportMetaEnv = import.meta.env,
): ConsoleConfig {
  return {
    // Same-origin by default: served behind Caddy, the console and the API
    // share a host. The API client needs an absolute base (it builds `new
    // URL(base + path)`), so fall back to the current origin rather than "".
    apiBaseUrl: env.VITE_API_BASE_URL?.trim()
      ? env.VITE_API_BASE_URL
      : typeof window !== "undefined"
        ? window.location.origin
        : "",
    clerkPublishableKey: env.VITE_CLERK_PUBLISHABLE_KEY ?? "",
    traceUrlTemplate: env.VITE_TRACE_URL_TEMPLATE ?? "",
  };
}
