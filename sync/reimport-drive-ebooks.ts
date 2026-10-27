#!/usr/bin/env tsx
/**
 * Re-import ebooks from a local Google Drive folder (Google Drive for desktop) with the
 * paragraph/chapter/page-preserving extractors, and link each book to its Drive file.
 *
 * Each file is matched to an existing Libris book by content (snippets of the file found
 * in its passages), then by title. Matched books get fresh passages (highlights and
 * summaries kept), a Google Drive link, and a readable title if theirs was a filename.
 * Dry run by default.
 *
 * Usage: npx tsx sync/reimport-drive-ebooks.ts [--dir PATH] [--apply] [--import-new] [--only "substring"] [--force]
 *   --apply       replace passages of matched books
 *   --import-new  also import files that match no book (as new ebooks)
 *   --force       redo books already linked to their Drive file
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_KEY and GEMINI_API_KEY from .env.local (or env).
 * Never prints book content.
 */

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
const importNew = process.argv.includes("--import-new");
const force = process.argv.includes("--force");
const only = arg("--only")?.toLowerCase();
const dir =
  arg("--dir") ??
  path.join(os.homedir(), "Library/CloudStorage/GoogleDrive-sebastien.levaillant@gmail.com/My Drive/A garder/Pro/ebooks");

// Browser APIs the extractors rely on
const { JSDOM } = await import("jsdom");
(globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM().window.DOMParser;
const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
const { extractPdfData } = await import("../src/lib/sources/pdf.js");
const { extractEpub } = await import("../src/lib/sources/epub.js");
const { ingestDigitalBook, replaceBookPassages } = await import("../src/lib/book-ingestion.js");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: profile } = await supabase.from("user_profiles").select("user_id").eq("digest_enabled", true).limit(1).single();
if (!profile) {
  console.error("❌  No user profile found");
  process.exit(1);
}
const userId = profile.user_id as string;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const files: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(pdf|epub)$/i.test(e.name)) files.push(p);
  }
};
walk(dir);
files.sort();

function driveUrl(file: string): string | null {
  try {
    const id = execFileSync("xattr", ["-p", "com.google.drivefs.item-id#S", file]).toString().trim();
    return /^[\w-]{10,}$/.test(id) ? `https://drive.google.com/file/d/${id}/view` : null;
  } catch {
    return null;
  }
}

const fileTitle = (file: string) =>
  path.basename(file).replace(/\.(pdf|epub)$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

// Titles taken from file metadata that are really filenames or tool artefacts
const JUNK_TITLE = /^(microsoft word\s*-|untitled$)|\.(pdf|epub|docx?|indd|key|qxd)$|^[\d\s_.-]+$|_v\d|^[^\s]{3,}-ebook$/i;
const isJunkTitle = (t: string) => JUNK_TITLE.test(t.trim()) || /<\/?\w+>/.test(t) || t.trim().length < 3;

const norm = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)|\[.*?\]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["the", "and", "for", "with", "your", "how", "edition", "des", "les", "pour"]);
const tokens = (t: string) => new Set(norm(t).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));

type Book = { id: string; title: string; file_url: string | null };
const { data: sources, error: sourcesError } = await supabase
  .from("sources")
  .select("id, title, file_url")
  .eq("user_id", userId)
  .eq("source_type", "ebook")
  .eq("ingest_status", "complete");
if (sourcesError) {
  console.error(`❌  ${sourcesError.message} — apply supabase/migrations/20261026000001_sources_file_url.sql first`);
  process.exit(1);
}
const books = (sources ?? []) as Book[];
const byId = new Map(books.map((b) => [b.id, b]));

/** Snippets of the old-style flat text, looked up verbatim in existing passages. */
async function matchByContent(matchText: string): Promise<string | null> {
  const votes = new Map<string, number>();
  for (const at of [0.25, 0.5, 0.75]) {
    let i = Math.floor(matchText.length * at);
    i = matchText.indexOf(" ", i) + 1;
    const probe = matchText.slice(i, i + 60).trim();
    if (probe.length < 40) continue;
    const pattern = `%${probe.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const { data } = await supabase
      .from("chunks")
      .select("source_id")
      .eq("user_id", userId)
      .eq("chunk_type", "passage")
      .ilike("content", pattern)
      .limit(3);
    for (const r of data ?? []) votes.set(r.source_id as string, (votes.get(r.source_id as string) ?? 0) + 1);
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 && byId.has(best[0]) ? best[0] : null;
}

function matchByTitle(candidates: string[]): string | null {
  let best = { id: "", score: 0 };
  for (const b of books) {
    const bt = tokens(b.title.split(":")[0]);
    // One-word titles ("Scale") match too many filenames: require an exact title then
    if (bt.size < 2) {
      if (candidates.some((c) => norm(c) === norm(b.title.split(":")[0]))) return b.id;
      continue;
    }
    for (const c of candidates) {
      const ct = tokens(c);
      const score = [...bt].filter((w) => ct.has(w)).length / bt.size;
      if (score > best.score) best = { id: b.id, score };
    }
  }
  return best.score >= 0.75 ? best.id : null;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const assigned = new Map<string, string>(); // source id → file
const counts = { matched: 0, replaced: 0, skipped: 0, unmatched: 0, imported: 0, failed: 0 };

for (const file of files) {
  const name = path.relative(dir, file);
  if (only && !name.toLowerCase().includes(only)) continue;

  let extracted: { title: string | null; author: string | null; chunks: { content: string; chapterTitle: string | null; pageNumber: number | null }[]; matchText: string };
  try {
    extracted = /\.epub$/i.test(file)
      ? await extractEpub(new File([fs.readFileSync(file)], path.basename(file)))
      : await extractPdfData(new Uint8Array(fs.readFileSync(file)), pdfjs);
  } catch (err) {
    counts.failed++;
    console.log(`✗ ${name} — could not read (${err instanceof Error ? err.message : err})`);
    continue;
  }
  if (extracted.chunks.length === 0) {
    counts.failed++;
    console.log(`✗ ${name} — no extractable text (scanned?)`);
    continue;
  }

  const fileUrl = driveUrl(file) ?? undefined;
  const contentMatch = await matchByContent(extracted.matchText);
  const sourceId = contentMatch ?? matchByTitle([fileTitle(file), extracted.title ?? ""]);
  const pages = extracted.chunks.filter((c) => c.pageNumber).length;
  const chapters = extracted.chunks.filter((c) => c.chapterTitle).length;
  const stats = `${extracted.chunks.length} passages · ${chapters} with chapter · ${pages} with page`;

  if (!sourceId) {
    counts.unmatched++;
    const title = extracted.title && !isJunkTitle(extracted.title) ? extracted.title : fileTitle(file);
    console.log(`? ${name} — no matching book (${stats})${importNew ? "" : " · use --import-new"}`);
    if (apply && importNew) {
      await ingestDigitalBook(supabase, userId, { title, author: extracted.author ?? undefined, fileUrl, chunks: extracted.chunks });
      counts.imported++;
      console.log(`  ✓ imported as "${title}"`);
    }
    continue;
  }

  const book = byId.get(sourceId)!;
  if (assigned.has(sourceId)) {
    counts.skipped++;
    console.log(`= ${name} — same book as ${path.relative(dir, assigned.get(sourceId)!)}, skipped`);
    continue;
  }
  assigned.set(sourceId, file);
  counts.matched++;

  if (book.file_url && !force) {
    counts.skipped++;
    console.log(`✓ ${name} → "${book.title}" — already linked, skipped (--force to redo)`);
    continue;
  }

  const newTitle = isJunkTitle(book.title) ? (extracted.title && !isJunkTitle(extracted.title) ? extracted.title : fileTitle(file)) : undefined;
  console.log(`→ ${name} → "${book.title}"${newTitle ? ` (rename to "${newTitle}")` : ""} [${contentMatch ? "content" : "title"}] · ${stats}${fileUrl ? "" : " · no Drive id"}`);
  if (apply) {
    try {
      const r = await replaceBookPassages(supabase, userId, sourceId, extracted.chunks, { fileUrl, title: newTitle });
      counts.replaced++;
      console.log(`  ✓ ${r.passages} passages${r.missingEmbeddings ? ` (${r.missingEmbeddings} without embedding — run backfill-embeddings)` : ""}`);
    } catch (err) {
      counts.failed++;
      console.log(`  ✗ ${err instanceof Error ? err.message : err}`);
    }
  }
}

const untouched = books.filter((b) => !assigned.has(b.id)).length;
console.log(
  `\n${files.length} files · ${counts.matched} matched (${counts.replaced} re-imported, ${counts.skipped} skipped) · ${counts.unmatched} unmatched${counts.imported ? ` (${counts.imported} imported)` : ""} · ${counts.failed} unreadable · ${untouched} Libris ebooks without a file here${apply ? "" : " · dry run (add --apply)"}`,
);
