import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadAuthConfig, type UserDirectory } from "./auth.js";
import type { ApiServices } from "./services.js";

/**
 * Opt-in live smoke against the real Clerk dev instance (Milestone 16,
 * ADR-0024): mints a real session token through the Clerk Backend API and
 * verifies it through the production JWKS verifier — network, key rotation
 * caching, and the dashboard session-token customization (`aud` + `email`
 * claims) all real. Costs nothing but requires the user-owned secret key:
 *
 *   RUN_CLERK_LIVE_TESTS=true \
 *   CLERK_SECRET_KEY=... \
 *   SUPPORT_AUTH_ISSUER=https://<instance>.clerk.accounts.dev \
 *   SUPPORT_AUTH_AUDIENCE=support-platform-api \
 *   CLERK_TEST_USER_ID=user_... \
 *   pnpm --filter @support/api exec vitest run src/auth.clerk-live.integration.test.ts
 */
const describeLive =
  process.env.RUN_CLERK_LIVE_TESTS === "true" &&
  process.env.CLERK_SECRET_KEY &&
  process.env.SUPPORT_AUTH_ISSUER &&
  process.env.SUPPORT_AUTH_AUDIENCE
    ? describe
    : describe.skip;

const CLERK_API = "https://api.clerk.com/v1";

async function clerkRequest(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${CLERK_API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Clerk API ${path} failed: ${response.status} ${await response.text()}`,
    );
  }

  return (await response.json()) as Record<string, unknown>;
}

async function resolveTestUserId(): Promise<string> {
  if (process.env.CLERK_TEST_USER_ID) {
    return process.env.CLERK_TEST_USER_ID;
  }

  const response = await fetch(`${CLERK_API}/users?limit=1`, {
    headers: { authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
  });

  if (!response.ok) {
    throw new Error(`Clerk user list failed: ${response.status}`);
  }

  const usersList = (await response.json()) as Array<{ id: string }>;
  const first = usersList[0];

  if (!first) {
    throw new Error("Clerk instance has no users to mint a session for.");
  }

  return first.id;
}

async function mintClerkSessionToken(): Promise<{
  token: string;
  subject: string;
}> {
  const subject = await resolveTestUserId();
  const session = await clerkRequest("/sessions", { user_id: subject });
  const minted = await clerkRequest(
    `/sessions/${session.id as string}/tokens`,
    {
      expires_in_seconds: 300,
    },
  );

  return { token: minted.jwt as string, subject };
}

function stubServices(): ApiServices {
  const domainStub = new Proxy({}, { get: () => async () => undefined });

  return new Proxy(
    {},
    {
      get: (_target, property) =>
        property === "close" ? undefined : domainStub,
    },
  ) as unknown as ApiServices;
}

describeLive("live Clerk JWT verification", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("verifies a real Clerk session token via the production JWKS path", async () => {
    const { token, subject } = await mintClerkSessionToken();

    const userDirectory: UserDirectory = {
      async findByIdpSubject(presented) {
        if (presented !== subject) {
          return null;
        }

        return {
          userId: "usr_clerk_live",
          tenantId: "ten_clerk_live",
          roles: ["ops_admin"],
        };
      },
    };

    app = buildApp({
      services: stubServices(),
      auth: loadAuthConfig(),
      userDirectory,
      internalAuth: null,
    });

    const authenticated = await app.inject({
      method: "GET",
      url: "/v1/policies",
      headers: {
        authorization: `Bearer ${token}`,
        "x-tenant-id": "ten_clerk_live",
      },
    });

    // Auth passed (the stub service then fails schema validation — anything
    // but 401/403 proves the real token verified against the real JWKS).
    expect(authenticated.statusCode).not.toBe(401);
    expect(authenticated.statusCode).not.toBe(403);

    const nonMember = await app.inject({
      method: "GET",
      url: "/v1/policies",
      headers: {
        authorization: `Bearer ${token}`,
        "x-tenant-id": "ten_other",
      },
    });
    expect(nonMember.statusCode).toBe(403);

    const tampered = await app.inject({
      method: "GET",
      url: "/v1/policies",
      headers: {
        authorization: `Bearer ${token.slice(0, -4)}AAAA`,
        "x-tenant-id": "ten_clerk_live",
      },
    });
    expect(tampered.statusCode).toBe(401);
  }, 30_000);
});
