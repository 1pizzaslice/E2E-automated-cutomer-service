import { describe, expect, it } from "vitest";
import {
  createEnvSecretResolver,
  createStaticSecretResolver,
  isValidSecretRef,
} from "./secrets.js";

describe("integration secret handling", () => {
  it("accepts environment-variable-shaped references only", () => {
    expect(isValidSecretRef("MAILGUN_API_KEY")).toBe(true);
    expect(isValidSecretRef("PILOT_MAILGUN_SIGNING_KEY")).toBe(true);
    expect(isValidSecretRef("A")).toBe(true);

    expect(isValidSecretRef("")).toBe(false);
    expect(isValidSecretRef("lowercase_ref")).toBe(false);
    expect(isValidSecretRef("1LEADING_DIGIT")).toBe(false);
    expect(isValidSecretRef("PATH/TRAVERSAL")).toBe(false);
    expect(isValidSecretRef("WITH SPACE")).toBe(false);
    expect(isValidSecretRef("key-abc123")).toBe(false);
  });

  it("resolves configured references from the environment", async () => {
    const resolver = createEnvSecretResolver({
      MAILGUN_API_KEY: "key-secret-value",
      EMPTY_VALUE: "",
    });

    await expect(resolver.resolve("MAILGUN_API_KEY")).resolves.toBe(
      "key-secret-value",
    );
    await expect(resolver.resolve("EMPTY_VALUE")).resolves.toBeNull();
    await expect(resolver.resolve("MISSING_VALUE")).resolves.toBeNull();
  });

  it("refuses to resolve malformed references without touching the environment", async () => {
    const resolver = createEnvSecretResolver(
      new Proxy(
        {},
        {
          get() {
            throw new Error("environment must not be read for invalid refs");
          },
        },
      ) as NodeJS.ProcessEnv,
    );

    await expect(resolver.resolve("../etc/passwd")).resolves.toBeNull();
    await expect(resolver.resolve("lowercase")).resolves.toBeNull();
    await expect(resolver.resolve("")).resolves.toBeNull();
  });

  it("provides a validating in-memory resolver for tests", async () => {
    const resolver = createStaticSecretResolver({
      WEBHOOK_SECRET_REF: "signing-secret",
    });

    await expect(resolver.resolve("WEBHOOK_SECRET_REF")).resolves.toBe(
      "signing-secret",
    );
    await expect(resolver.resolve("missing_lowercase")).resolves.toBeNull();
    await expect(resolver.resolve("OTHER_REF")).resolves.toBeNull();
  });
});
