import { z } from "zod";
import type { RawInboundEmail } from "./email-adapter.js";

/**
 * Mailgun inbound-route payloads (BACKEND_SPEC section 6: channel intake).
 *
 * `RawInboundEmailSchema` is deliberately provider-neutral — its own docstring
 * calls it "the shape a webhook handler produces after extracting the fields".
 * This module is that extraction step for Mailgun, which was specified but
 * never written: Mailgun's inbound routes POST flat form fields with their own
 * names and a Unix-seconds timestamp, none of which match the neutral schema.
 *
 * Two Mailgun surfaces are handled here and they are NOT the same shape:
 *
 *  - inbound ROUTES (a received email) POST `application/x-www-form-urlencoded`,
 *    switching to `multipart/form-data` when the mail carries attachments, and
 *    carry the signing triplet as FLAT top-level fields; and
 *  - event/tracking webhooks (delivered, bounced, complained) POST JSON with
 *    the triplet NESTED under `signature`.
 *
 * Only the first is an inbound message. `extractMailgunSignatureFields` accepts
 * both so signature verification is correct on either, but a tracking event will
 * (correctly) fail to map to an inbound message.
 */

/** A file part parsed out of a multipart Mailgun post. Bytes are not retained. */
export interface MailgunInboundFile {
  readonly fieldname: string;
  readonly filename: string;
  readonly content_type: string;
  readonly size_bytes: number;
}

export interface MailgunInboundPayload {
  readonly fields: Readonly<Record<string, string>>;
  readonly files?: readonly MailgunInboundFile[];
}

export interface MailgunSignatureFields {
  readonly timestamp: string;
  readonly token: string;
  readonly signature: string;
}

const SignatureTripletSchema = z.object({
  timestamp: z.string().min(1),
  token: z.string().min(1),
  signature: z.string().min(1),
});

/**
 * Pull Mailgun's signing triplet out of whichever envelope it arrived in.
 * Returns null when the payload carries no triplet at all, which callers treat
 * as a verification failure (fail closed).
 */
export function extractMailgunSignatureFields(
  body: unknown,
): MailgunSignatureFields | null {
  if (body === null || typeof body !== "object") {
    return null;
  }

  const candidate = body as Record<string, unknown>;

  // Inbound routes: form fields, surfaced by the form parser as `{ fields }`.
  const formFields = candidate["fields"];
  if (formFields !== undefined) {
    const parsed = SignatureTripletSchema.safeParse(formFields);
    return parsed.success ? parsed.data : null;
  }

  // Event/tracking webhooks: JSON with the triplet nested under `signature`.
  const nested = SignatureTripletSchema.safeParse(candidate["signature"]);
  if (nested.success) {
    return nested.data;
  }

  // JSON carrying the triplet flat at the top level.
  const flat = SignatureTripletSchema.safeParse(candidate);
  return flat.success ? flat.data : null;
}

/**
 * Map a Mailgun inbound-route payload onto the provider-neutral
 * `RawInboundEmail` contract consumed by `parseInboundEmailMessage`.
 *
 * Throws when a field the neutral contract requires cannot be derived. The
 * webhook handler turns any throw here into a 400, so a malformed provider post
 * is a validation error rather than a partially-ingested message.
 *
 * Attachment BYTES are not downloaded or stored — only the metadata the policy
 * gate needs (filename, type, size). Each attachment therefore carries a
 * provider-side placeholder `object_ref`, matching how `whatsapp-adapter`
 * already handles undownloaded media. Binary storage is a Milestone 22 item.
 */
export function mapMailgunInboundToRawEmail(
  payload: MailgunInboundPayload,
): RawInboundEmail {
  const fields = lowercaseKeys(payload.fields);
  const headers = parseMessageHeaders(fields["message-headers"]);

  const messageId = firstNonEmpty(
    stripAngleBrackets(fields["message-id"]),
    stripAngleBrackets(headers.get("message-id")),
  );

  if (!messageId) {
    throw new Error(
      "Mailgun payload is missing a Message-Id; cannot derive a stable external message id.",
    );
  }

  const sender = parseAddress(
    firstNonEmpty(fields["from"], headers.get("from"), fields["sender"]),
  );

  if (!sender) {
    throw new Error("Mailgun payload is missing a usable sender address.");
  }

  const receivedAt = unixSecondsToIso(fields["timestamp"]);

  if (!receivedAt) {
    throw new Error(
      "Mailgun payload is missing a valid Unix-seconds `timestamp`.",
    );
  }

  // Mailgun's `stripped-*` variants have the quoted reply chain and signature
  // block removed. Preferring them keeps the agent's context window free of the
  // entire prior thread on every reply.
  const text = firstNonEmpty(fields["stripped-text"], fields["body-plain"]);
  const html = firstNonEmpty(fields["stripped-html"], fields["body-html"]);

  const inReplyTo = stripAngleBrackets(
    firstNonEmpty(fields["in-reply-to"], headers.get("in-reply-to")),
  );

  const references = parseReferences(
    firstNonEmpty(fields["references"], headers.get("references")),
  );

  const attachments = (payload.files ?? []).map((file) => ({
    filename: file.filename,
    content_type: file.content_type,
    size_bytes: file.size_bytes,
    object_ref: `mailgun-attachment:${messageId}:${file.fieldname}`,
  }));

  return {
    message_id: messageId,
    thread_id: null,
    in_reply_to: inReplyTo ?? null,
    references: references.length > 0 ? references : null,
    from: { email: sender.email, name: sender.name },
    subject: firstNonEmpty(fields["subject"], headers.get("subject")) ?? null,
    text: text ?? null,
    html: html ?? null,
    attachments: attachments.length > 0 ? attachments : null,
    received_at: receivedAt,
  };
}

/**
 * Form field names are case-sensitive on the wire and Mailgun mixes casing
 * (`Message-Id` alongside `body-plain`). Normalize once so every lookup below
 * can use a single lowercase spelling.
 */
function lowercaseKeys(
  fields: Readonly<Record<string, string>>,
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(fields)) {
    normalized[key.toLowerCase()] = value;
  }

  return normalized;
}

/**
 * `message-headers` is a JSON array of `[name, value]` pairs. Mailgun added it
 * precisely because not every framework can express repeated form keys, so it
 * is the reliable source for threading headers. Parsed defensively: a malformed
 * value yields an empty map rather than failing the whole message.
 */
function parseMessageHeaders(raw: string | undefined): Map<string, string> {
  const headers = new Map<string, string>();

  if (!raw) {
    return headers;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return headers;
  }

  if (!Array.isArray(parsed)) {
    return headers;
  }

  for (const entry of parsed) {
    if (
      Array.isArray(entry) &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string"
    ) {
      const name = entry[0].toLowerCase();

      // First occurrence wins; `Received` legitimately repeats.
      if (!headers.has(name)) {
        headers.set(name, entry[1]);
      }
    }
  }

  return headers;
}

function firstNonEmpty(
  ...values: readonly (string | undefined | null)[]
): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function stripAngleBrackets(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

/** `References` is a whitespace-separated list of angle-bracketed message ids. */
function parseReferences(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/\s+/)
    .map((entry) => stripAngleBrackets(entry) ?? "")
    .filter((entry) => entry.length > 0);
}

/** Mailgun's `timestamp` is Unix epoch SECONDS; the neutral schema wants ISO-8601. */
function unixSecondsToIso(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }

  return new Date(seconds * 1000).toISOString();
}

/** Parse `Display Name <addr@host>` or a bare address. */
function parseAddress(
  value: string | undefined,
): { email: string; name: string | null } | null {
  if (!value) {
    return null;
  }

  const angled = /^(.*)<([^>]+)>\s*$/.exec(value);

  if (angled) {
    const email = angled[2]!.trim();

    if (email.length === 0) {
      return null;
    }

    const name = angled[1]!
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .trim();

    return { email, name: name.length > 0 ? name : null };
  }

  return { email: value, name: null };
}
