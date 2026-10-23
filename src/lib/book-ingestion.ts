// Book ingestion helpers that run on the server or in local scripts (sync/*), never in the browser.
// Kept out of library.functions.ts: plain exports there would pull the Anthropic SDK into the
// client bundle (only createServerFn handler bodies are stripped from it).

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedBatch } from "@/lib/gemini";
import { insertChunks } from "@/lib/chunks";
import { stripNul } from "@/lib/utils";
import { cleanChapterTitles, type TocResult } from "@/lib/toc";

export type DigitalBookInput = {
  title: string;
  author?: string;
  isbn?: string;
  coverUrl?: string;
  description?: string;
  chunks: { content: string; chapterTitle?: string | null; pageNumber?: number | null }[];
};

// ─── Chapter summaries (Haiku, prompt-cached) ─────────────────────────────────

export const CHAPTER_SUMMARY_SYSTEM = `You are a knowledge indexing agent for Libris.
Generate a 100-150 word chapter summary for semantic search.
Cover: the core argument, 2-3 key concepts introduced, the type of reader who benefits, and the problem it solves.
Be specific and accurate. Use the provided tool only.`;

export const CHAPTER_SUMMARY_TOOL = {
  name: "generate_chapter_summary" as const,
  description: "Generate a chapter summary for semantic indexing",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string" as const,
        description: "100-150 word summary of this chapter",
      },
    },
    required: ["summary"],
  },
};

export async function generateChapterSummary(
  anthropic: Anthropic,
  bookTitle: string,
  bookAuthor: string,
  chapterTitle: string,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: [
      {
        type: "text" as const,
        text: CHAPTER_SUMMARY_SYSTEM,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    tools: [CHAPTER_SUMMARY_TOOL],
    tool_choice: { type: "tool" as const, name: "generate_chapter_summary" },
    messages: [
      {
        role: "user",
        content: `Book: "${bookTitle}" by ${bookAuthor}\nChapter: "${chapterTitle}"`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return chapterTitle;
  const summary = (toolUse.input as { summary?: unknown }).summary;
  return typeof summary === "string" && summary.trim() ? summary : chapterTitle;
}

export async function generateChapterSummaries(
  anthropic: Anthropic,
  bookTitle: string,
  bookAuthor: string,
  chapters: string[],
): Promise<string[]> {
  // Sequential: the prompt cache warms after the first call
  const summaries: string[] = [];
  for (const chapter of chapters) summaries.push(await generateChapterSummary(anthropic, bookTitle, bookAuthor, chapter));
  return summaries;
}

/**
 * Replace a book's AI chapter summaries with summaries of a new chapter list
 * (real table of contents). Full-text passages and highlights are left untouched.
 * Shared by the book page (replaceChapters) and sync/fix-tocs.ts.
 */
export async function replaceBookChapters(
  supabase: SupabaseClient,
  userId: string,
  sourceId: string,
  toc: TocResult,
): Promise<{ chapters: number }> {
  const { data: source } = await supabase
    .from("sources")
    .select("title, author")
    .eq("id", sourceId)
    .eq("user_id", userId)
    .single();
  if (!source) throw new Error("Source not found");

  const chapters = cleanChapterTitles(toc.chapters);
  if (chapters.length === 0) throw new Error("No chapters to save");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const summaries = await generateChapterSummaries(anthropic, source.title as string, (source.author as string) ?? "Unknown", chapters);
  const embeddings = await embedBatch(summaries);

  // Insert the new chapters first and delete the old ones only once that worked,
  // so a failure can never leave the book without chapters
  const { data: old } = await supabase
    .from("chunks")
    .select("id")
    .eq("source_id", sourceId)
    .eq("chunk_type", "chapter_summary");
  const { data: last } = await supabase
    .from("chunks")
    .select("chunk_index")
    .eq("source_id", sourceId)
    .order("chunk_index", { ascending: false })
    .limit(1);
  const start = last?.length ? (last[0].chunk_index as number) + 1 : 0; // keeps (source_id, chunk_index) unique

  await insertChunks(
    supabase,
    chapters.map((chapter, i) => ({
      source_id: sourceId,
      user_id: userId,
      chunk_index: start + i,
      content: summaries[i],
      chapter_title: chapter,
      chunk_type: "chapter_summary",
      embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
      indexed_at: new Date().toISOString(),
      token_count: Math.ceil(summaries[i].length / 4),
    })),
  );

  const oldIds = (old ?? []).map((c) => c.id as string);
  for (let i = 0; i < oldIds.length; i += 100) {
    await supabase.from("chunks").delete().in("id", oldIds.slice(i, i + 100));
  }

  const { count } = await supabase.from("chunks").select("id", { count: "exact", head: true }).eq("source_id", sourceId);
  await supabase
    .from("sources")
    .update({
      total_chunks: count ?? chapters.length,
      toc_source: toc.source,
      toc_source_url: toc.sourceUrl,
      last_ingested: new Date().toISOString(),
    })
    .eq("id", sourceId);

  return { chapters: chapters.length };
}

// ─── Digital books (PDF / ePub) ───────────────────────────────────────────────

/**
 * Index a digital book whose text is already extracted (PDF / ePub).
 * Shared by the import page (via addDigitalBook) and local scripts (sync/import-pdf.ts).
 */
export async function ingestDigitalBook(
  supabase: SupabaseClient,
  userId: string,
  data: DigitalBookInput,
): Promise<{ sourceId: string }> {
  const chunks = data.chunks
    .map((c) => ({ ...c, content: stripNul(c.content), chapterTitle: c.chapterTitle ? stripNul(c.chapterTitle) : c.chapterTitle }))
    .filter((c) => c.content.trim().length > 0);
  if (chunks.length === 0) throw new Error("No readable text found in this file");

  // Replace any earlier failed import of the same book
  await supabase
    .from("sources")
    .delete()
    .eq("user_id", userId)
    .eq("source_type", "ebook")
    .eq("ingest_status", "failed")
    .ilike("title", stripNul(data.title));

  // 1. Create source
  const { data: source, error: sourceErr } = await supabase
    .from("sources")
    .insert({
      user_id: userId,
      source_type: "ebook",
      title: stripNul(data.title),
      author: data.author ? stripNul(data.author) : null,
      isbn: data.isbn ?? null,
      cover_url: data.coverUrl ?? null,
      description: data.description ?? null,
      ingest_status: "processing",
      authority_tier: 3,
    })
    .select("id")
    .single();

  if (sourceErr || !source) throw new Error(sourceErr?.message ?? "Failed to create source");

  try {
    // 2. Embed in batches of 100
    const { embedBatch } = await import("@/lib/gemini");
    const BATCH = 100;
    const allEmbeddings: (number[] | null)[] = [];

    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH).map((c) => c.content);
      const embeddings = await embedBatch(batch).catch(() => batch.map(() => null));
      allEmbeddings.push(...embeddings);
    }

    // 3. Insert chunks
    const chunkRows = chunks.map((chunk, i) => ({
      source_id: source.id,
      user_id: userId,
      chunk_index: i,
      content: chunk.content,
      chapter_title: chunk.chapterTitle ?? null,
      chunk_type: "passage",
      embedding: allEmbeddings[i] ? JSON.stringify(allEmbeddings[i]) : null,
      indexed_at: new Date().toISOString(),
      token_count: Math.ceil(chunk.content.length / 4),
    }));

    await insertChunks(supabase, chunkRows);

    // 4. Mark complete
    await supabase
      .from("sources")
      .update({
        ingest_status: "complete",
        total_chunks: chunks.length,
        last_ingested: new Date().toISOString(),
      })
      .eq("id", source.id);

    return { sourceId: source.id as string };
  } catch (err) {
    await supabase
      .from("sources")
      .update({ ingest_status: "failed", ingest_error: String(err) })
      .eq("id", source.id);
    throw err;
  }
}
