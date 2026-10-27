#!/usr/bin/env tsx
/**
 * Import a static reading page (e.g. course notes published as a single HTML page) as a
 * web_article source, one chapter per <section>/<h2>, paragraphs preserved. Dry run by default.
 *
 * Usage: npx tsx sync/import-reading-page.ts --url URL [--title "..."] [--author "..."] [--apply] [--force]
 *   --apply   embed and insert into Supabase
 *   --force   replace an existing source with the same URL (new import first, old deleted after)
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_KEY and GEMINI_API_KEY from .env.local (or env).
 * Never prints page content.
 */

import { createClient } from "@supabase/supabase-js";
import type { Paragraph } from "../src/lib/sources/paragraphs.js";
import fs from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) {
  console.error("❌  Missing SUPABASE_URL, SUPABASE_SERVICE_KEY or GEMINI_API_KEY (set in .env.local)");
  process.exit(1);
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");
const url = arg("--url");
if (!url) {
  console.error("❌  --url is required");
  process.exit(1);
}

const { JSDOM } = await import("jsdom");
const { chunkParagraphs } = await import("../src/lib/sources/paragraphs.js");
const { embedBatch } = await import("../src/lib/gemini.js");
const { insertChunks } = await import("../src/lib/chunks.js");
const { stripNul } = await import("../src/lib/utils.js");

// ─── Fetch & extract ──────────────────────────────────────────────────────────

const res = await fetch(url, { headers: { "User-Agent": "Libris (personal knowledge base)" } });
if (!res.ok) {
  console.error(`❌  HTTP ${res.status} fetching ${url}`);
  process.exit(1);
}
const dom = new JSDOM(await res.text());
const doc = dom.window.document;

// Navigation, scripts and styles carry no knowledge
for (const el of doc.querySelectorAll("nav, script, style, footer")) el.remove();

const pageTitle = doc.querySelector("title")?.textContent?.trim() ?? null;
const title = arg("--title") ?? pageTitle ?? url;
const author = arg("--author") ?? null;

const squash = (t: string | null) => (t ?? "").replace(/\s+/g, " ").trim();
// Leaf block elements only, so nested containers don't duplicate text
const BLOCKS = "p, li, blockquote, pre, h3, h4, figcaption, dt, dd";
const blockParagraphs = (root: Element): string[] =>
  Array.from(root.querySelectorAll(BLOCKS))
    .filter((el) => !el.querySelector(BLOCKS))
    .map((el) => squash(el.textContent))
    .filter((t) => t.length > 1);

const paragraphs: Paragraph[] = [];

// Intro: anything in <header> or before the first section
const header = doc.querySelector("header");
if (header) {
  for (const text of blockParagraphs(header)) paragraphs.push({ text, chapterTitle: null, pageNumber: null });
}

const sections = Array.from(doc.querySelectorAll("section, article"))
  .filter((el) => !el.parentElement?.closest("section, article")); // top-level only
if (sections.length === 0) sections.push(doc.body);

for (const section of sections) {
  const chapterTitle = squash(section.querySelector("h1, h2")?.textContent ?? null) || null;
  for (const text of blockParagraphs(section)) {
    if (text === chapterTitle) continue;
    paragraphs.push({ text, chapterTitle, pageNumber: null });
  }
}

const chunks = chunkParagraphs(paragraphs).map((c) => ({ ...c, content: stripNul(c.content) }));
const chapters = [...new Set(chunks.map((c) => c.chapterTitle).filter(Boolean))] as string[];

console.log(`"${title}"${author ? ` — ${author}` : ""}`);
console.log(`${paragraphs.length} paragraphs → ${chunks.length} chunks · ${chapters.length} chapters:`);
for (const ch of chapters) console.log(`  · ${ch}`);

if (chunks.length === 0) {
  console.error("❌  No extractable text");
  process.exit(1);
}
if (!apply) {
  console.log("\nDry run — add --apply to import.");
  process.exit(0);
}

// ─── Import ───────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: profile } = await supabase.from("user_profiles").select("user_id").eq("digest_enabled", true).limit(1).single();
if (!profile) {
  console.error("❌  No user profile found");
  process.exit(1);
}
const userId = profile.user_id as string;

const { data: existing } = await supabase
  .from("sources").select("id, ingest_status").eq("user_id", userId).eq("url", url);
const existingComplete = (existing ?? []).filter((s) => s.ingest_status === "complete");
if (existingComplete.length > 0 && !force) {
  console.error(`❌  Already in the library (${existingComplete.length} source) — use --force to replace`);
  process.exit(1);
}

const { data: source, error: sourceErr } = await supabase
  .from("sources")
  .insert({
    user_id: userId,
    source_type: "web_article",
    title: stripNul(title),
    author,
    url,
    ingest_status: "processing",
    authority_tier: 3,
  })
  .select("id")
  .single();
if (sourceErr || !source) {
  console.error(`❌  ${sourceErr?.message ?? "Failed to create source"}`);
  process.exit(1);
}

try {
  const embeddings: (number[] | null)[] = [];
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    embeddings.push(...(await embedBatch(batch.map((c) => c.content)).catch(() => batch.map(() => null))));
  }
  await insertChunks(
    supabase,
    chunks.map((chunk, i) => ({
      source_id: source.id as string,
      user_id: userId,
      chunk_index: i,
      content: chunk.content,
      chapter_title: chunk.chapterTitle ?? null,
      page_number: null,
      chunk_type: "passage",
      embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
      indexed_at: new Date().toISOString(),
      token_count: Math.ceil(chunk.content.length / 4),
    })),
  );
  await supabase
    .from("sources")
    .update({ ingest_status: "complete", total_chunks: chunks.length, last_ingested: new Date().toISOString() })
    .eq("id", source.id);

  // New import is live: now retire the old source(s) for this URL
  for (const old of existing ?? []) {
    await supabase.from("chunks").delete().eq("source_id", old.id);
    await supabase.from("sources").delete().eq("id", old.id);
  }

  const missing = embeddings.filter((e) => !e).length;
  console.log(`\n✓ imported: ${chunks.length} chunks${missing ? ` (${missing} without embedding — run backfill-embeddings)` : ""}${existing?.length ? ` · ${existing.length} old source(s) replaced` : ""}`);
} catch (err) {
  await supabase.from("sources").update({ ingest_status: "failed", ingest_error: String(err) }).eq("id", source.id);
  console.error(`❌  ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
