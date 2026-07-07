import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import {
  createDatabaseFromEnv,
  userByIdpSubjectQuery,
  userRoleGrantsQuery,
} from "@support/db";
import { RoleNameSchema, type RoleName } from "@support/shared-schemas";
import { HttpError } from "./errors.js";

/**
 * Production API authentication (Milestone 16, ADR-0024): hosted-IdP JWTs
 * verified against the issuer's JWKS. Tokens carry identity only (`sub`,
 * optionally `email`); the database stays the source of truth for the user
 * row, its status, its tenant membership, and its roles. The Milestone 1-15
 * trusted-header mode survives strictly behind an explicit env opt-in for
 * tests/local tooling and is never the default.
 */

export const AUTH_MODE_ENV = "SUPPORT_AUTH_MODE";
export const AUTH_ISSUER_ENV = "SUPPORT_AUTH_ISSUER";
export const AUTH_AUDIENCE_ENV = "SUPPORT_AUTH_AUDIENCE";
export const AUTH_JWKS_URL_ENV = "SUPPORT_AUTH_JWKS_URL";
export const AUTH_CLOCK_TOLERANCE_ENV = "SUPPORT_AUTH_CLOCK_TOLERANCE_S";

/**
 * The only value that re-enables trusted `x-user-*` header auth. The name is
 * deliberately alarming: header identity is forgeable by anything that can
 * reach the API socket, so this mode must never be set in production.
 */
export const INSECURE_HEADER_AUTH_MODE = "insecure-headers";

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;
const MAX_CLOCK_TOLERANCE_SECONDS = 300;

export interface JwtAuthConfig {
  readonly mode: "jwt";
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  readonly clockToleranceSeconds: number;
}

export interface InsecureHeaderAuthConfig {
  readonly mode: "insecure-headers";
}

export type AuthConfig = JwtAuthConfig | InsecureHeaderAuthConfig;

/**
 * Loads the auth mode from the environment. JWT is the default and requires
 * issuer + audience — a JWT-mode deployment missing either fails fast at
 * boot instead of silently degrading to header trust (acceptance criterion:
 * no endpoint trusts unverified headers when production auth is on).
 */
export function loadAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const mode = env[AUTH_MODE_ENV]?.trim() || "jwt";

  if (mode === INSECURE_HEADER_AUTH_MODE) {
    return { mode: "insecure-headers" };
  }

  if (mode !== "jwt") {
    throw new Error(
      `${AUTH_MODE_ENV} must be "jwt" or "${INSECURE_HEADER_AUTH_MODE}"; got "${mode}".`,
    );
  }

  const issuer = env[AUTH_ISSUER_ENV]?.trim();
  const audience = env[AUTH_AUDIENCE_ENV]?.trim();

  if (!issuer || !audience) {
    throw new Error(
      `JWT auth requires ${AUTH_ISSUER_ENV} and ${AUTH_AUDIENCE_ENV}. ` +
        `Set both, or explicitly opt into ${AUTH_MODE_ENV}=${INSECURE_HEADER_AUTH_MODE} for local/test use.`,
    );
  }

  const jwksUrl =
    env[AUTH_JWKS_URL_ENV]?.trim() ||
    `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;

  try {
    new URL(jwksUrl);
  } catch {
    throw new Error(`${AUTH_JWKS_URL_ENV} is not a valid URL: "${jwksUrl}".`);
  }

  const clockToleranceRaw = env[AUTH_CLOCK_TOLERANCE_ENV]?.trim();
  const clockToleranceSeconds = clockToleranceRaw
    ? Number(clockToleranceRaw)
    : DEFAULT_CLOCK_TOLERANCE_SECONDS;

  if (
    !Number.isInteger(clockToleranceSeconds) ||
    clockToleranceSeconds < 0 ||
    clockToleranceSeconds > MAX_CLOCK_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `${AUTH_CLOCK_TOLERANCE_ENV} must be an integer between 0 and ` +
        `${MAX_CLOCK_TOLERANCE_SECONDS}; got "${clockToleranceRaw}".`,
    );
  }

  return { mode: "jwt", issuer, audience, jwksUrl, clockToleranceSeconds };
}

/** Identity claims extracted from a cryptographically verified token. */
export interface VerifiedIdentity {
  readonly subject: string;
  readonly email?: string;
}

export interface TokenVerifier {
  /**
   * Verifies signature, issuer, audience, and expiry (with the configured
   * clock tolerance). Every failure maps to the same 401 so responses leak
   * nothing about which check rejected the token.
   */
  verify(token: string): Promise<VerifiedIdentity>;
}

/**
 * JWKS-backed verifier. `createRemoteJWKSet` caches the key set and refetches
 * it (rate-limited by `cooldownDuration`) when a token presents an unknown
 * `kid`, so IdP key rotation needs no restart or config change.
 */
export function createJwksTokenVerifier(config: JwtAuthConfig): TokenVerifier {
  const getKey: JWTVerifyGetKey = createRemoteJWKSet(new URL(config.jwksUrl), {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });

  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, getKey, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ["RS256"],
          clockTolerance: config.clockToleranceSeconds,
        });

        // jose validates `exp` only when present; a token without an expiry
        // must never authenticate.
        if (typeof payload.exp !== "number" || !payload.sub) {
          throw new Error("token missing exp or sub");
        }

        return {
          subject: payload.sub,
          ...(typeof payload.email === "string" && payload.email.length > 0
            ? { email: payload.email }
            : {}),
        };
      } catch {
        throw unauthorized();
      }
    },
  };
}

/**
 * A platform user resolved during authentication. `tenantId === null` marks
 * a platform-level user (member of every tenant); otherwise membership is
 * exactly the user's own tenant. Roles are DB-sourced.
 */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly email?: string;
  readonly tenantId: string | null;
  readonly roles: readonly RoleName[];
}

export interface UserDirectory {
  /**
   * Maps a verified IdP subject to the platform user. Returns null for an
   * unknown subject or a non-`active` user — both authenticate as 401, so a
   * valid IdP account with no provisioned platform user gains nothing.
   */
  findByIdpSubject(subject: string): Promise<AuthenticatedUser | null>;
  close?(): Promise<void>;
}

/**
 * Database-backed user directory. Runs on the owner connection deliberately:
 * authentication happens before tenant selection, and platform-level users
 * (NULL tenant_id) would be invisible under the tenant-scoped RLS role.
 */
export function createDatabaseUserDirectory(): UserDirectory {
  let database: ReturnType<typeof createDatabaseFromEnv> | undefined;

  function getDatabase(): ReturnType<typeof createDatabaseFromEnv> {
    if (!database) {
      database = createDatabaseFromEnv();
    }

    return database;
  }

  return {
    async findByIdpSubject(subject) {
      const rows = await userByIdpSubjectQuery(getDatabase().db, subject);
      const user = rows[0];

      if (!user || user.status !== "active") {
        return null;
      }

      const grants = await userRoleGrantsQuery(getDatabase().db, user.userId);
      const roles: RoleName[] = [];

      for (const grant of grants) {
        // A grant applies globally (NULL tenant) or within the user's home
        // tenant. `internal_service` is machine-only and can never be a
        // user grant, however the row got there.
        if (
          grant.grantTenantId !== null &&
          grant.grantTenantId !== user.tenantId
        ) {
          continue;
        }

        const parsed = RoleNameSchema.safeParse(grant.roleName);

        if (parsed.success && parsed.data !== "internal_service") {
          roles.push(parsed.data);
        }
      }

      return {
        userId: user.userId,
        ...(user.email ? { email: user.email } : {}),
        tenantId: user.tenantId,
        roles,
      };
    },
    async close() {
      await database?.client.end();
    },
  };
}

function unauthorized(): HttpError {
  return new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
}
