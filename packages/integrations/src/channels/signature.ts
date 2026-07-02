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
 * Verify a Mailgun webhook signature. Mailgun signs the concatenation of the
 * `timestamp` and `token` values with the account HTTP signing key and sends
 * the hex-encoded HMAC-SHA256 as `signature`.
 */
export function verifyMailgunSignature(params: {
  timestamp: string;
  token: string;
  signature: string;
  signingKey: string;
}): boolean {
  const { timestamp, token, signature, signingKey } = params;

  if (timestamp.length === 0 || token.length === 0) {
    return false;
  }

  return verifyHmacSha256Signature({
    payload: `${timestamp}${token}`,
    secret: signingKey,
    expectedHex: signature,
  });
}
