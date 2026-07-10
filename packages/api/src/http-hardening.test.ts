import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadCorsConfig } from "./cors.js";
import { loadRateLimitConfig } from "./rate-limit.js";
import type { ApiServices } from "./services.js";

// CORS and rate limiting sit in front of the routes; these suites only need an
// authenticated v1 route to reach, so they use the explicit insecure-header
// mode and a stub that returns 404 (auth still passes, which is all the
// limiter counts).
process.env.SUPPORT_AUTH_MODE = "insecure-headers";

const authHeaders = {
  authorization: "Bearer test-token",
  "x-user-id": "usr_test",
  "x-user-roles": "support_agent",
  "x-tenant-id": "ten_test",
};

const stubServices = {
  customers: {
    async getById() {
      return null;
    },
  },
} as unknown as ApiServices;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("loadCorsConfig", () => {
  it("is off when no origins are configured", () => {
    expect(loadCorsConfig({})).toBeUndefined();
    expect(
      loadCorsConfig({ SUPPORT_CORS_ALLOWED_ORIGINS: "  ,  " }),
    ).toBeUndefined();
  });

  it("parses a comma-separated allowlist and credentials flag", () => {
    expect(
      loadCorsConfig({
        SUPPORT_CORS_ALLOWED_ORIGINS: "https://a.test, https://b.test",
        SUPPORT_CORS_ALLOW_CREDENTIALS: "true",
      }),
    ).toEqual({
      allowedOrigins: ["https://a.test", "https://b.test"],
      allowCredentials: true,
    });
  });

  it("rejects the wildcard origin", () => {
    expect(() => loadCorsConfig({ SUPPORT_CORS_ALLOWED_ORIGINS: "*" })).toThrow(
      /wildcard/,
    );
  });
});

describe("CORS", () => {
  it("emits no CORS headers when unconfigured", async () => {
    app = buildApp({ services: stubServices, cors: null });
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://console.example.test" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reflects an allowed origin and withholds it from others", async () => {
    app = buildApp({
      services: stubServices,
      cors: {
        allowedOrigins: ["https://console.example.test"],
        allowCredentials: false,
      },
    });

    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://console.example.test" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://console.example.test",
    );

    const denied = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example.test" },
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers a browser preflight for an allowed origin without auth", async () => {
    app = buildApp({
      services: stubServices,
      cors: {
        allowedOrigins: ["https://console.example.test"],
        allowCredentials: false,
      },
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/approvals",
      headers: {
        origin: "https://console.example.test",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization,x-tenant-id",
      },
    });

    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://console.example.test",
    );
    expect(response.headers["access-control-allow-methods"]).toContain("GET");
  });
});

describe("loadRateLimitConfig", () => {
  it("is off unless explicitly enabled", () => {
    expect(loadRateLimitConfig({})).toBeUndefined();
    expect(
      loadRateLimitConfig({ SUPPORT_RATE_LIMIT_ENABLED: "false" }),
    ).toBeUndefined();
  });

  it("reads limits and the Redis url when enabled", () => {
    expect(
      loadRateLimitConfig({
        SUPPORT_RATE_LIMIT_ENABLED: "true",
        SUPPORT_RATE_LIMIT_MAX: "10",
        SUPPORT_RATE_LIMIT_WINDOW_MS: "1000",
        REDIS_URL: "redis://localhost:6379",
      }),
    ).toEqual({ max: 10, windowMs: 1000, redisUrl: "redis://localhost:6379" });
  });

  it("fails fast on a non-positive limit", () => {
    expect(() =>
      loadRateLimitConfig({
        SUPPORT_RATE_LIMIT_ENABLED: "true",
        SUPPORT_RATE_LIMIT_MAX: "0",
      }),
    ).toThrow(/positive integer/);
  });
});

describe("rate limiting", () => {
  it("limits per authenticated principal and isolates other principals", async () => {
    app = buildApp({
      services: stubServices,
      rateLimit: { max: 2, windowMs: 60_000 },
    });

    const hit = (userId: string) =>
      app!.inject({
        method: "GET",
        url: "/v1/customers/missing",
        headers: { ...authHeaders, "x-user-id": userId },
      });

    const first = await hit("usr_a");
    const second = await hit("usr_a");
    const third = await hit("usr_a");

    expect(first.statusCode).not.toBe(429);
    expect(second.statusCode).not.toBe(429);
    expect(third.statusCode).toBe(429);

    // A different principal has its own budget — proves the key generator saw
    // the authenticated actor (set by an earlier hook), not just the shared IP.
    const otherPrincipal = await hit("usr_b");
    expect(otherPrincipal.statusCode).not.toBe(429);
  });

  it("exempts health probes from the limit", async () => {
    app = buildApp({
      services: stubServices,
      rateLimit: { max: 1, windowMs: 60_000 },
    });

    for (let i = 0; i < 3; i += 1) {
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
    }
  });
});
