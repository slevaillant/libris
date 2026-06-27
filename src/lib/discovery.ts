// Discovers external resources for a digest topic via Gemini + Google Search grounding,
// then ingests them directly into the user's library.

import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";

export type DiscoveredResource = {
  url: string;
  title: string;
  sourceType: "article" | "youtube" | "github";
  ingested: boolean;
};

// ─── Gemini grounding search ──────────────────────────────────────────────────

type GroundingChunk = { web?: { uri: string; title?: string } };

export async function discoverResourcesViaGemini(
  topic: string,
  geminiApiKey: string,
): Promise<{ url: string; title: string }[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Find 3 high-quality, practical resources to learn about: "${topic}".
Prefer articles with concrete insights, YouTube videos from recognised experts, or GitHub repos with working implementations.
Avoid marketing pages, paywalled content, or generic overviews.`,
          }],
        }],
        tools: [{ googleSearch: {} }],
      }),
    },
  ).catch(() => null);

  if (!res?.ok) return [];

  const data = await res.json() as {
    candidates?: Array<{
      groundingMetadata?: { groundingChunks?: GroundingChunk[] };
    }>;
  };

  const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  return chunks
    .filter((c): c is { web: { uri: string; title?: string } } => {
      const uri = c.web?.uri;
      if (!uri) return false;
      if (uri.includes("google.com/search")) return false;
      if (uri.includes("google.com/maps")) return false;
      return true;
    })
    .map((c) => ({ url: c.web.uri, title: c.web.title ?? c.web.uri }))
    .slice(0, 3);
}

// ─── URL type detection ───────────────────────────────────────────────────────

function detectSourceType(url: string): "youtube" | "github" | "article" {
  if (url.includes("youtube.com/watch") || url.includes("youtu.be/")) return "youtube";
  if (url.match(/github\.com\/[^/]+\/[^/]+/)) return "github";
  return "article";
}

// ─── Ingestion helpers ────────────────────────────────────────────────────────

async function extractKeyIdeas(anthropic: Anthropic, title: string, content: string): Promise<string[]> {
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: [{ type: "text", text: "Extract 3–5 key ideas from this content. Use the extract_key_ideas tool only.", cache_control: { type: "ephemeral" } }],
      tools: [{
        name: "extract_key_ideas",
        description: "Extract key ideas",
        input_schema: {
          type: "object" as const,
          properties: { ideas: { type: "array" as const, items: { type: "string" as const }, minItems: 1, maxItems: 5 } },
          required: ["ideas"],
        },
      }],
      tool_choice: { type: "tool" as const, name: "extract_key_ideas" },
      messages: [{ role: "user", content: `"${title}"\n\n${content.slice(0, 6000)}` }],
    });
    const toolUse = res.content.find((b) => b.type === "tool_use");
    return toolUse?.type === "tool_use" ? (toolUse.input as { ideas: string[] }).ideas : [];
  } catch {
    return [];
  }
}

function splitIntoParagraphChunks(content: string): string[] {
  const paragraphs = content.split(/\n\n+/).map((p) => p.trim()).filter((p) => p.length > 40);
  const result: string[] = [];
  let buf = "";
  for (const para of paragraphs) {
    const cand = buf ? `${buf}\n\n${para}` : para;
    if (cand.length > 2400 && buf) { result.push(buf); buf = para; } else { buf = cand; }
  }
  if (buf.trim()) result.push(buf);
  return result;
}

// ─── Ingest one discovered URL ────────────────────────────────────────────────

export async function ingestDiscoveredUrl(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  userId: string,
  resource: { url: string; title: string },
): Promise<DiscoveredResource> {
  const sourceType = detectSourceType(resource.url);
  const base: DiscoveredResource = { url: resource.url, title: resource.title, sourceType, ingested: false };

  // Deduplicate
  const { count } = await supabase
    .from("sources")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("url", resource.url);
  if ((count ?? 0) > 0) return base;

  try {
    let title = resource.title;
    let author: string | null = null;
    let rawChunks: { content: string; chapterTitle: string | null; chunkType: string }[] = [];

    if (sourceType === "article") {
      const { fetchWebArticle } = await import("./sources/web");
      const article = await fetchWebArticle(resource.url);
      title = article.title || title;
      author = article.author;
      const ideas = await extractKeyIdeas(anthropic, title, article.content);
      const paragraphs = splitIntoParagraphChunks(article.content);
      rawChunks = [
        ...ideas.map((idea, i) => ({ content: idea, chapterTitle: `Key idea ${i + 1}`, chunkType: "key_idea" })),
        ...paragraphs.map((p, i) => ({ content: p, chapterTitle: `Section ${i + 1}`, chunkType: "passage" })),
      ];
    } else if (sourceType === "youtube") {
      const { fetchYouTubeVideo, chunkTranscriptWithTimestamps, formatTimestamp } = await import("./sources/youtube");
      const video = await fetchYouTubeVideo(resource.url);
      title = video.title || title;
      author = video.author;
      if (video.timedSegments) {
        if (video.transcriptSource === "captions") {
          rawChunks = chunkTranscriptWithTimestamps(video.timedSegments).map((c) => ({
            content: c.text,
            chapterTitle: formatTimestamp(c.startSeconds),
            chunkType: "passage",
          }));
        } else {
          rawChunks = video.timedSegments.map((s, i) => ({
            content: s.text,
            chapterTitle: formatTimestamp(s.startSeconds),
            chunkType: "passage",
          }));
        }
      }
      if (rawChunks.length === 0) return base;
    } else {
      const { fetchGithubRepo, fetchGithubGist, isGistUrl } = await import("./sources/github");
      const token = process.env.GITHUB_TOKEN;
      const repo = isGistUrl(resource.url)
        ? await fetchGithubGist(resource.url, token)
        : await fetchGithubRepo(resource.url, token);
      title = repo.title || title;
      const ownerMatch = resource.url.match(/github\.com\/([^/]+)/);
      author = ownerMatch?.[1] ?? null;
      rawChunks = repo.chunks.map((c, i) => ({
        content: c.content,
        chapterTitle: c.sectionTitle ?? `Section ${i + 1}`,
        chunkType: "passage",
      }));
    }

    if (rawChunks.length === 0) return base;

    const { data: source } = await supabase
      .from("sources")
      .insert({
        user_id: userId,
        source_type: sourceType === "youtube" ? "youtube" : sourceType === "github" ? "github" : "article",
        title,
        author,
        url: resource.url,
        ingest_status: "processing",
        authority_tier: 3,
      })
      .select("id")
      .single();

    if (!source) return base;

    const { embedBatch } = await import("./gemini");
    const embeddings = await embedBatch(rawChunks.map((c) => c.content)).catch(() => rawChunks.map(() => null));

    await supabase.from("chunks").insert(
      rawChunks.map((c, i) => ({
        source_id: source.id,
        user_id: userId,
        chunk_index: i,
        content: c.content,
        chapter_title: c.chapterTitle,
        chunk_type: c.chunkType,
        embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
        indexed_at: new Date().toISOString(),
        token_count: Math.ceil(c.content.length / 4),
      })),
    );

    await supabase.from("sources")
      .update({ ingest_status: "complete", total_chunks: rawChunks.length, last_ingested: new Date().toISOString() })
      .eq("id", source.id);

    console.log(`[discovery] ingested "${title}" (${sourceType}) — ${rawChunks.length} chunks`);
    return { url: resource.url, title, sourceType, ingested: true };
  } catch (err) {
    console.error(`[discovery] failed to ingest ${resource.url}:`, err);
    return base;
  }
}

// ─── Run discovery for a topic (convenience wrapper) ─────────────────────────

export async function discoverAndIngest(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  userId: string,
  topic: string,
): Promise<DiscoveredResource[]> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) return [];

  const found = await discoverResourcesViaGemini(topic, geminiApiKey);
  if (found.length === 0) return [];

  return Promise.all(found.map((r) => ingestDiscoveredUrl(supabase, anthropic, userId, r)));
}
