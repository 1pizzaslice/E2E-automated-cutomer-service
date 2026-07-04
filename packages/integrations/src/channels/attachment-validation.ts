import type { NormalizedInboundAttachment } from "@support/shared-schemas";

/**
 * Inbound attachment validation (PLAN section 13: attachment size/type
 * validation). Pure and provider-neutral: the intake service applies it to
 * every normalized inbound message before persistence, so all ingress paths
 * (webhooks today, polling later) share one gate. A `null` size is allowed —
 * providers like WhatsApp only report size on download — and is re-checked
 * when binaries are actually fetched (attachment binary storage is a
 * Milestone 6 follow-up).
 */
export interface AttachmentValidationPolicy {
  readonly maxSizeBytes: number;
  readonly allowedContentTypes: readonly string[];
  readonly maxAttachmentsPerMessage: number;
}

export const DEFAULT_ATTACHMENT_VALIDATION_POLICY: AttachmentValidationPolicy =
  {
    maxSizeBytes: 10 * 1024 * 1024,
    allowedContentTypes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/heic",
      "application/pdf",
      "text/plain",
      "text/csv",
      "audio/ogg",
      "audio/mpeg",
      "audio/mp4",
      "video/mp4",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    maxAttachmentsPerMessage: 10,
  };

export type AttachmentRejectionReason =
  | "attachment_too_large"
  | "attachment_type_not_allowed"
  | "attachment_filename_invalid"
  | "too_many_attachments";

export type AttachmentValidationResult =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reasonCode: AttachmentRejectionReason;
      readonly detail: string;
    };

const MAX_FILENAME_LENGTH = 255;
const FILENAME_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function normalizeContentType(contentType: string): string {
  const [mediaType] = contentType.split(";");
  return (mediaType ?? "").trim().toLowerCase();
}

function isFilenameSafe(filename: string): boolean {
  if (filename.length === 0 || filename.length > MAX_FILENAME_LENGTH) {
    return false;
  }

  if (filename.includes("/") || filename.includes("\\")) {
    return false;
  }

  if (filename === "." || filename === ".." || filename.startsWith("..")) {
    return false;
  }

  return !FILENAME_CONTROL_CHARS.test(filename);
}

export function validateInboundAttachment(
  attachment: NormalizedInboundAttachment,
  policy: AttachmentValidationPolicy = DEFAULT_ATTACHMENT_VALIDATION_POLICY,
): AttachmentValidationResult {
  if (!isFilenameSafe(attachment.filename)) {
    return {
      valid: false,
      reasonCode: "attachment_filename_invalid",
      detail: "Attachment filename contains unsafe characters.",
    };
  }

  const contentType = normalizeContentType(attachment.content_type);
  if (!policy.allowedContentTypes.includes(contentType)) {
    return {
      valid: false,
      reasonCode: "attachment_type_not_allowed",
      detail: `Attachment content type is not allowed: ${contentType || "unknown"}.`,
    };
  }

  if (
    attachment.size_bytes !== null &&
    attachment.size_bytes > policy.maxSizeBytes
  ) {
    return {
      valid: false,
      reasonCode: "attachment_too_large",
      detail: `Attachment exceeds the ${policy.maxSizeBytes} byte limit.`,
    };
  }

  return { valid: true };
}

export function validateInboundAttachments(
  attachments: readonly NormalizedInboundAttachment[],
  policy: AttachmentValidationPolicy = DEFAULT_ATTACHMENT_VALIDATION_POLICY,
): AttachmentValidationResult {
  if (attachments.length > policy.maxAttachmentsPerMessage) {
    return {
      valid: false,
      reasonCode: "too_many_attachments",
      detail: `Message exceeds the ${policy.maxAttachmentsPerMessage} attachment limit.`,
    };
  }

  for (const attachment of attachments) {
    const result = validateInboundAttachment(attachment, policy);
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
}
