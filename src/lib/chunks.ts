import type { SupabaseClient } from "@supabase/supabase-js";

const INSERT_BATCH = 50;
const MIN_BATCH = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Insert chunk rows in small batches and throw on failure.
 * Each row also updates the HNSW vector index, so inserts are slow when the index is
 * busy (bulk re-imports): a batch that hits the statement timeout is retried in
 * smaller pieces after a pause, down to MIN_BATCH rows.
 */
export async function insertChunks(supabase: SupabaseClient, rows: Record<string, unknown>[], batch = INSERT_BATCH): Promise<void> {
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const { error } = await supabase.from("chunks").insert(slice);
    if (!error) continue;
    if (/statement timeout/i.test(error.message) && batch > MIN_BATCH) {
      await sleep(3000);
      await insertChunks(supabase, slice, Math.max(MIN_BATCH, Math.ceil(batch / 5)));
      continue;
    }
    throw new Error(error.message);
  }
}
