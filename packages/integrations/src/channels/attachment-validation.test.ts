import { describe, expect, it } from "vitest";
import type { NormalizedInboundAttachment } from "@support/shared-schemas";
import {
  DEFAULT_ATTACHMENT_VALIDATION_POLICY,
  validateInboundAttachment,
  validateInboundAttachments,
} from "./attachment-validation.js";

function attachment(
  overrides: Partial<NormalizedInboundAttachment> = {},
): NormalizedInboundAttachment {
  return {
    filename: "receipt.pdf",
    content_type: "application/pdf",
    size_bytes: 128_000,
    object_ref: "file://raw/attachments/receipt.pdf",
    ...overrides,
  };
}

describe("inbound attachment validation", () => {
  it("accepts allowed types within the size limit", () => {
    expect(validateInboundAttachment(attachment())).toEqual({ valid: true });
    expect(
      validateInboundAttachment(
        attachment({ content_type: "image/jpeg", filename: "photo.jpg" }),
      ),
    ).toEqual({ valid: true });
  });

  it("accepts unknown sizes (reported only on download) pending binary fetch", () => {
    expect(validateInboundAttachment(attachment({ size_bytes: null }))).toEqual(
      { valid: true },
    );
  });

  it("normalizes content types with parameters and casing", () => {
    expect(
      validateInboundAttachment(
        attachment({ content_type: "Application/PDF; name=receipt.pdf" }),
      ),
    ).toEqual({ valid: true });
  });

  it("rejects oversized attachments", () => {
    const result = validateInboundAttachment(
      attachment({
        size_bytes: DEFAULT_ATTACHMENT_VALIDATION_POLICY.maxSizeBytes + 1,
      }),
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe("attachment_too_large");
    }
  });

  it("rejects disallowed and executable content types", () => {
    for (const contentType of [
      "application/x-msdownload",
      "application/x-sh",
      "application/octet-stream",
      "text/html",
    ]) {
      const result = validateInboundAttachment(
        attachment({ content_type: contentType }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reasonCode).toBe("attachment_type_not_allowed");
      }
    }
  });

  it("rejects unsafe filenames", () => {
    for (const filename of [
      "../../etc/passwd",
      "invoice/../../secret.pdf",
      "with\\backslash.pdf",
      "control\u0000char.pdf",
      "x".repeat(300),
    ]) {
      const result = validateInboundAttachment(attachment({ filename }));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reasonCode).toBe("attachment_filename_invalid");
      }
    }
  });

  it("bounds the number of attachments per message", () => {
    const many = Array.from({ length: 11 }, (_, index) =>
      attachment({
        filename: `photo-${index}.jpg`,
        content_type: "image/jpeg",
      }),
    );

    const result = validateInboundAttachments(many);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe("too_many_attachments");
    }

    expect(validateInboundAttachments(many.slice(0, 10))).toEqual({
      valid: true,
    });
    expect(validateInboundAttachments([])).toEqual({ valid: true });
  });

  it("reports the first failing attachment in a batch", () => {
    const result = validateInboundAttachments([
      attachment(),
      attachment({ content_type: "application/x-msdownload" }),
    ]);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe("attachment_type_not_allowed");
    }
  });
});
