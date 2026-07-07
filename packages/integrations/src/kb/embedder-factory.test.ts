import { describe, expect, it } from "vitest";
import {
  createEmbedderFromEnv,
  DEFAULT_EMBEDDING_API_KEY_REF,
} from "./embedder-factory.js";
import {
  createOpenAiEmbedder,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
} from "./embedder-openai.js";
import {
  DETERMINISTIC_EMBEDDER_MODEL_ID,
  EMBEDDING_DIMENSIONS,
} from "./embedder.js";

function vector(fill: number): number[] {
  return new Array<number>(EMBEDDING_DIMENSIONS).fill(fill);
}

function embeddingsResponse(
  vectors: readonly number[][],
  { reversed = false } = {},
): Response {
  const data = vectors.map((embedding, index) => ({ index, embedding }));

  if (reversed) {
    data.reverse();
  }

  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();

    if (!next) {
      throw new Error("fake fetch exhausted");
    }

    if (next instanceof Error) {
      throw next;
    }

    return next;
  }) as typeof fetch;

  return { fetchImpl, calls };
}

describe("createEmbedderFromEnv", () => {
  it("defaults to the deterministic embedder when unset", () => {
    const embedder = createEmbedderFromEnv({});

    expect(embedder.modelId).toBe(DETERMINISTIC_EMBEDDER_MODEL_ID);
    expect(embedder.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it("treats explicit deterministic as the default", () => {
    const embedder = createEmbedderFromEnv({
      SUPPORT_EMBEDDING_PROVIDER: "deterministic",
    });

    expect(embedder.modelId).toBe(DETERMINISTIC_EMBEDDER_MODEL_ID);
  });

  it("builds the OpenAI embedder with the pilot default model", () => {
    const embedder = createEmbedderFromEnv({
      SUPPORT_EMBEDDING_PROVIDER: "openai",
      [DEFAULT_EMBEDDING_API_KEY_REF]: "sk-test",
    });

    expect(embedder.modelId).toBe(`openai:${DEFAULT_OPENAI_EMBEDDING_MODEL}`);
    expect(embedder.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it("resolves the key through a custom SecretResolver-style ref", () => {
    const embedder = createEmbedderFromEnv({
      SUPPORT_EMBEDDING_PROVIDER: "openai",
      SUPPORT_EMBEDDING_API_KEY_REF: "MY_EMBED_KEY",
      MY_EMBED_KEY: "sk-custom",
    });

    expect(embedder.modelId).toBe(`openai:${DEFAULT_OPENAI_EMBEDDING_MODEL}`);
  });

  it("fails fast when the provider is unknown", () => {
    expect(() =>
      createEmbedderFromEnv({ SUPPORT_EMBEDDING_PROVIDER: "cohere" }),
    ).toThrow(/SUPPORT_EMBEDDING_PROVIDER/);
  });

  it("fails fast when the key is missing or the ref is malformed", () => {
    expect(() =>
      createEmbedderFromEnv({ SUPPORT_EMBEDDING_PROVIDER: "openai" }),
    ).toThrow(/OPENAI_API_KEY/);
    expect(() =>
      createEmbedderFromEnv({
        SUPPORT_EMBEDDING_PROVIDER: "openai",
        SUPPORT_EMBEDDING_API_KEY_REF: "not-a-ref",
      }),
    ).toThrow(/SUPPORT_EMBEDDING_API_KEY_REF/);
  });

  it("rejects models outside the 1536-dim-capable allowlist", () => {
    expect(() =>
      createEmbedderFromEnv({
        SUPPORT_EMBEDDING_PROVIDER: "openai",
        SUPPORT_EMBEDDING_MODEL: "text-embedding-2-small",
        [DEFAULT_EMBEDDING_API_KEY_REF]: "sk-test",
      }),
    ).toThrow(/Unsupported OpenAI embedding model/);
  });
});

describe("createOpenAiEmbedder", () => {
  it("posts the batch with auth, model, and the 1536-dim parameter", async () => {
    const { fetchImpl, calls } = makeFetch([
      embeddingsResponse([vector(0.1), vector(0.2)]),
    ]);
    const embedder = createOpenAiEmbedder({ apiKey: "sk-test", fetchImpl });

    const vectors = await embedder.embed(["first", "second"]);

    expect(vectors).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/embeddings");
    expect(
      (calls[0]!.init.headers as Record<string, string>)["authorization"],
    ).toBe("Bearer sk-test");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      model: DEFAULT_OPENAI_EMBEDDING_MODEL,
      input: ["first", "second"],
      dimensions: EMBEDDING_DIMENSIONS,
    });
  });

  it("omits the dimensions parameter for ada-002 (natively 1536)", async () => {
    const { fetchImpl, calls } = makeFetch([embeddingsResponse([vector(0.3)])]);
    const embedder = createOpenAiEmbedder({
      apiKey: "sk-test",
      model: "text-embedding-ada-002",
      fetchImpl,
    });

    await embedder.embed(["text"]);

    const body = JSON.parse(String(calls[0]!.init.body));
    expect("dimensions" in body).toBe(false);
  });

  it("re-orders response items by index", async () => {
    const { fetchImpl } = makeFetch([
      embeddingsResponse([vector(1), vector(2)], { reversed: true }),
    ]);
    const embedder = createOpenAiEmbedder({ apiKey: "sk-test", fetchImpl });

    const [first, second] = await embedder.embed(["a", "b"]);

    expect(first![0]).toBe(1);
    expect(second![0]).toBe(2);
  });

  it("retries transient failures then succeeds", async () => {
    const { fetchImpl, calls } = makeFetch([
      new Response("overloaded", { status: 429 }),
      new Error("socket hang up"),
      embeddingsResponse([vector(0.5)]),
    ]);
    const embedder = createOpenAiEmbedder({
      apiKey: "sk-test",
      fetchImpl,
      sleep: async () => {},
    });

    const vectors = await embedder.embed(["text"]);

    expect(vectors).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("gives up after exhausting transient retries", async () => {
    const { fetchImpl } = makeFetch([
      new Response("boom", { status: 500 }),
      new Response("boom", { status: 500 }),
      new Response("boom", { status: 500 }),
    ]);
    const embedder = createOpenAiEmbedder({
      apiKey: "sk-test",
      fetchImpl,
      sleep: async () => {},
    });

    await expect(embedder.embed(["text"])).rejects.toThrow(/after 3 attempts/);
  });

  it("fails permanently on auth errors without retrying", async () => {
    const { fetchImpl, calls } = makeFetch([
      new Response("unauthorized", { status: 401 }),
    ]);
    const embedder = createOpenAiEmbedder({ apiKey: "sk-bad", fetchImpl });

    await expect(embedder.embed(["text"])).rejects.toThrow(/HTTP 401/);
    expect(calls).toHaveLength(1);
  });

  it("rejects wrong-dimensional vectors instead of writing them", async () => {
    const { fetchImpl } = makeFetch([
      new Response(
        JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }),
        { status: 200 },
      ),
    ]);
    const embedder = createOpenAiEmbedder({ apiKey: "sk-test", fetchImpl });

    await expect(embedder.embed(["text"])).rejects.toThrow(/dimensions/);
  });

  it("rejects responses with a missing or short vector count", async () => {
    const { fetchImpl } = makeFetch([
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    ]);
    const embedder = createOpenAiEmbedder({ apiKey: "sk-test", fetchImpl });

    await expect(embedder.embed(["a", "b"])).rejects.toThrow(/malformed/);
  });

  it("short-circuits empty batches without a network call", async () => {
    const { fetchImpl, calls } = makeFetch([]);
    const embedder = createOpenAiEmbedder({ apiKey: "sk-test", fetchImpl });

    expect(await embedder.embed([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
