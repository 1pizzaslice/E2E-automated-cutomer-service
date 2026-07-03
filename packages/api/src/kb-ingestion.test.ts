import { createHash } from "node:crypto";
import { createDeterministicEmbedder } from "@support/integrations";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryKbContentStore } from "./kb-content-store.js";
import { createInMemoryKbIngestionStore } from "./kb-ingestion-store.js";
import { createKbIngestionService } from "./kb-ingestion.js";

const TENANT_A = "ten_a";
const TENANT_B = "ten_b";

function makeService() {
  const store = createInMemoryKbIngestionStore();
  const contentStore = createInMemoryKbContentStore();
  const service = createKbIngestionService({
    store,
    contentStore,
    // Small windows so multi-chunk behavior is exercised on short fixtures.
    chunkOptions: { maxChars: 60, overlapChars: 10 },
  });

  return { store, contentStore, service };
}

describe("createKbIngestionService", () => {
  let harness: ReturnType<typeof makeService>;

  beforeEach(() => {
    harness = makeService();
  });

  it("creates a draft document and stores content by reference", async () => {
    const content = "Refunds are issued within 30 days.";
    const document = await harness.service.createDocument({
      tenantId: TENANT_A,
      createdByUserId: "usr_1",
      input: {
        title: "Refund policy",
        source_type: "manual",
        document_type: "policy",
        content,
      },
    });

    expect(document.status).toBe("draft");
    expect(document.version).toBe(1);
    expect(document.contentHash).toBe(
      createHash("sha256").update(content, "utf8").digest("hex"),
    );
    expect(
      await harness.contentStore.get({
        tenantId: TENANT_A,
        kbDocumentId: document.kbDocumentId,
      }),
    ).toBe(content);
    // Content is never written into the document store row.
    expect(harness.store.chunks).toHaveLength(0);
  });

  it("ingests a document into active, embedded chunks", async () => {
    const content = [
      "Orders ship within two business days.",
      "",
      "Refunds are issued to the original payment method within 30 days.",
    ].join("\n");

    const document = await harness.service.createDocument({
      tenantId: TENANT_A,
      createdByUserId: null,
      input: {
        title: "Shipping and refunds",
        source_type: "manual",
        document_type: "faq",
        content,
      },
    });

    const result = await harness.service.ingestDocument({
      tenantId: TENANT_A,
      kbDocumentId: document.kbDocumentId,
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe("active");
    expect(result?.chunk_count).toBeGreaterThan(0);
    expect(result?.embedded_count).toBe(result?.chunk_count);

    const chunks = harness.store.chunks.filter(
      (chunk) => chunk.kbDocumentId === document.kbDocumentId,
    );
    expect(chunks).toHaveLength(result?.chunk_count ?? 0);
    for (const chunk of chunks) {
      expect(chunk.status).toBe("active");
      expect(chunk.embedding).toHaveLength(
        createDeterministicEmbedder().dimensions,
      );
      expect(chunk.metadata).toMatchObject({
        document_type: "faq",
        source_type: "manual",
      });
    }

    const stored = await harness.store.getDocumentById(
      TENANT_A,
      document.kbDocumentId,
    );
    expect(stored?.status).toBe("active");
  });

  it("re-ingestion replaces the prior chunk set without duplicating indexes", async () => {
    const document = await harness.service.createDocument({
      tenantId: TENANT_A,
      createdByUserId: null,
      input: {
        title: "Doc",
        source_type: "manual",
        document_type: "faq",
        content: "one two three four five six seven eight nine ten",
      },
    });

    const first = await harness.service.ingestDocument({
      tenantId: TENANT_A,
      kbDocumentId: document.kbDocumentId,
    });
    const second = await harness.service.ingestDocument({
      tenantId: TENANT_A,
      kbDocumentId: document.kbDocumentId,
    });

    const chunks = harness.store.chunks.filter(
      (chunk) => chunk.kbDocumentId === document.kbDocumentId,
    );
    expect(chunks).toHaveLength(second?.chunk_count ?? 0);
    expect(second?.chunk_count).toBe(first?.chunk_count);
    const indexes = chunks.map((chunk) => chunk.chunkIndex).sort();
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it("returns null when ingesting a document owned by another tenant", async () => {
    const document = await harness.service.createDocument({
      tenantId: TENANT_A,
      createdByUserId: null,
      input: {
        title: "Doc",
        source_type: "manual",
        document_type: "faq",
        content: "tenant scoped content",
      },
    });

    const crossTenant = await harness.service.ingestDocument({
      tenantId: TENANT_B,
      kbDocumentId: document.kbDocumentId,
    });

    expect(crossTenant).toBeNull();
    expect(harness.store.chunks).toHaveLength(0);
  });

  it("updates document metadata and status", async () => {
    const document = await harness.service.createDocument({
      tenantId: TENANT_A,
      createdByUserId: null,
      input: {
        title: "Doc",
        source_type: "manual",
        document_type: "faq",
        content: "content",
      },
    });

    const updated = await harness.service.updateDocument({
      tenantId: TENANT_A,
      kbDocumentId: document.kbDocumentId,
      input: { status: "stale", title: "Archived doc" },
    });

    expect(updated?.status).toBe("stale");
    expect(updated?.title).toBe("Archived doc");
  });

  it("returns null when updating a document owned by another tenant", async () => {
    const document = await harness.service.createDocument({
      tenantId: TENANT_A,
      createdByUserId: null,
      input: {
        title: "Doc",
        source_type: "manual",
        document_type: "faq",
        content: "content",
      },
    });

    const updated = await harness.service.updateDocument({
      tenantId: TENANT_B,
      kbDocumentId: document.kbDocumentId,
      input: { status: "stale" },
    });

    expect(updated).toBeNull();
  });

  it("returns null when ingesting an unknown document", async () => {
    const result = await harness.service.ingestDocument({
      tenantId: TENANT_A,
      kbDocumentId: "kbd_missing",
    });

    expect(result).toBeNull();
  });
});
