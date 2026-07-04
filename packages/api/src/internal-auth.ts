import { createHash, timingSafeEqual } from "node:crypto";
import { isValidSecretRef } from "@support/integrations";

/**
 * Internal machine-token auth for the AI runtime sidecar (Milestone 14).
 * `/internal/*` routes are never exposed through the user gateway; the sidecar
 * authenticates with a single shared bearer token whose value lives in the
 * environment, addressed by the platform's secret-ref convention (the ref is
 * the NAME of an environment variable, `packages/integrations/src/secrets.ts`).
 * A request presenting the token becomes the `internal_service` principal —
 * that role is minted here only and is rejected when claimed via the
 * `x-user-roles` header (see `request-context.ts`).
 */
export interface InternalAuthConfig {
  readonly token: string;
}

/** Environment variable naming the secret ref for the internal API token. */
export const INTERNAL_API_TOKEN_REF_ENV = "SUPPORT_INTERNAL_API_TOKEN_REF";

/** Default secret ref (env var name) holding the internal API token value. */
export const DEFAULT_INTERNAL_API_TOKEN_REF = "SUPPORT_INTERNAL_API_TOKEN";

/**
 * Stable principal id for the AI runtime service actor. Audit rows and logs
 * attribute internal tool executions to this id, never to a human user.
 */
export const INTERNAL_SERVICE_USER_ID = "svc:ai-runtime";

/**
 * Loads the internal auth config from the environment. Returns `undefined`
 * when the token is not configured — internal auth is then disabled and the
 * platform fails closed: no user role holds `tools:execute_internal`, so the
 * internal route is unreachable. A malformed secret ref is a deployment error
 * and fails fast instead of silently disabling machine auth.
 */
export function loadInternalAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): InternalAuthConfig | undefined {
  const ref = env[INTERNAL_API_TOKEN_REF_ENV] ?? DEFAULT_INTERNAL_API_TOKEN_REF;

  if (!isValidSecretRef(ref)) {
    throw new Error(
      `${INTERNAL_API_TOKEN_REF_ENV} must name an environment variable ` +
        `(matching ^[A-Z][A-Z0-9_]*$); got an invalid secret ref.`,
    );
  }

  const token = env[ref];

  if (!token || token.length === 0) {
    return undefined;
  }

  return { token };
}

/**
 * Constant-time comparison of a presented bearer token against the configured
 * internal token. Both values are hashed first so `timingSafeEqual` always
 * compares equal-length buffers and the check leaks neither length nor prefix.
 */
export function isInternalServiceToken(
  config: InternalAuthConfig,
  presented: string,
): boolean {
  return timingSafeEqual(sha256(config.token), sha256(presented));
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
