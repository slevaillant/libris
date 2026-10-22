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

const MAX_NEW_ARTICLES_PER_RUN = 5;

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

  async scheduled(event: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY } = env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error("Cron: missing SUPABASE_URL or SUPABASE_SERVICE_KEY — skipping sync");
      return;
    }

    const cronExpr = (event as { cron?: string }).cron ?? "";

    // ── Weekly pattern analysis (Sunday 06:00 UTC) ───────────────────────────
    if (cronExpr === "0 8 * * SUN") {
      ctx.waitUntil(
        (async () => {
          const { createClient } = await import("@supabase/supabase-js");
          const { default: Anthropic } = await import("@anthropic-ai/sdk");
          const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
          const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

          const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const { data: recentUsers } = await supabase
            .from("nudges")
            .select("user_id")
            .gt("created_at", cutoff);

          const userIds = [...new Set((recentUsers ?? []).map((r: { user_id: string }) => r.user_id))];

          for (const userId of userIds) {
            try {
              const { data: nudges } = await supabase
                .from("nudges")
                .select("query_text, coverage_quality, helpful")
                .eq("user_id", userId)
                .order("created_at", { ascending: false })
                .limit(30);

              if (!nudges || nudges.length < 5) continue;

              const nudgesText = (nudges as { query_text: string; coverage_quality: string | null; helpful: boolean | null }[])
                .map((n) => `Q: ${n.query_text} [coverage: ${n.coverage_quality ?? "?"}, rating: ${n.helpful === true ? "good" : n.helpful === false ? "bad" : "unrated"}]`)
                .join("\n");

              const res = await anthropic.messages.create({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 256,
                system: [{ type: "text" as const, text: "Analyse query patterns in a personal knowledge system. Extract 3–5 pattern observations about recurring topics, coverage gaps, or usage habits. Use the extract_patterns tool only.", cache_control: { type: "ephemeral" as const } }],
                tools: [{
                  name: "extract_patterns",
                  description: "Extract usage pattern observations",
                  input_schema: { type: "object" as const, properties: { patterns: { type: "array" as const, items: { type: "string" as const }, minItems: 1, maxItems: 5 } }, required: ["patterns"] },
                }],
                tool_choice: { type: "tool" as const, name: "extract_patterns" },
                messages: [{ role: "user", content: `Recent queries (last 30):\n\n${nudgesText}` }],
              });

              const toolUse = res.content.find((b) => b.type === "tool_use");
              if (!toolUse || toolUse.type !== "tool_use") continue;
              const patterns = (toolUse.input as { patterns: string[] }).patterns;

              await supabase.from("user_memories").delete().eq("user_id", userId).eq("memory_type", "pattern");
              if (patterns.length > 0) {
                const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
                await supabase.from("user_memories").insert(
                  patterns.map((p) => ({
                    user_id: userId,
                    memory_type: "pattern",
                    content: p,
                    confidence: 0.7,
                    expires_at: expires,
                    last_referenced: new Date().toISOString(),
                  })),
                );
              }
              console.log(`Cron pattern analysis: ${patterns.length} patterns for user ${userId}`);
            } catch (err) {
              console.error(`Cron pattern analysis failed for ${userId}:`, err);
            }
          }
        })(),
      );
      return;
    }

    // ── Weekly Friday deep-dive digest (12:00 Europe/Paris) ──────────────────
    // Scheduled at 10:00 and 11:00 UTC; isWeeklyDigestSlot keeps only the run at 12:00 Paris.
    if (cronExpr === "0 10 * * FRI" || cronExpr === "0 11 * * FRI") {
      ctx.waitUntil(
        (async () => {
          const { isWeeklyDigestSlot, runWeeklyDigest } = await import("./lib/weekly-digest");
          if (!isWeeklyDigestSlot(new Date())) return;

          const { createClient } = await import("@supabase/supabase-js");
          const { default: Anthropic } = await import("@anthropic-ai/sdk");
          if (GEMINI_API_KEY) process.env.GEMINI_API_KEY = GEMINI_API_KEY;
          if (ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;

          await runWeeklyDigest(createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY), new Anthropic({ apiKey: ANTHROPIC_API_KEY }), {
            appUrl: process.env.APP_URL ?? "https://libris.seblevaillant.com",
          });
        })(),
      );
      return;
    }

    // ── Daily Substack sync (08:00 UTC) — indexing only, no email ────────────
    ctx.waitUntil(
      (async () => {
        const { createClient } = await import("@supabase/supabase-js");
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const { fetchSubstackFeed } = await import("./lib/sources/rss");
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

          // Release articles left in "processing" by an interrupted run so they get re-indexed
          // (their URL would otherwise block them forever via the duplicate check below)
          const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          const { count: released } = await supabase
            .from("sources")
            .delete({ count: "exact" })
            .eq("user_id", userId)
            .eq("source_type", "substack")
            .eq("ingest_status", "processing")
            .lt("created_at", staleBefore);
          if (released) console.log(`Cron: released ${released} stale Substack source(s) for user ${userId}`);

          // All indexed URLs for duplicate check
          const { data: indexed } = await supabase.from("sources").select("url").eq("user_id", userId);
          const indexedUrls = new Set((indexed ?? []).map((s: { url: string }) => s.url).filter(Boolean));

          // Cap new articles per run so the cron finishes within Workers limits;
          // the rest is picked up on the following days
          let budget = MAX_NEW_ARTICLES_PER_RUN;
          for (const handle of newsletters) {
            if (budget <= 0) break;
            try {
              const feed = await fetchSubstackFeed(handle);
              const candidates = feed.articles
                .slice(0, 3)
                .filter((a) => a.url && !indexedUrls.has(a.url))
                .slice(0, budget);
              budget -= candidates.length;

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
