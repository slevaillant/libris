#!/usr/bin/env tsx
/**
 * Trigger the daily digest locally (same logic as Cloudflare cron handler).
 * Usage: npx tsx sync/trigger-digest.ts
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import fs from "node:fs";

// Load .env.local
const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌  Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

if (GEMINI_API_KEY) process.env.GEMINI_API_KEY = GEMINI_API_KEY;
if (ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;

const { parseTopicsFromMd, parseTopicTitlesFromMd } = await import("../src/lib/digest.functions.js");
const { buildDigestEmail, sendEmail } = await import("../src/lib/email.js");
const { embed } = await import("../src/lib/gemini.js");

const { data: profiles } = await supabase
  .from("user_profiles")
  .select("user_id, display_name, librarian_name, digest_email, topics_md")
  .eq("digest_enabled", true)
  .not("topics_md", "is", null)
  .not("digest_email", "is", null);

if (!profiles?.length) {
  console.error("❌  No eligible profiles (digest_enabled=true, topics_md set, digest_email set)");
  process.exit(1);
}

for (const p of profiles) {
  const topics = parseTopicsFromMd(p.topics_md as string);
  const topicTitles = parseTopicTitlesFromMd(p.topics_md as string);
  if (topics.length === 0) { console.log(`⚠  No active topics for ${p.display_name}`); continue; }

  console.log(`\n▶  Running digest for ${p.display_name} (${topics.length} topics)…`);

  const runDate = new Date().toLocaleDateString("en-CA");
  const { data: run } = await supabase
    .from("digest_runs")
    .upsert({ user_id: p.user_id, run_date: runDate, meetings_found: 1, themes_found: topics.length }, { onConflict: "user_id,run_date" })
    .select("id").single();
  const digestRunId = run?.id as string ?? crypto.randomUUID();

  const sections: { theme: string; synthesis: string; citations: { title: string; author: string | null; chapterTitle: string | null; url: string | null }[]; readingSuggestion: null }[] = [];
  let citationCount = 0;

  for (let i = 0; i < Math.min(topics.length, 8); i++) {
    const searchQuery = topics[i];
    const displayTheme = topicTitles[i] ?? searchQuery;
    console.log(`  [${i + 1}/${topics.length}] ${displayTheme}`);

    const embedding = await embed(searchQuery).catch(() => null);
    if (!embedding) { console.log("       ⚠  embed failed, skipping"); continue; }

    const { data: chunks } = await supabase.rpc("match_chunks", {
      p_user_id: p.user_id,
      p_query_embedding: `[${embedding.join(",")}]`,
      p_match_count: 5,
      p_min_score: 0.50,
    });
    const matched = (chunks ?? []) as { chunk_id: string; source_id: string; title: string; author: string | null; chapter_title: string | null; content: string; similarity: number; url: string | null }[];

    // Discovery: find and ingest external resources when coverage is thin
    let discoveredResources: { url: string; title: string; sourceType: string; ingested: boolean }[] = [];
    if (matched.length < 2) {
      console.log(`       🔍 thin coverage — discovering external resources…`);
      const { discoverAndIngest } = await import("../src/lib/discovery.js");
      discoveredResources = await discoverAndIngest(supabase, anthropic, p.user_id, searchQuery);
      console.log(`       📥 ${discoveredResources.filter(r => r.ingested).length} resource(s) ingested`);
    }
    if (matched.length === 0 && discoveredResources.filter(r => r.ingested).length === 0) continue;

    let synthesis = `My sources on "${displayTheme}" are thinner than I'd like.`;
    if (matched.length > 0) {
      const passages = matched.map((c, j) => `[${j + 1}] ${c.title}${c.author ? ` — ${c.author}` : ""}\n${c.content.slice(0, 400)}`).join("\n\n");
      const res = await anthropic.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 1024,
        messages: [{ role: "user", content: [
          { type: "text", text: `You are ${p.librarian_name ?? "Lumen"}, synthesising a morning digest for ${p.display_name ?? "there"}. Write one focused paragraph connecting this theme to the library passages. End with a specific reading suggestion.`, cache_control: { type: "ephemeral" } },
          { type: "text", text: `Theme: "${displayTheme}"\n\nPassages:\n${passages}` },
        ]}],
      });
      const tb = res.content.find(b => b.type === "text");
      if (tb?.type === "text") synthesis = tb.text;
    }

    const seenUrls = new Set<string>();
    const citations = matched
      .filter(c => { const k = c.url ?? c.source_id; if (seenUrls.has(k)) return false; seenUrls.add(k); return true; })
      .slice(0, 3)
      .map(c => ({ title: c.title, author: c.author, chapterTitle: null, url: c.url ?? null }));
    citationCount += citations.length;
    sections.push({ theme: displayTheme, synthesis, citations, readingSuggestion: null, discoveredResources: discoveredResources.length > 0 ? discoveredResources : undefined });

    await supabase.from("digest_themes").insert({ digest_run_id: digestRunId, user_id: p.user_id, theme_text: displayTheme, theme_type: "topic", synthesis });
  }

  await supabase.from("digest_runs").update({ citations_found: citationCount }).eq("id", digestRunId);

  if (sections.length === 0) { console.log("  ⚠  No sections generated"); continue; }

  const dateLabel = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const appUrl = process.env.APP_URL ?? "https://libris.seblevaillant.com";
  const { subject, html, text } = buildDigestEmail(p.display_name ?? "there", p.librarian_name ?? "Lumen", dateLabel, sections, `${appUrl}/quiz/${digestRunId}`);
  const result = await sendEmail({ to: p.digest_email as string, subject, html, text });

  await supabase.from("digest_runs").update({ email_sent: result.sent, email_sent_at: result.sent ? new Date().toISOString() : null }).eq("id", digestRunId);
  console.log(`  ${result.sent ? "✓  Email sent" : "❌  Email failed"} → ${p.digest_email}`);
  if (!result.sent && result.error) console.error(`     Error: ${result.error}`);
}
