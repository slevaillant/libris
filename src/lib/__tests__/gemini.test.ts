import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { embedBatch } from "@/lib/gemini";

const ok = (n: number) =>
  new Response(JSON.stringify({ embeddings: Array.from({ length: n }, () => ({ values: [0.1, 0.2] })) }), { status: 200 });
const rateLimited = (body = "Resource exhausted") =>
  new Response(body, { status: 429, headers: { "retry-after": "0.001" } });

describe("embedBatch — retries", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  it("retries a rate-limited batch and returns the embeddings", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(ok(2));
    const result = await embedBatch(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual([[0.1, 0.2], [0.1, 0.2]]);
  });

  it("gives up after 4 attempts, returns nulls and reports the error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => rateLimited("Quota exceeded per day"));
    const onBatchError = vi.fn();
    const result = await embedBatch(["a"], { onBatchError });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result).toEqual([null]);
    expect(onBatchError).toHaveBeenCalledWith(429, "Quota exceeded per day");
  });

  it("splits a rate-limited batch of 100 into smaller requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const n = JSON.parse(String((init as RequestInit).body)).requests.length as number;
      return n > 25 ? rateLimited() : ok(n);
    });
    const result = await embedBatch(Array.from({ length: 100 }, (_, i) => `t${i}`));
    expect(result).toHaveLength(100);
    expect(result.every((v) => v !== null)).toBe(true);
    // 100 → 2×50 → 4×25: 1 + 2 refused calls, then 4 accepted
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("does not retry client errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 400 }));
    expect(await embedBatch(["a"])).toEqual([null]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns nulls without calling the API when no key is set", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await embedBatch(["a"])).toEqual([null]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
