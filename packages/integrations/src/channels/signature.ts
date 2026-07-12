import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an HMAC-SHA256 signature over a raw payload using a timing-safe
 * comparison. `expectedHex` is the hex-encoded signature supplied by the
 * provider. Returns false (never throws) for malformed or mismatched
 * signatures so callers can reject bad webhooks uniformly.
 */
export function verifyHmacSha256Signature(params: {
  payload: string | Buffer;
  secret: string;
  expectedHex: string;
}): boolean {
  const { payload, secret, expectedHex } = params;

  if (secret.length === 0 || expectedHex.length === 0) {
    return false;
  }

  const computed = createHmac("sha256", secret).update(payload).digest();
  const provided = Buffer.from(expectedHex, "hex");

  if (provided.length !== computed.length) {
    return false;
  }

  return timingSafeEqual(computed, provided);
}

/**
 * Verify a WhatsApp Cloud API webhook signature. Meta signs the raw request
 * body with the app secret and sends it in the `X-Hub-Signature-256` header as
 * `sha256=<hex>`.
 */
export function verifyWhatsAppCloudSignature(params: {
  rawBody: string | Buffer;
  appSecret: string;
  signatureHeader: string | null | undefined;
}): boolean {
  const header = params.signatureHeader ?? "";
  const prefix = "sha256=";

  if (!header.startsWith(prefix)) {
    return false;
  }

  return verifyHmacSha256Signature({
    payload: params.rawBody,
    secret: params.appSecret,
    expectedHex: header.slice(prefix.length),
  });
}

/**
 * Mailgun signs a timestamp but does not itself reject stale requests — the
 * receiver is responsible for bounding the replay window. Five minutes bounds
 * how long a captured signed request stays usable while tolerating ordinary
 * clock skew between Mailgun and this host.
 */
export const MAILGUN_DEFAULT_MAX_SIGNATURE_AGE_SECONDS = 300;

/**
 * Verify a Mailgun webhook signature. Mailgun signs the concatenation of the
 * `timestamp` and `token` values with the account HTTP signing key and sends
 * the hex-encoded HMAC-SHA256 as `signature`.
 *
 * Pass `maxAgeSeconds` to additionally reject a signature whose timestamp is
 * outside the replay window. The check is two-sided: a far-future timestamp is
 * rejected as well, so a forged clock cannot buy an attacker an indefinitely
 * valid capture.
 */
export function verifyMailgunSignature(params: {
  timestamp: string;
  token: string;
  signature: string;
  signingKey: string;
  maxAgeSeconds?: number;
  /** Injectable clock; defaults to the wall clock. */
  nowMs?: number;
}): boolean {
  const { timestamp, token, signature, signingKey, maxAgeSeconds } = params;

  if (timestamp.length === 0 || token.length === 0) {
    return false;
  }

  if (
    maxAgeSeconds !== undefined &&
    !isMailgunTimestampFresh(
      timestamp,
      maxAgeSeconds,
      params.nowMs ?? Date.now(),
    )
  ) {
    return false;
  }

  return verifyHmacSha256Signature({
    payload: `${timestamp}${token}`,
    secret: signingKey,
    expectedHex: signature,
  });
}

/**
 * Mailgun's `timestamp` is Unix epoch SECONDS. A non-numeric value fails closed
 * rather than coercing to NaN and slipping through a comparison.
 */
function isMailgunTimestampFresh(
  timestamp: string,
  maxAgeSeconds: number,
  nowMs: number,
): boolean {
  const seconds = Number(timestamp);

  if (!Number.isFinite(seconds)) {
    return false;
  }

  return Math.abs(nowMs / 1000 - seconds) <= maxAgeSeconds;
}
