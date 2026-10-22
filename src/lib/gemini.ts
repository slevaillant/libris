const BATCH_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents";

const MAX_BATCH = 100; // Gemini limit per request
const MIN_SPLIT = 10; // smallest batch tried when a large one hits a per-minute token quota
const MAX_ATTEMPTS = 4;
const MAX_CHARS = 8000; // stay under the model's input token limit

export type EmbedBatchOptions = {
  /** Called once per batch that still failed after all retries (status only — never content). */
  onBatchError?: (status: number | "network", body: string) => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 60_000);
  return 2000 * 2 ** attempt; // 2s, 4s, 8s
}

async function embedOneRequest(
  apiKey: string,
  batch: string[],
  onBatchError: EmbedBatchOptions["onBatchError"],
): Promise<(number[] | null)[]> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BATCH_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: "models/gemini-embedding-001",
            content: { parts: [{ text: text.slice(0, MAX_CHARS) }] },
            outputDimensionality: 1536,
          })),
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { embeddings: { values: number[] }[] };
        return data.embeddings.map((e) => e?.values ?? null);
      }

      // A large batch can exceed a per-minute token quota on its own: split instead of retrying it
      if (res.status === 429 && batch.length > MIN_SPLIT) {
        const half = Math.ceil(batch.length / 2);
        const first = await embedOneRequest(apiKey, batch.slice(0, half), onBatchError);
        const second = await embedOneRequest(apiKey, batch.slice(half), onBatchError);
        return [...first, ...second];
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS - 1) {
        const body = await res.text().catch(() => "");
        console.error(`[gemini] embedBatch failed: HTTP ${res.status}`);
        onBatchError?.(res.status, body);
        break;
      }
      await sleep(retryDelayMs(res, attempt));
    } catch {
      if (attempt === MAX_ATTEMPTS - 1) {
        console.error("[gemini] embedBatch failed: network error");
        onBatchError?.("network", "");
      } else {
        await sleep(2000 * 2 ** attempt);
      }
    }
  }
  return batch.map(() => null);
}

// Batch-embed texts, 100 per request (Gemini limit).
// Rate-limited batches are split down to 10 texts, then retried with backoff; 5xx are retried.
// Returns null for any individual text that still failed — never throws.
export async function embedBatch(
  texts: string[],
  { onBatchError }: EmbedBatchOptions = {},
): Promise<(number[] | null)[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || texts.length === 0) return texts.map(() => null);

  const results: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    results.push(...(await embedOneRequest(apiKey, texts.slice(i, i + MAX_BATCH), onBatchError)));
  }
  return results;
}

export async function embed(text: string): Promise<number[] | null> {
  const [result] = await embedBatch([text]);
  return result ?? null;
}
