import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORM_BODY_LIMITS,
  isParsedFormBody,
  parseMultipartFormBody,
  parseUrlEncodedFormBody,
} from "./form-body.js";

const BOUNDARY = "----testboundary";

function multipartBody(
  fields: Record<string, string>,
  files: readonly {
    field: string;
    filename: string;
    contentType: string;
    content: Buffer;
  }[] = [],
): Buffer {
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.content,
      Buffer.from("\r\n"),
    );
  }

  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));

  return Buffer.concat(parts);
}

const HEADERS = {
  "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
};

describe("parseUrlEncodedFormBody", () => {
  it("parses Mailgun's hyphenated field names", () => {
    const body = Buffer.from(
      new URLSearchParams({
        "body-plain": "Where is my order?",
        "Message-Id": "<abc@mail.test>",
        timestamp: "1751414400",
      }).toString(),
    );

    expect(parseUrlEncodedFormBody(body)).toEqual({
      fields: {
        "body-plain": "Where is my order?",
        "Message-Id": "<abc@mail.test>",
        timestamp: "1751414400",
      },
      files: [],
    });
  });
});

describe("parseMultipartFormBody", () => {
  it("parses fields and file metadata without retaining bytes", async () => {
    const body = multipartBody({ sender: "buyer@example.test" }, [
      {
        field: "attachment-1",
        filename: "receipt.pdf",
        contentType: "application/pdf",
        content: Buffer.from("hello pdf"),
      },
    ]);

    const parsed = await parseMultipartFormBody(HEADERS, body);

    expect(parsed.fields).toEqual({ sender: "buyer@example.test" });
    expect(parsed.files).toEqual([
      {
        fieldname: "attachment-1",
        filename: "receipt.pdf",
        content_type: "application/pdf",
        size_bytes: 9,
      },
    ]);
  });

  it("reports an OVER-limit size for a truncated file so the size gate still rejects it", async () => {
    // busboy stops feeding data at the limit. Reporting the clipped byte count
    // would make an oversized attachment read as exactly at the limit and slip
    // past `size_bytes > maxSizeBytes`.
    const limits = { ...DEFAULT_FORM_BODY_LIMITS, maxFileBytes: 8 };
    const body = multipartBody({}, [
      {
        field: "attachment-1",
        filename: "big.pdf",
        contentType: "application/pdf",
        content: Buffer.alloc(64, 1),
      },
    ]);

    const parsed = await parseMultipartFormBody(HEADERS, body, limits);

    expect(parsed.files[0]!.size_bytes).toBeGreaterThan(limits.maxFileBytes);
  });

  it("rejects a body whose boundary does not match the header", async () => {
    await expect(
      parseMultipartFormBody(
        { "content-type": "multipart/form-data" },
        multipartBody({ a: "b" }),
      ),
    ).rejects.toThrow();
  });
});

describe("isParsedFormBody", () => {
  it("recognizes a parsed form body and rejects a plain JSON object", () => {
    expect(isParsedFormBody({ fields: {}, files: [] })).toBe(true);
    expect(isParsedFormBody({ message_id: "x" })).toBe(false);
    expect(isParsedFormBody(null)).toBe(false);
  });
});
