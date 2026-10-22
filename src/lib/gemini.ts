const BATCH_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents";

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

// Batch-embed up to 100 texts per request (Gemini limit).
// Retries rate-limit (429) and server (5xx) errors with backoff.
// Returns null for any individual text that still failed — never throws.
export async function embedBatch(
  texts: string[],
  { onBatchError }: EmbedBatchOptions = {},
): Promise<(number[] | null)[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || texts.length === 0) return texts.map(() => null);

  const results: (number[] | null)[] = [];

  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    let embedded: (number[] | null)[] | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS && !embedded; attempt++) {
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
          embedded = data.embeddings.map((e) => e?.values ?? null);
          break;
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

    results.push(...(embedded ?? batch.map(() => null)));
  }

  return results;
}

export async function embed(text: string): Promise<number[] | null> {
  const [result] = await embedBatch([text]);
  return result ?? null;
}
