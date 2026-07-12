import { Readable } from "node:stream";
import busboy from "busboy";
import type { IncomingHttpHeaders } from "node:http";

/**
 * Form-encoded request body parsing for provider webhooks.
 *
 * The API otherwise speaks JSON, but inbound-email providers do not: Mailgun's
 * inbound routes POST `application/x-www-form-urlencoded`, switching to
 * `multipart/form-data` when the received mail carries attachments. Without a
 * parser for both, Fastify answers 415 to every real delivery.
 *
 * Both parsers preserve the exact request bytes on `request.rawBody`: the raw
 * payload is archived to the `RawPayloadStore`, and the generic HMAC-over-body
 * signature scheme (and WhatsApp's) verifies against those bytes. Mailgun's own
 * signature is computed over `timestamp + token` rather than the body, so it
 * does not depend on this — but the archive does.
 *
 * Attachment BYTES are deliberately drained, not retained: attachment binary
 * storage is a Milestone 22 item. Only the metadata the attachment policy gates
 * on (filename, content type, size) is captured.
 */

export interface ParsedFormFile {
  readonly fieldname: string;
  readonly filename: string;
  readonly content_type: string;
  readonly size_bytes: number;
}

export interface ParsedFormBody {
  readonly fields: Record<string, string>;
  readonly files: readonly ParsedFormFile[];
}

export interface FormBodyLimits {
  /**
   * Per-file ceiling. A file exceeding it is reported with a size ABOVE the
   * limit rather than truncated-and-undersized, so the downstream attachment
   * policy rejects it instead of being fooled by a clipped byte count.
   */
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxFields: number;
  readonly maxFieldBytes: number;
}

export const DEFAULT_FORM_BODY_LIMITS: FormBodyLimits = {
  // Matches DEFAULT_ATTACHMENT_VALIDATION_POLICY.maxSizeBytes.
  maxFileBytes: 10 * 1024 * 1024,
  maxFiles: 10,
  maxFields: 64,
  maxFieldBytes: 1024 * 1024,
};

export function isParsedFormBody(value: unknown): value is ParsedFormBody {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as { fields?: unknown; files?: unknown };

  return (
    typeof candidate.fields === "object" &&
    candidate.fields !== null &&
    Array.isArray(candidate.files)
  );
}

/**
 * Parse `application/x-www-form-urlencoded`. Repeated keys resolve last-wins;
 * Mailgun ships repeated header data in its JSON `message-headers` field
 * precisely because form encoding cannot express them portably.
 */
export function parseUrlEncodedFormBody(body: Buffer): ParsedFormBody {
  const params = new URLSearchParams(body.toString("utf8"));
  const fields: Record<string, string> = {};

  for (const [key, value] of params) {
    fields[key] = value;
  }

  return { fields, files: [] };
}

export async function parseMultipartFormBody(
  headers: IncomingHttpHeaders,
  body: Buffer,
  limits: FormBodyLimits = DEFAULT_FORM_BODY_LIMITS,
): Promise<ParsedFormBody> {
  return new Promise((resolve, reject) => {
    let parser: busboy.Busboy;

    try {
      parser = busboy({
        headers,
        limits: {
          fileSize: limits.maxFileBytes,
          files: limits.maxFiles,
          fields: limits.maxFields,
          fieldSize: limits.maxFieldBytes,
        },
      });
    } catch (error) {
      // A missing or malformed boundary lands here.
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const fields: Record<string, string> = {};
    const files: ParsedFormFile[] = [];

    parser.on("field", (name, value) => {
      fields[name] = value;
    });

    parser.on("file", (name, stream, info) => {
      let sizeBytes = 0;
      let truncated = false;

      stream.on("data", (chunk: Buffer) => {
        sizeBytes += chunk.length;
      });

      stream.on("limit", () => {
        truncated = true;
      });

      stream.on("end", () => {
        files.push({
          fieldname: name,
          filename: info.filename ?? name,
          content_type: info.mimeType ?? "application/octet-stream",
          // Report an over-limit size for a truncated file. Reporting the
          // clipped count would let an oversized attachment read as exactly at
          // the limit and pass the size gate.
          size_bytes: truncated ? limits.maxFileBytes + 1 : sizeBytes,
        });
      });

      // We never persist the bytes; drain so the parser can finish.
      stream.resume();
    });

    parser.on("close", () => {
      resolve({ fields, files });
    });

    parser.on("error", (error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });

    Readable.from(body).pipe(parser);
  });
}
