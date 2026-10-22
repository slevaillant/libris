import type { SupabaseClient } from "@supabase/supabase-js";

const INSERT_BATCH = 50;

/**
 * Insert chunk rows in small batches and throw on failure.
 * Each row also updates the HNSW vector index, so one large insert (a long book,
 * a long video transcript) can exceed the database statement timeout.
 */
export async function insertChunks(supabase: SupabaseClient, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error } = await supabase.from("chunks").insert(rows.slice(i, i + INSERT_BATCH));
    if (error) throw new Error(error.message);
  }
}
