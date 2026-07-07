import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import {
  AUTH_AUDIENCE_ENV,
  AUTH_CLOCK_TOLERANCE_ENV,
  AUTH_ISSUER_ENV,
  AUTH_JWKS_URL_ENV,
  AUTH_MODE_ENV,
  createJwksTokenVerifier,
  loadAuthConfig,
  type JwtAuthConfig,
  type UserDirectory,
} from "./auth.js";
import { HttpError } from "./errors.js";
import type { ApiServices } from "./services.js";

describe("loadAuthConfig", () => {
  it("defaults to JWT mode and requires issuer + audience", () => {
    expect(() => loadAuthConfig({})).toThrow(/jwt auth requires/i);
    expect(() =>
      loadAuthConfig({ [AUTH_ISSUER_ENV]: "https://idp.test" }),
    ).toThrow(/jwt auth requires/i);
  });

  it("loads a complete JWT config and derives the JWKS URL from the issuer", () => {
    const config = loadAuthConfig({
      [AUTH_ISSUER_ENV]: "https://idp.test",
      [AUTH_AUDIENCE_ENV]: "support-platform-api",
    });

    expect(config).toEqual({
      mode: "jwt",
      issuer: "https://idp.test",
      audience: "support-platform-api",
      jwksUrl: "https://idp.test/.well-known/jwks.json",
      clockToleranceSeconds: 60,
    });
  });

  it("honors an explicit JWKS URL and clock tolerance", () => {
    const config = loadAuthConfig({
      [AUTH_ISSUER_ENV]: "https://idp.test/",
      [AUTH_AUDIENCE_ENV]: "support-platform-api",
      [AUTH_JWKS_URL_ENV]: "https://keys.idp.test/jwks.json",
      [AUTH_CLOCK_TOLERANCE_ENV]: "30",
    });

    expect(config).toMatchObject({
      jwksUrl: "https://keys.idp.test/jwks.json",
      clockToleranceSeconds: 30,
    });
  });

  it("rejects malformed clock tolerance and unknown modes", () => {
    expect(() =>
      loadAuthConfig({
        [AUTH_ISSUER_ENV]: "https://idp.test",
        [AUTH_AUDIENCE_ENV]: "aud",
        [AUTH_CLOCK_TOLERANCE_ENV]: "-5",
      }),
    ).toThrow(/clock_tolerance/i);
    expect(() =>
      loadAuthConfig({
        [AUTH_ISSUER_ENV]: "https://idp.test",
        [AUTH_AUDIENCE_ENV]: "aud",
        [AUTH_CLOCK_TOLERANCE_ENV]: "9000",
      }),
    ).toThrow(/clock_tolerance/i);
    expect(() => loadAuthConfig({ [AUTH_MODE_ENV]: "none" })).toThrow(
      /must be "jwt"/,
    );
  });

  it("enables the trusted-header mode only behind the explicit opt-in", () => {
    expect(loadAuthConfig({ [AUTH_MODE_ENV]: "insecure-headers" })).toEqual({
      mode: "insecure-headers",
    });
  });
});

describe("createJwksTokenVerifier", () => {
  const ISSUER = "https://auth-unit.test";
  const AUDIENCE = "support-platform-api";
  const KEY_ID = "auth-unit-key";

  let privateKey: CryptoKey;
  let jwksServer: Server;
  let config: JwtAuthConfig;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = pair.privateKey;
    const jwk = await exportJWK(pair.publicKey);
    const jwks = JSON.stringify({
      keys: [{ ...jwk, kid: KEY_ID, alg: "RS256", use: "sig" }],
    });

    jwksServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(jwks);
    });
    await new Promise<void>((resolve) =>
      jwksServer.listen(0, "127.0.0.1", resolve),
    );
    const address = jwksServer.address();

    if (address === null || typeof address !== "object") {
      throw new Error("JWKS fixture server did not report a port.");
    }

    config = {
      mode: "jwt",
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUrl: `http://127.0.0.1:${address.port}/jwks.json`,
      clockToleranceSeconds: 60,
    };
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      jwksServer.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function mint(claims: {
    subject?: string;
    email?: string;
    expiresAt?: number;
  }): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT(claims.email ? { email: claims.email } : {})
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(nowSeconds - 5)
      .setExpirationTime(claims.expiresAt ?? nowSeconds + 300);

    if (claims.subject) {
      jwt.setSubject(claims.subject);
    }

    return jwt.sign(privateKey);
  }

  it("returns subject and email for a valid token", async () => {
    const verifier = createJwksTokenVerifier(config);
    const token = await mint({
      subject: "user_clerk_1",
      email: "ops@pilot.example",
    });

    await expect(verifier.verify(token)).resolves.toEqual({
      subject: "user_clerk_1",
      email: "ops@pilot.example",
    });
  });

  it("accepts a token expired within the clock tolerance window", async () => {
    const verifier = createJwksTokenVerifier(config);
    const token = await mint({
      subject: "user_clerk_1",
      expiresAt: Math.floor(Date.now() / 1000) - 30,
    });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      subject: "user_clerk_1",
    });
  });

  it("maps every verification failure to the same 401", async () => {
    const verifier = createJwksTokenVerifier(config);
    const failures = [
      "not-a-jwt",
      await mint({
        subject: "user_clerk_1",
        expiresAt: Math.floor(Date.now() / 1000) - 3600,
      }),
      await mint({}), // no subject
    ];

    for (const token of failures) {
      const rejection = await verifier.verify(token).catch((error) => error);

      expect(rejection).toBeInstanceOf(HttpError);
      expect((rejection as HttpError).statusCode).toBe(401);
      expect((rejection as HttpError).code).toBe("AUTH_REQUIRED");
    }
  });
});

describe("JWT auth request flow", () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function makeDirectory(): UserDirectory {
    return {
      async findByIdpSubject(subject) {
        if (subject === "idp|usr_flow") {
          return {
            userId: "usr_flow",
            email: "flow@pilot.example",
            tenantId: "ten_flow",
            roles: ["support_agent"],
          };
        }

        if (subject === "idp|usr_flow_no_roles") {
          return {
            userId: "usr_flow_no_roles",
            tenantId: "ten_flow",
            roles: [],
          };
        }

        return null;
      },
    };
  }

  function makeFlowApp(verifyResult: () => Promise<{ subject: string }>) {
    return buildApp({
      services: stubServices(),
      auth: {
        mode: "jwt",
        issuer: "https://flow.test",
        audience: "aud",
        jwksUrl: "https://flow.test/jwks.json",
        clockToleranceSeconds: 60,
      },
      tokenVerifier: { verify: verifyResult },
      userDirectory: makeDirectory(),
      internalAuth: null,
    });
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

  it("resolves the actor from the directory and enforces membership", async () => {
    app = makeFlowApp(async () => ({ subject: "idp|usr_flow" }));

    const member = await app.inject({
      method: "GET",
      url: "/v1/tickets",
      headers: {
        authorization: "Bearer token",
        "x-tenant-id": "ten_flow",
      },
    });
    // Membership + permission pass; the stub service then 500s — the point
    // is that auth does not reject.
    expect(member.statusCode).not.toBe(401);
    expect(member.statusCode).not.toBe(403);

    const nonMember = await app.inject({
      method: "GET",
      url: "/v1/tickets",
      headers: {
        authorization: "Bearer token",
        "x-tenant-id": "ten_other",
      },
    });
    expect(nonMember.statusCode).toBe(403);
  });

  it("treats a user with no role grants as authenticated but unauthorized", async () => {
    app = makeFlowApp(async () => ({ subject: "idp|usr_flow_no_roles" }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets",
      headers: {
        authorization: "Bearer token",
        "x-tenant-id": "ten_flow",
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns 401 when the verified subject has no platform user", async () => {
    app = makeFlowApp(async () => ({ subject: "idp|usr_unprovisioned" }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets",
      headers: {
        authorization: "Bearer token",
        "x-tenant-id": "ten_flow",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("keeps health endpoints public under JWT auth", async () => {
    // Webhook signature auth (bearer-exempt) is covered in webhooks.test.ts;
    // here the verifier rejects everything, so a public 200 proves the
    // health path never consults it.
    app = makeFlowApp(async () => {
      throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);

    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
  });
});
