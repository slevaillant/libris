import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { embed } from "@/lib/gemini";

export type HighlightRow = {
  id: string;
  content: string;
  note: string | null;
  chapter: string | null;
  page: number | null;
  chunkId: string | null;
  createdAt: string;
};

// ─── Create a highlight (inserts highlight + chunk, embeds immediately) ────────

export const createHighlight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        sourceId: z.string().uuid(),
        content: z.string().min(1).max(4000),
        note: z.string().max(2000).optional(),
        chapter: z.string().optional(),
        page: z.number().int().positive().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // The chunk content is the highlight text; append note if present so RAG retrieves both together
    const chunkContent = data.note ? `${data.content}\n\n${data.note}` : data.content;

    // Get next available chunk_index for this source
    const { data: maxRow } = await supabase
      .from("chunks")
      .select("chunk_index")
      .eq("source_id", data.sourceId)
      .order("chunk_index", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextIndex = (maxRow?.chunk_index ?? -1) + 1;

    // Embed immediately — never fail ingestion due to embedding error
    const embedding = await embed(chunkContent).catch(() => null);

    // 1. Create chunk with chunk_type = "highlight" (authority tier 1 at query time)
    const { data: chunk, error: chunkErr } = await supabase
      .from("chunks")
      .insert({
        source_id: data.sourceId,
        user_id: userId,
        chunk_index: nextIndex,
        content: chunkContent,
        chapter_title: data.chapter ?? null,
        chunk_type: "highlight",
        embedding: embedding ? JSON.stringify(embedding) : null,
        indexed_at: new Date().toISOString(),
        token_count: Math.ceil(chunkContent.length / 4),
      })
      .select("id")
      .single();

    if (chunkErr || !chunk) throw new Error(chunkErr?.message ?? "Failed to create chunk");

    // 2. Create highlight record
    const { data: highlight, error: highlightErr } = await supabase
      .from("highlights")
      .insert({
        user_id: userId,
        source_id: data.sourceId,
        chunk_id: chunk.id,
        content: data.content,
        note: data.note ?? null,
        chapter: data.chapter ?? null,
        page: data.page ?? null,
      })
      .select("id, content, note, chapter, page, chunk_id, created_at")
      .single();

    if (highlightErr || !highlight) throw new Error(highlightErr?.message ?? "Failed to create highlight");

    return {
      id: highlight.id as string,
      content: highlight.content as string,
      note: highlight.note as string | null,
      chapter: highlight.chapter as string | null,
      page: highlight.page as number | null,
      chunkId: highlight.chunk_id as string | null,
      createdAt: highlight.created_at as string,
    } satisfies HighlightRow;
  });

// ─── List highlights for a source ────────────────────────────────────────────

export const listHighlights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ sourceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: rows, error } = await supabase
      .from("highlights")
      .select("id, content, note, chapter, page, chunk_id, created_at")
      .eq("source_id", data.sourceId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    return (rows ?? []).map(
      (r): HighlightRow => ({
        id: r.id,
        content: r.content,
        note: r.note,
        chapter: r.chapter,
        page: r.page,
        chunkId: r.chunk_id,
        createdAt: r.created_at,
      }),
    );
  });

// ─── Delete a highlight and its associated chunk ──────────────────────────────

export const deleteHighlight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ highlightId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Fetch chunk_id before deleting
    const { data: row } = await supabase
      .from("highlights")
      .select("chunk_id")
      .eq("id", data.highlightId)
      .eq("user_id", userId)
      .maybeSingle();

    const { error } = await supabase
      .from("highlights")
      .delete()
      .eq("id", data.highlightId)
      .eq("user_id", userId);

    if (error) throw new Error(error.message);

    // Delete the associated chunk (highlight FK is on delete set null, so chunk survives otherwise)
    if (row?.chunk_id) {
      await supabase.from("chunks").delete().eq("id", row.chunk_id).eq("user_id", userId);
    }
  });
