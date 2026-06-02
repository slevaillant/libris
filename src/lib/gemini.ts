const BATCH_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents";

// Batch-embed up to 100 texts per request (Gemini limit).
// Returns null for any individual text that failed — never throws.
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || texts.length === 0) return texts.map(() => null);

  const results: (number[] | null)[] = [];

  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    try {
      const res = await fetch(`${BATCH_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: "models/gemini-embedding-001",
            content: { parts: [{ text }] },
            outputDimensionality: 1536,
          })),
        }),
      });
      if (!res.ok) {
        results.push(...batch.map(() => null));
        continue;
      }
      const data = (await res.json()) as { embeddings: { values: number[] }[] };
      results.push(...data.embeddings.map((e) => e?.values ?? null));
    } catch {
      results.push(...batch.map(() => null));
    }
  }

  return results;
}

export async function embed(text: string): Promise<number[] | null> {
  const [result] = await embedBatch([text]);
  return result ?? null;
}
