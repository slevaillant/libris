#!/usr/bin/env tsx
/**
 * Replace AI-reconstructed chapter lists with real tables of contents (Open Library → web).
 * Targets books whose content is only AI chapter summaries and whose TOC origin is unknown
 * or "ai_memory". Dry run by default.
 *
 * Usage: npx tsx sync/fix-tocs.ts [--apply] [--limit N] [--title "substring"]
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY (+ ANTHROPIC_API_KEY with --apply)
 * from .env.local (or env).
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY } = process.env;
const apply = process.argv.includes("--apply");
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) {
  console.error("❌  Missing SUPABASE_URL, SUPABASE_SERVICE_KEY or GEMINI_API_KEY (set in .env.local)");
  process.exit(1);
}
if (apply && !ANTHROPIC_API_KEY) {
  console.error("❌  --apply needs ANTHROPIC_API_KEY (chapter summaries are regenerated with Haiku)");
  process.exit(1);
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const limit = Number(arg("--limit") ?? Infinity);
const titleFilter = arg("--title")?.toLowerCase();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { findTableOfContents } = await import("../src/lib/toc.js");
const { replaceBookChapters } = await import("../src/lib/book-ingestion.js");
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const { data: books, error } = await supabase
  .from("sources")
  .select("id, user_id, title, author, isbn, toc_source")
  .in("source_type", ["ebook", "physical_book"])
  .eq("ingest_status", "complete")
  .or("toc_source.is.null,toc_source.eq.ai_memory")
  .order("title");
if (error) {
  console.error(`❌  ${error.message}`);
  process.exit(1);
}

let checked = 0;
let found = 0;
let replaced = 0;

for (const book of books ?? []) {
  if (checked >= limit) break;
  if (titleFilter && !(book.title as string).toLowerCase().includes(titleFilter)) continue;

  // Only books whose content is AI chapter summaries (full-text books have real passages)
  const { data: chunks } = await supabase.from("chunks").select("chunk_type, chapter_title").eq("source_id", book.id);
  if (!chunks?.length || chunks.some((c) => c.chunk_type === "passage")) continue;
  checked++;

  const current = chunks.filter((c) => c.chunk_type === "chapter_summary").map((c) => c.chapter_title as string);
  const toc = await findTableOfContents(
    { title: book.title as string, author: book.author as string | null, isbn: book.isbn as string | null },
    { anthropic, geminiApiKey: GEMINI_API_KEY, allowMemory: false },
  );

  console.log(`\n${book.title}${book.author ? ` — ${book.author}` : ""}`);
  if (!toc) {
    console.log(`  ✗ no published TOC found — keep ${current.length} AI chapters (upload a screenshot from the book page)`);
    continue;
  }
  found++;
  console.log(`  current (${current.length}): ${current.slice(0, 4).join(" | ")}${current.length > 4 ? " | …" : ""}`);
  console.log(`  ${toc.source} (${toc.chapters.length}): ${toc.chapters.slice(0, 4).join(" | ")}${toc.chapters.length > 4 ? " | …" : ""}`);

  if (apply) {
    const { chapters } = await replaceBookChapters(supabase, book.user_id as string, book.id as string, toc);
    replaced++;
    console.log(`  ✓ replaced with ${chapters} chapters`);
  }
}

console.log(`\n${checked} AI-summary book(s) checked · real TOC found for ${found}${apply ? ` · ${replaced} replaced` : " · dry run (add --apply to replace)"}`);
