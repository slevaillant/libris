import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { embed, embedBatch } from "@/lib/gemini";

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

// ─── Shared type ─────────────────────────────────────────────────────────────

export type ParsedHighlight = {
  content: string;
  chapter?: string;
  note?: string;
};

// ─── Parse raw Kindle notebook text into structured highlights (Haiku) ────────

export const parseKindleHighlights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ text: z.string().min(1).max(200_000) }).parse(i))
  .handler(async ({ data }) => {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      system: [
        {
          type: "text" as const,
          text: "You extract Kindle reading highlights from pasted notebook text. Each highlight is a quoted passage the reader marked. Identify the chapter or section heading that precedes each highlight. Include personal notes if present.",
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: [
        {
          name: "extract_highlights",
          description: "Extract structured highlights from Kindle notebook text",
          input_schema: {
            type: "object" as const,
            properties: {
              highlights: {
                type: "array" as const,
                items: {
                  type: "object" as const,
                  properties: {
                    content: { type: "string" as const, description: "The highlighted passage" },
                    chapter: { type: "string" as const, description: "Chapter or section heading if determinable" },
                    note: { type: "string" as const, description: "Personal note attached to this highlight" },
                  },
                  required: ["content"],
                },
              },
            },
            required: ["highlights"],
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: "extract_highlights" },
      messages: [{ role: "user", content: data.text }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return [] as ParsedHighlight[];

    const parsed = toolUse.input as { highlights: ParsedHighlight[] };
    return (parsed.highlights ?? []) as ParsedHighlight[];
  });

// ─── Bulk-create highlights (batch embed + insert) ────────────────────────────

export const bulkCreateHighlights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        sourceId: z.string().uuid(),
        highlights: z
          .array(
            z.object({
              content: z.string().min(1).max(4000),
              chapter: z.string().optional(),
              note: z.string().max(2000).optional(),
            }),
          )
          .min(1)
          .max(500),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: maxRow } = await supabase
      .from("chunks")
      .select("chunk_index")
      .eq("source_id", data.sourceId)
      .order("chunk_index", { ascending: false })
      .limit(1)
      .maybeSingle();

    const baseIndex = (maxRow?.chunk_index ?? -1) + 1;

    const texts = data.highlights.map((h) =>
      h.note ? `${h.content}\n\n${h.note}` : h.content,
    );
    const embeddings = await embedBatch(texts).catch(() => texts.map(() => null));

    const { data: chunks, error: chunksErr } = await supabase
      .from("chunks")
      .insert(
        data.highlights.map((h, i) => ({
          source_id: data.sourceId,
          user_id: userId,
          chunk_index: baseIndex + i,
          content: texts[i],
          chapter_title: h.chapter ?? null,
          chunk_type: "highlight",
          embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
          indexed_at: new Date().toISOString(),
          token_count: Math.ceil(texts[i].length / 4),
        })),
      )
      .select("id");

    if (chunksErr || !chunks) throw new Error(chunksErr?.message ?? "Failed to create chunks");

    const { error: highlightsErr } = await supabase
      .from("highlights")
      .insert(
        data.highlights.map((h, i) => ({
          user_id: userId,
          source_id: data.sourceId,
          chunk_id: chunks[i]?.id ?? null,
          content: h.content,
          note: h.note ?? null,
          chapter: h.chapter ?? null,
          page: null,
        })),
      );

    if (highlightsErr) throw new Error(highlightsErr.message);

    await supabase
      .from("sources")
      .update({ total_chunks: baseIndex + data.highlights.length })
      .eq("id", data.sourceId)
      .eq("user_id", userId);

    return { count: data.highlights.length };
  });
