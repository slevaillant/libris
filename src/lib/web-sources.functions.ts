import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { embedBatch } from "@/lib/gemini";

// ─── Shared types ─────────────────────────────────────────────────────────────

export type WebSourcePreview = {
  title: string;
  description: string | null;
  url: string;
  itemCount?: number;
  items?: { title: string; date: string | null }[];
};

// ─── Key idea extraction (Haiku) — shared by article + Substack flows ─────────

async function extractKeyIdeas(
  anthropic: Anthropic,
  title: string,
  author: string | null,
  content: string,
): Promise<string[]> {
  // Cap input to keep Haiku cost low
  const truncated = content.slice(0, 6000);

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: [
      {
        type: "text" as const,
        text: "You extract key ideas from articles for a personal knowledge system. Each key idea must be a standalone, citable claim — specific to this article, not generic. Use the extract_key_ideas tool only.",
        cache_control: { type: "ephemeral" as const },
      },
    ],
    tools: [
      {
        name: "extract_key_ideas",
        description: "Extract 3–5 key ideas from this article",
        input_schema: {
          type: "object" as const,
          properties: {
            ideas: {
              type: "array" as const,
              items: { type: "string" as const },
              minItems: 1,
              maxItems: 5,
              description: "Standalone, citable claims from the article",
            },
          },
          required: ["ideas"],
        },
      },
    ],
    tool_choice: { type: "tool" as const, name: "extract_key_ideas" },
    messages: [
      {
        role: "user",
        content: `Article: "${title}"${author ? ` by ${author}` : ""}\n\n${truncated}`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return [];
  return (toolUse.input as { ideas: string[] }).ideas;
}

// ─── Paragraph chunker (shared) ───────────────────────────────────────────────

function chunkByParagraph(text: string, maxChars = 2400): string[] {
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40);

  const chunks: string[] = [];
  let buffer = "";

  for (const para of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (candidate.length > maxChars && buffer) {
      chunks.push(buffer);
      buffer = para;
    } else {
      buffer = candidate;
    }
  }
  if (buffer.trim()) chunks.push(buffer);
  return chunks;
}

// ─── Ingest helper: embed + insert chunks for a source ───────────────────────

type RawChunk = {
  content: string;
  chunkType: "key_idea" | "passage";
  sectionTitle?: string | null;
  chunkIndex: number;
};

async function ingestChunks(
  supabase: SupabaseClient,
  userId: string,
  sourceId: string,
  rawChunks: RawChunk[],
) {
  if (rawChunks.length === 0) return;

  const texts = rawChunks.map((c) => c.content);
  const embeddings = await embedBatch(texts).catch(() => texts.map(() => null));

  const rows = rawChunks.map((c, i) => ({
    source_id: sourceId,
    user_id: userId,
    chunk_index: c.chunkIndex,
    content: c.content,
    chapter_title: c.sectionTitle ?? null,
    chunk_type: c.chunkType,
    embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
    indexed_at: new Date().toISOString(),
    token_count: Math.ceil(c.content.length / 4),
  }));

  await supabase.from("chunks").insert(rows);
}

// ─── Preview Substack ─────────────────────────────────────────────────────────

export const previewSubstack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ handle: z.string().min(1) }).parse(i))
  .handler(async ({ data }): Promise<WebSourcePreview> => {
    const { fetchSubstackFeed } = await import("@/lib/sources/rss");
    const feed = await fetchSubstackFeed(data.handle);
    return {
      title: feed.newsletterTitle,
      description: feed.description,
      url: `https://${data.handle}.substack.com`,
      itemCount: feed.articles.length,
      items: feed.articles.slice(0, 5).map((a) => ({ title: a.title, date: a.publishedDate })),
    };
  });

// ─── Ingest Substack (last 5 articles) ───────────────────────────────────────

export const ingestSubstack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ handle: z.string().min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const { fetchSubstackFeed } = await import("@/lib/sources/rss");
    const feed = await fetchSubstackFeed(data.handle);
    const articles = feed.articles.slice(0, 5);

    const ingested: string[] = [];

    for (const article of articles) {
      // Skip if already indexed
      const { data: existing } = await supabase
        .from("sources")
        .select("id")
        .eq("user_id", userId)
        .eq("url", article.url)
        .maybeSingle();
      if (existing) continue;

      const { data: source } = await supabase
        .from("sources")
        .insert({
          user_id: userId,
          source_type: "substack",
          title: article.title,
          author: article.author ?? feed.newsletterTitle,
          url: article.url,
          publication_date: article.publishedDate ?? null,
          description: null,
          ingest_status: "processing",
          authority_tier: 3,
        })
        .select("id")
        .single();

      if (!source) continue;

      try {
        // Extract key ideas (Haiku)
        const ideas = await extractKeyIdeas(anthropic, article.title, article.author, article.content);

        // Paragraph chunks from body
        const paragraphChunks = chunkByParagraph(article.content);

        const rawChunks: RawChunk[] = [
          ...ideas.map((idea, i) => ({
            content: idea,
            chunkType: "key_idea" as const,
            sectionTitle: article.title,
            chunkIndex: i,
          })),
          ...paragraphChunks.map((p, i) => ({
            content: p,
            chunkType: "passage" as const,
            sectionTitle: null,
            chunkIndex: ideas.length + i,
          })),
        ];

        await ingestChunks(supabase as Parameters<typeof ingestChunks>[0], userId, source.id, rawChunks);

        await supabase
          .from("sources")
          .update({ ingest_status: "complete", total_chunks: rawChunks.length, last_ingested: new Date().toISOString() })
          .eq("id", source.id);

        ingested.push(article.title);
      } catch (err) {
        await supabase
          .from("sources")
          .update({ ingest_status: "failed", ingest_error: String(err) })
          .eq("id", source.id);
      }
    }

    return { ingested, total: articles.length };
  });

// ─── Preview GitHub repo ──────────────────────────────────────────────────────

export const previewGithubRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ url: z.string().url() }).parse(i))
  .handler(async ({ data }): Promise<WebSourcePreview> => {
    const { fetchGithubRepo } = await import("@/lib/sources/github");
    const token = process.env.GITHUB_TOKEN;
    const repo = await fetchGithubRepo(data.url, token);
    return {
      title: repo.title,
      description: repo.description,
      url: repo.url,
      itemCount: repo.chunks.length,
    };
  });

// ─── Ingest GitHub repo ───────────────────────────────────────────────────────

export const ingestGithubRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ url: z.string().url() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { fetchGithubRepo } = await import("@/lib/sources/github");

    // Skip if already indexed
    const { data: existing } = await supabase
      .from("sources")
      .select("id")
      .eq("user_id", userId)
      .eq("url", data.url)
      .maybeSingle();
    if (existing) throw new Error("This repo is already in your library");

    const token = process.env.GITHUB_TOKEN;
    const repo = await fetchGithubRepo(data.url, token);

    if (repo.chunks.length === 0) throw new Error("No indexable content found in this repo");

    const { data: source } = await supabase
      .from("sources")
      .insert({
        user_id: userId,
        source_type: "github_repo",
        title: repo.title,
        author: null,
        url: repo.url,
        description: repo.description,
        ingest_status: "processing",
        authority_tier: 3,
      })
      .select("id")
      .single();

    if (!source) throw new Error("Failed to create source");

    try {
      const rawChunks: RawChunk[] = repo.chunks.map((c, i) => ({
        content: c.content,
        chunkType: "passage" as const,
        sectionTitle: c.sectionTitle,
        chunkIndex: i,
      }));

      await ingestChunks(supabase as Parameters<typeof ingestChunks>[0], userId, source.id, rawChunks);

      await supabase
        .from("sources")
        .update({ ingest_status: "complete", total_chunks: rawChunks.length, last_ingested: new Date().toISOString() })
        .eq("id", source.id);

      return { sourceId: source.id as string, chunks: rawChunks.length };
    } catch (err) {
      await supabase
        .from("sources")
        .update({ ingest_status: "failed", ingest_error: String(err) })
        .eq("id", source.id);
      throw err;
    }
  });

// ─── Preview web article ──────────────────────────────────────────────────────

export const previewWebArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ url: z.string().url() }).parse(i))
  .handler(async ({ data }): Promise<WebSourcePreview> => {
    const { fetchWebArticle } = await import("@/lib/sources/web");
    const article = await fetchWebArticle(data.url);
    return {
      title: article.title,
      description: article.author ?? null,
      url: article.url,
    };
  });

// ─── Ingest web article ───────────────────────────────────────────────────────

export const ingestWebArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ url: z.string().url() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Skip if already indexed
    const { data: existing } = await supabase
      .from("sources")
      .select("id")
      .eq("user_id", userId)
      .eq("url", data.url)
      .maybeSingle();
    if (existing) throw new Error("This article is already in your library");

    const { fetchWebArticle } = await import("@/lib/sources/web");
    const article = await fetchWebArticle(data.url);

    const { data: source } = await supabase
      .from("sources")
      .insert({
        user_id: userId,
        source_type: "web_article",
        title: article.title,
        author: article.author ?? null,
        url: article.url,
        publication_date: article.publishedDate ?? null,
        description: null,
        ingest_status: "processing",
        authority_tier: 3,
      })
      .select("id")
      .single();

    if (!source) throw new Error("Failed to create source");

    try {
      const ideas = await extractKeyIdeas(anthropic, article.title, article.author, article.content);
      const paragraphChunks = chunkByParagraph(article.content);

      const rawChunks: RawChunk[] = [
        ...ideas.map((idea, i) => ({
          content: idea,
          chunkType: "key_idea" as const,
          sectionTitle: article.title,
          chunkIndex: i,
        })),
        ...paragraphChunks.map((p, i) => ({
          content: p,
          chunkType: "passage" as const,
          sectionTitle: null,
          chunkIndex: ideas.length + i,
        })),
      ];

      await ingestChunks(supabase as Parameters<typeof ingestChunks>[0], userId, source.id, rawChunks);

      await supabase
        .from("sources")
        .update({ ingest_status: "complete", total_chunks: rawChunks.length, last_ingested: new Date().toISOString() })
        .eq("id", source.id);

      return { sourceId: source.id as string, chunks: rawChunks.length };
    } catch (err) {
      await supabase
        .from("sources")
        .update({ ingest_status: "failed", ingest_error: String(err) })
        .eq("id", source.id);
      throw err;
    }
  });
