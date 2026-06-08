import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;
  const body = await response.clone().text();
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return response; }
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return response;
  const fields = payload as Record<string, unknown>;
  if (fields.unhandled === true && fields.message === "HTTPError") {
    console.error(consumeLastCapturedError() ?? new Error(`SSR error: ${body}`));
    return brandedErrorResponse();
  }
  return response;
}

type Env = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
};

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },

  async scheduled(_event: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY } = env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error("Cron: missing SUPABASE_URL or SUPABASE_SERVICE_KEY — skipping sync");
      return;
    }

    ctx.waitUntil(
      (async () => {
        const { createClient } = await import("@supabase/supabase-js");
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const { fetchSubstackFeed, stripHtml } = await import("./lib/sources/rss");
        const { fetchWebArticle } = await import("./lib/sources/web");

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

        // Inject env vars for shared helpers (gemini embeddings, etc.)
        if (GEMINI_API_KEY) process.env.GEMINI_API_KEY = GEMINI_API_KEY;
        if (ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;

        // Get all users who have substack sources
        const { data: rows } = await supabase
          .from("sources")
          .select("user_id, url")
          .eq("source_type", "substack");

        // Group by user
        const byUser = new Map<string, string[]>();
        for (const { user_id, url } of rows ?? []) {
          if (!byUser.has(user_id)) byUser.set(user_id, []);
          byUser.get(user_id)!.push(url);
        }

        for (const [userId, urls] of byUser) {
          // Derive unique newsletter handles for this user
          const newsletters = new Set<string>();
          for (const url of urls) {
            try {
              const u = new URL(url);
              const m = u.hostname.match(/^([a-z0-9-]+)\.substack\.com$/i);
              newsletters.add(m ? m[1] : `${u.protocol}//${u.hostname}`);
            } catch {}
          }

          // All indexed URLs for duplicate check
          const { data: indexed } = await supabase.from("sources").select("url").eq("user_id", userId);
          const indexedUrls = new Set((indexed ?? []).map((s: { url: string }) => s.url).filter(Boolean));

          for (const handle of newsletters) {
            try {
              const feed = await fetchSubstackFeed(handle);
              const candidates = feed.articles.slice(0, 3).filter((a) => a.url && !indexedUrls.has(a.url));

              for (const article of candidates) {
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
                indexedUrls.add(article.url);

                try {
                  let fullContent = article.content;
                  try {
                    const full = await fetchWebArticle(article.url);
                    if (full.content.length > article.content.length * 1.5) fullContent = full.content;
                  } catch {}

                  // Key ideas via Haiku
                  const ideasRes = await anthropic.messages.create({
                    model: "claude-haiku-4-5-20251001",
                    max_tokens: 512,
                    system: [{ type: "text", text: "Extract 3–5 key ideas from this article. Use the extract_key_ideas tool only.", cache_control: { type: "ephemeral" } }],
                    tools: [{ name: "extract_key_ideas", description: "Extract key ideas", input_schema: { type: "object", properties: { ideas: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 } }, required: ["ideas"] } }],
                    tool_choice: { type: "tool", name: "extract_key_ideas" },
                    messages: [{ role: "user", content: `Article: "${article.title}"\n\n${fullContent.slice(0, 6000)}` }],
                  });
                  const toolUse = ideasRes.content.find((b) => b.type === "tool_use");
                  const ideas: string[] = toolUse && toolUse.type === "tool_use" ? (toolUse.input as { ideas: string[] }).ideas : [];

                  // Paragraph chunks
                  const paragraphs = fullContent.split(/\n\n+/).map((p) => p.trim()).filter((p) => p.length > 40);
                  const paragraphChunks: string[] = [];
                  let buf = "";
                  for (const para of paragraphs) {
                    const cand = buf ? `${buf}\n\n${para}` : para;
                    if (cand.length > 2400 && buf) { paragraphChunks.push(buf); buf = para; } else { buf = cand; }
                  }
                  if (buf.trim()) paragraphChunks.push(buf);

                  // Embed + insert
                  const { embedBatch } = await import("./lib/gemini");
                  const texts = [...ideas.map((_, i) => `Key idea ${i + 1}: ${ideas[i]}`), ...paragraphChunks];
                  const embeddings = await embedBatch(texts).catch(() => texts.map(() => null));

                  const chunkRows = [
                    ...ideas.map((idea, i) => ({
                      source_id: source.id,
                      user_id: userId,
                      chunk_index: i,
                      content: idea,
                      chapter_title: `Key idea ${i + 1}`,
                      chunk_type: "key_idea",
                      embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
                      indexed_at: new Date().toISOString(),
                      token_count: Math.ceil(idea.length / 4),
                    })),
                    ...paragraphChunks.map((p, i) => ({
                      source_id: source.id,
                      user_id: userId,
                      chunk_index: ideas.length + i,
                      content: p,
                      chapter_title: `Section ${i + 1}`,
                      chunk_type: "passage",
                      embedding: embeddings[ideas.length + i] ? JSON.stringify(embeddings[ideas.length + i]) : null,
                      indexed_at: new Date().toISOString(),
                      token_count: Math.ceil(p.length / 4),
                    })),
                  ];

                  await supabase.from("chunks").insert(chunkRows);
                  await supabase.from("sources").update({ ingest_status: "complete", total_chunks: chunkRows.length, last_ingested: new Date().toISOString() }).eq("id", source.id);
                  console.log(`Cron: indexed "${article.title}" for user ${userId}`);
                } catch (err) {
                  await supabase.from("sources").update({ ingest_status: "failed", ingest_error: String(err) }).eq("id", source.id);
                }
              }
            } catch (err) {
              console.error(`Cron: failed to sync ${handle}:`, err);
            }
          }
        }
      })(),
    );
  },
};
