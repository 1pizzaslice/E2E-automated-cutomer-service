import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifyHmacSha256Signature,
  verifyMailgunSignature,
  verifyWhatsAppCloudSignature,
  MAILGUN_DEFAULT_MAX_SIGNATURE_AGE_SECONDS,
} from "./signature.js";

function hmacHex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

describe("verifyHmacSha256Signature", () => {
  it("accepts a matching signature", () => {
    expect(
      verifyHmacSha256Signature({
        payload: "payload",
        secret: "secret",
        expectedHex: hmacHex("payload", "secret"),
      }),
    ).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    expect(
      verifyHmacSha256Signature({
        payload: "payload",
        secret: "secret",
        expectedHex: hmacHex("payload", "other-secret"),
      }),
    ).toBe(false);
  });

  it("rejects malformed, empty, or wrong-length signatures", () => {
    expect(
      verifyHmacSha256Signature({
        payload: "payload",
        secret: "secret",
        expectedHex: "not-hex",
      }),
    ).toBe(false);
    expect(
      verifyHmacSha256Signature({
        payload: "payload",
        secret: "secret",
        expectedHex: "",
      }),
    ).toBe(false);
    expect(
      verifyHmacSha256Signature({
        payload: "payload",
        secret: "",
        expectedHex: hmacHex("payload", "secret"),
      }),
    ).toBe(false);
  });
});

describe("verifyWhatsAppCloudSignature", () => {
  const rawBody = JSON.stringify({ object: "whatsapp_business_account" });
  const appSecret = "app-secret";

  it("accepts a valid X-Hub-Signature-256 header", () => {
    expect(
      verifyWhatsAppCloudSignature({
        rawBody,
        appSecret,
        signatureHeader: `sha256=${hmacHex(rawBody, appSecret)}`,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(
      verifyWhatsAppCloudSignature({
        rawBody: `${rawBody} tampered`,
        appSecret,
        signatureHeader: `sha256=${hmacHex(rawBody, appSecret)}`,
      }),
    ).toBe(false);
  });

  it("rejects a header without the sha256 prefix or a missing header", () => {
    expect(
      verifyWhatsAppCloudSignature({
        rawBody,
        appSecret,
        signatureHeader: hmacHex(rawBody, appSecret),
      }),
    ).toBe(false);
    expect(
      verifyWhatsAppCloudSignature({
        rawBody,
        appSecret,
        signatureHeader: null,
      }),
    ).toBe(false);
  });
});

describe("verifyMailgunSignature", () => {
  const signingKey = "signing-key";
  const timestamp = "1718668800";
  const token = "token-value";

  it("accepts a valid timestamp/token signature", () => {
    expect(
      verifyMailgunSignature({
        timestamp,
        token,
        signature: hmacHex(`${timestamp}${token}`, signingKey),
        signingKey,
      }),
    ).toBe(true);
  });

  it("rejects a replayed token with a stale signature", () => {
    expect(
      verifyMailgunSignature({
        timestamp,
        token: "different-token",
        signature: hmacHex(`${timestamp}${token}`, signingKey),
        signingKey,
      }),
    ).toBe(false);
  });

  it("rejects empty timestamp or token", () => {
    expect(
      verifyMailgunSignature({
        timestamp: "",
        token,
        signature: hmacHex(`${timestamp}${token}`, signingKey),
        signingKey,
      }),
    ).toBe(false);
  });

  describe("replay window", () => {
    // Mailgun signs a timestamp but never rejects a stale post itself; the
    // receiver bounds how long a captured signed request stays usable.
    const nowMs = Number(timestamp) * 1000;

    function verifyAt(offsetSeconds: number): boolean {
      const stamp = String(Number(timestamp) + offsetSeconds);

      return verifyMailgunSignature({
        timestamp: stamp,
        token,
        signature: hmacHex(`${stamp}${token}`, signingKey),
        signingKey,
        maxAgeSeconds: MAILGUN_DEFAULT_MAX_SIGNATURE_AGE_SECONDS,
        nowMs,
      });
    }

    it("accepts a fresh, correctly signed request", () => {
      expect(verifyAt(0)).toBe(true);
      expect(verifyAt(-60)).toBe(true);
    });

    it("rejects a correctly signed request that is outside the window", () => {
      expect(verifyAt(-(MAILGUN_DEFAULT_MAX_SIGNATURE_AGE_SECONDS + 1))).toBe(
        false,
      );
    });

    it("rejects a far-future timestamp, so a forged clock buys nothing", () => {
      expect(verifyAt(MAILGUN_DEFAULT_MAX_SIGNATURE_AGE_SECONDS + 1)).toBe(
        false,
      );
    });

    it("fails closed on a non-numeric timestamp rather than coercing to NaN", () => {
      expect(
        verifyMailgunSignature({
          timestamp: "not-a-number",
          token,
          signature: hmacHex(`not-a-number${token}`, signingKey),
          signingKey,
          maxAgeSeconds: MAILGUN_DEFAULT_MAX_SIGNATURE_AGE_SECONDS,
          nowMs,
        }),
      ).toBe(false);
    });

    it("skips the freshness check when no window is configured", () => {
      expect(
        verifyMailgunSignature({
          timestamp,
          token,
          signature: hmacHex(`${timestamp}${token}`, signingKey),
          signingKey,
          nowMs: nowMs + 10 * 365 * 24 * 3600 * 1000,
        }),
      ).toBe(true);
    });
  });
});
