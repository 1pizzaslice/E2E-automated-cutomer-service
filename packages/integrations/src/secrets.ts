/**
 * Shared integration secret handling (BACKEND_SPEC section 4.1, PLAN section
 * 13). Configuration rows (channel config, integration rows) store opaque
 * secret REFERENCES — the name of an environment variable — never secret
 * values. Every resolver in the platform (inbound webhook signing secrets,
 * outbound send credentials) goes through this module so the rules live in
 * one place: a reference must look like an environment variable name before
 * the environment is consulted, and resolved values are returned to the
 * caller only — never logged, never echoed into errors or results.
 */
export interface SecretResolver {
  resolve(ref: string): Promise<string | null>;
}

/**
 * Secret references must be plausible environment variable names. This stops
 * tenant-influenced configuration from addressing arbitrary process state
 * (empty strings, paths, lowercase config keys) and makes a leaked reference
 * useless on its own.
 */
export const SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function isValidSecretRef(ref: string): boolean {
  return SECRET_REF_PATTERN.test(ref);
}

export function createEnvSecretResolver(
  env: NodeJS.ProcessEnv = process.env,
): SecretResolver {
  return {
    async resolve(ref) {
      if (!isValidSecretRef(ref)) {
        return null;
      }

      const value = env[ref];
      return value && value.length > 0 ? value : null;
    },
  };
}

/** In-memory resolver for tests; same reference validation as the env default. */
export function createStaticSecretResolver(
  secrets: Readonly<Record<string, string>>,
): SecretResolver {
  return {
    async resolve(ref) {
      if (!isValidSecretRef(ref)) {
        return null;
      }

      return secrets[ref] ?? null;
    },
  };
}
