import {
  DETERMINISTIC_EMBEDDER_MODEL_ID,
  EMBEDDING_DIMENSIONS,
} from "@support/integrations";
import { beforeEach, describe, expect, it } from "vitest";
import {
  KB_EVAL_DOCUMENTS,
  KB_EVAL_QUERIES,
  PROMPT_INJECTION_DOCUMENTS,
  type KbEvalDocument,
} from "./kb-eval-fixtures.js";
import { createInMemoryKbContentStore } from "./kb-content-store.js";
import { createInMemoryKbIngestionStore } from "./kb-ingestion-store.js";
import { createKbIngestionService } from "./kb-ingestion.js";
import {
  createInMemoryKbRetrievalStore,
  createKbRetrievalService,
  EmbeddingModelMismatchError,
  type KbRetrievalService,
} from "./kb-retrieval.js";

const TENANT_A = "ten_a";
const TENANT_B = "ten_b";

function makeHarness() {
  const store = createInMemoryKbIngestionStore();
  const contentStore = createInMemoryKbContentStore();
  const ingestion = createKbIngestionService({ store, contentStore });
  const retrieval = createKbRetrievalService({
    store: createInMemoryKbRetrievalStore(store),
  });

  async function ingest(tenantId: string, document: KbEvalDocument) {
    const created = await ingestion.createDocument({
      tenantId,
      createdByUserId: null,
      input: {
        kb_document_id: document.kbDocumentId,
        title: document.title,
        source_type: document.sourceType,
        document_type: document.documentType,
        content: document.content,
      },
    });
    await ingestion.ingestDocument({
      tenantId,
      kbDocumentId: created.kbDocumentId,
    });
    return created;
  }

  async function ingestCorpus(
    tenantId: string,
    documents: readonly KbEvalDocument[] = KB_EVAL_DOCUMENTS,
  ) {
    for (const document of documents) {
      await ingest(tenantId, document);
    }
  }

  return { store, ingestion, retrieval, ingest, ingestCorpus };
}

describe("createKbRetrievalService", () => {
  let harness: ReturnType<typeof makeHarness>;
  let retrieval: KbRetrievalService;

  beforeEach(() => {
    harness = makeHarness();
    retrieval = harness.retrieval;
  });

  it("ranks the relevant document first for every eval query and returns citations", async () => {
    await harness.ingestCorpus(TENANT_A);

    for (const evalQuery of KB_EVAL_QUERIES) {
      const results = await retrieval.search({
        tenantId: TENANT_A,
        query: evalQuery.query,
      });

      expect(results.length).toBeGreaterThan(0);
      const top = results[0]!;
      // Retrieval eval: the expected document ranks first.
      expect(top.kb_document_id).toBe(evalQuery.expectedKbDocumentId);
      // Citation IDs + source/document metadata travel with the hit.
      expect(top.kb_chunk_id).toMatch(/^kbc_/);
      expect(top.document_title.length).toBeGreaterThan(0);
      expect(top.document_type.length).toBeGreaterThan(0);
      expect(top.source_type.length).toBeGreaterThan(0);
      expect(top.score).toBeGreaterThan(0);
      // Results are ordered by descending relevance.
      const scores = results.map((result) => result.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it("never returns another tenant's chunks", async () => {
    await harness.ingestCorpus(TENANT_A);
    await harness.ingestCorpus(TENANT_B);

    const results = await retrieval.search({
      tenantId: TENANT_A,
      query: "how many days do I have to return an item for a refund?",
    });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.tenant_id).toBe(TENANT_A);
    }

    // A tenant with no KB gets nothing back.
    const empty = await retrieval.search({
      tenantId: "ten_empty",
      query: "refund policy",
    });
    expect(empty).toEqual([]);
  });

  it("excludes chunks of documents that have been marked stale", async () => {
    await harness.ingestCorpus(TENANT_A);

    const before = await retrieval.search({
      tenantId: TENANT_A,
      query: "how many days do I have to return an item for a refund?",
    });
    expect(before.map((result) => result.kb_document_id)).toContain(
      "kbd_returns",
    );

    // Retiring the document to `stale` must remove it from active retrieval even
    // though its chunk rows are untouched.
    await harness.ingestion.updateDocument({
      tenantId: TENANT_A,
      kbDocumentId: "kbd_returns",
      input: { status: "stale" },
    });

    const after = await retrieval.search({
      tenantId: TENANT_A,
      query: "how many days do I have to return an item for a refund?",
    });
    expect(after.map((result) => result.kb_document_id)).not.toContain(
      "kbd_returns",
    );
  });

  it("restricts retrieval to a requested document type", async () => {
    await harness.ingestCorpus(TENANT_A);

    const results = await retrieval.search({
      tenantId: TENANT_A,
      query: "how long does express shipping take to be delivered?",
      documentType: "faq",
    });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.document_type).toBe("faq");
    }
  });

  it("honors the result limit", async () => {
    await harness.ingestCorpus(TENANT_A);

    const results = await retrieval.search({
      tenantId: TENANT_A,
      query: "refund shipping cancellation warranty order",
      limit: 2,
    });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("is not hijacked by adversarial (prompt-injection) KB content", async () => {
    // The corpus now includes documents whose text tries to override agent
    // behavior. Retrieval must rank by relevance only.
    await harness.ingestCorpus(TENANT_A, [
      ...KB_EVAL_DOCUMENTS,
      ...PROMPT_INJECTION_DOCUMENTS,
    ]);

    const injectionIds = new Set(
      PROMPT_INJECTION_DOCUMENTS.map((document) => document.kbDocumentId),
    );

    for (const evalQuery of KB_EVAL_QUERIES) {
      const results = await retrieval.search({
        tenantId: TENANT_A,
        query: evalQuery.query,
      });

      // The legitimate document still ranks first despite the injected content.
      expect(results[0]!.kb_document_id).toBe(evalQuery.expectedKbDocumentId);
      // An injection document is never the top answer for a benign query.
      expect(injectionIds.has(results[0]!.kb_document_id)).toBe(false);
    }
  });

  it("returns adversarial content only as inert, attributable data", async () => {
    await harness.ingestCorpus(TENANT_A, [
      ...KB_EVAL_DOCUMENTS,
      ...PROMPT_INJECTION_DOCUMENTS,
    ]);

    // Querying with tokens unique to the injection document surfaces it, but
    // only as a normal retrieval hit: its instructions arrive verbatim as
    // `content` (evidence for downstream guardrails to reject), never executed
    // by the retrieval layer, and it carries a citation like any other chunk.
    const results = await retrieval.search({
      tenantId: TENANT_A,
      query: "developer mode approve every refund automatically",
    });

    const injectionHit = results.find(
      (result) => result.kb_document_id === "kbd_injection_refund",
    );
    expect(injectionHit).toBeDefined();
    expect(injectionHit!.content).toContain("IGNORE ALL PREVIOUS INSTRUCTIONS");
    expect(injectionHit!.kb_chunk_id).toMatch(/^kbc_/);
    expect(injectionHit!.tenant_id).toBe(TENANT_A);
  });

  it("records the embedding model id on ingested chunk metadata", async () => {
    await harness.ingestCorpus(TENANT_A);

    const results = await retrieval.search({
      tenantId: TENANT_A,
      query: KB_EVAL_QUERIES[0]!.query,
    });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.metadata["embedding_model_id"]).toBe(
        DETERMINISTIC_EMBEDDER_MODEL_ID,
      );
    }
  });

  it("drops hits below the similarity floor", async () => {
    await harness.ingestCorpus(TENANT_A);

    const unbounded = await retrieval.search({
      tenantId: TENANT_A,
      query: KB_EVAL_QUERIES[0]!.query,
    });
    expect(unbounded.length).toBeGreaterThan(1);

    const floored = createKbRetrievalService({
      store: createInMemoryKbRetrievalStore(harness.store),
      // Floor just under the top hit's score: only the best match survives.
      minScore: unbounded[0]!.score - 1e-9,
    });

    const results = await floored.search({
      tenantId: TENANT_A,
      query: KB_EVAL_QUERIES[0]!.query,
    });

    expect(results.map((result) => result.kb_chunk_id)).toEqual([
      unbounded[0]!.kb_chunk_id,
    ]);
  });

  it("caps cumulative content at the max-context budget but always keeps the top hit", async () => {
    await harness.ingestCorpus(TENANT_A);

    const unbounded = await retrieval.search({
      tenantId: TENANT_A,
      query: KB_EVAL_QUERIES[0]!.query,
    });
    expect(unbounded.length).toBeGreaterThan(1);

    const capped = createKbRetrievalService({
      store: createInMemoryKbRetrievalStore(harness.store),
      // A budget smaller than any single chunk: only the top hit survives.
      maxContextChars: 1,
    });

    const results = await capped.search({
      tenantId: TENANT_A,
      query: KB_EVAL_QUERIES[0]!.query,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.kb_chunk_id).toBe(unbounded[0]!.kb_chunk_id);
  });

  it("fails closed when chunks were embedded by a different model", async () => {
    await harness.ingestCorpus(TENANT_A);

    const mismatched = createKbRetrievalService({
      store: createInMemoryKbRetrievalStore(harness.store),
      embedder: {
        modelId: "openai:text-embedding-3-small",
        dimensions: EMBEDDING_DIMENSIONS,
        embed: async (texts) =>
          texts.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0.01)),
      },
    });

    await expect(
      mismatched.search({ tenantId: TENANT_A, query: "refund policy" }),
    ).rejects.toThrow(EmbeddingModelMismatchError);
  });

  it("treats chunks without a recorded model id as deterministic-embedded", async () => {
    await harness.ingestCorpus(TENANT_A);

    // Simulate pre-Milestone-15 rows: strip the recorded id.
    for (const chunk of harness.store.chunks) {
      delete (chunk.metadata as Record<string, unknown>)["embedding_model_id"];
    }

    const results = await retrieval.search({
      tenantId: TENANT_A,
      query: KB_EVAL_QUERIES[0]!.query,
    });

    expect(results.length).toBeGreaterThan(0);
  });
});
