import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { embedBatch } from "@/lib/gemini";
import type { SourceRow, ChunkRow } from "./library.functions";

export { type SourceRow, type ChunkRow };

// ─── Delete a source (cascades to chunks via FK) ──────────────────────────────

export const deleteSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ sourceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("sources")
      .delete()
      .eq("id", data.sourceId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── List all sources for user ────────────────────────────────────────────────

export const listSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("sources")
      .select(
        "id, source_type, title, author, isbn, cover_url, description, total_chunks, ingest_status, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return (data ?? []).map(
      (s): SourceRow => ({
        id: s.id,
        sourceType: s.source_type,
        title: s.title,
        author: s.author,
        isbn: s.isbn,
        coverUrl: s.cover_url,
        description: s.description,
        totalChunks: s.total_chunks,
        ingestStatus: s.ingest_status,
        createdAt: s.created_at,
      }),
    );
  });

// ─── Get single source with its chunks ───────────────────────────────────────

export const getSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ sourceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: source, error } = await supabase
      .from("sources")
      .select("*")
      .eq("id", data.sourceId)
      .eq("user_id", userId)
      .single();

    if (error || !source) throw new Error("Source not found");

    const { data: chunks } = await supabase
      .from("chunks")
      .select("id, chunk_index, chapter_title, content, chunk_type")
      .eq("source_id", data.sourceId)
      .order("chunk_index", { ascending: true });

    return {
      source: {
        id: source.id,
        sourceType: source.source_type,
        title: source.title,
        author: source.author as string | null,
        isbn: source.isbn as string | null,
        coverUrl: source.cover_url as string | null,
        description: source.description as string | null,
        shelfLocation: source.shelf_location as string | null,
        totalChunks: source.total_chunks,
        ingestStatus: source.ingest_status,
        ingestError: source.ingest_error as string | null,
        isRead: source.is_read as boolean,
        tags: source.tags as string[],
        createdAt: source.created_at,
      },
      chunks: (chunks ?? []).map(
        (c): ChunkRow => ({
          id: c.id,
          chunkIndex: c.chunk_index,
          chapterTitle: c.chapter_title,
          content: c.content,
          chunkType: c.chunk_type,
        }),
      ),
    };
  });

// ─── Re-embed all chunks with missing embeddings for a source ─────────────────

export const reembedSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ sourceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Fetch chunks that have no embedding
    const { data: chunks, error } = await supabase
      .from("chunks")
      .select("id, content")
      .eq("source_id", data.sourceId)
      .eq("user_id", userId)
      .is("embedding", null);

    if (error) throw new Error(error.message);
    if (!chunks || chunks.length === 0) return { embedded: 0 };

    const BATCH = 100;
    let embedded = 0;

    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const embeddings = await embedBatch(batch.map((c) => c.content));

      for (let j = 0; j < batch.length; j++) {
        const vec = embeddings[j];
        if (!vec) continue;
        await supabase
          .from("chunks")
          .update({
            embedding: JSON.stringify(vec),
            indexed_at: new Date().toISOString(),
          })
          .eq("id", batch[j].id);
        embedded++;
      }
    }

    await supabase
      .from("sources")
      .update({ ingest_status: "complete", last_ingested: new Date().toISOString() })
      .eq("id", data.sourceId)
      .eq("user_id", userId);

    return { embedded };
  });
