#!/usr/bin/env tsx
/**
 * Import a local PDF into Libris (same extraction + ingestion as the Import page).
 * Usage: npx tsx sync/import-pdf.ts /path/to/book.pdf [--title "..."] [--author "..."]
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_KEY and GEMINI_API_KEY from .env.local (or env).
 * Single-user app: imports into the only user profile with the digest enabled.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌  Missing SUPABASE_URL or SUPABASE_SERVICE_KEY (set in .env.local)");
  process.exit(1);
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("Usage: npx tsx sync/import-pdf.ts /path/to/book.pdf [--title ...] [--author ...]");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: profile, error: profileErr } = await supabase
  .from("user_profiles")
  .select("user_id")
  .eq("digest_enabled", true)
  .limit(1)
  .single();
if (profileErr || !profile) {
  console.error("❌  No user profile found:", profileErr?.message);
  process.exit(1);
}

const { extractPdfData } = await import("../src/lib/sources/pdf.js");
const { ingestDigitalBook } = await import("../src/lib/book-ingestion.js");

const pdfjsNode = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
const result = await extractPdfData(new Uint8Array(fs.readFileSync(file)), pdfjsNode);
if (result.isScanned || result.chunks.length === 0) {
  console.error("❌  No extractable text (scanned PDF?)");
  process.exit(1);
}

const title = arg("--title") ?? result.title ?? path.basename(file).replace(/\.pdf$/i, "");
const author = arg("--author") ?? result.author ?? undefined;
console.log(`▶  "${title}"${author ? ` — ${author}` : ""}: ${result.chunks.length} chunks`);

const { sourceId } = await ingestDigitalBook(supabase, profile.user_id as string, {
  title,
  author,
  chunks: result.chunks.map((c) => ({ content: c.content, pageNumber: c.pageNumber })),
});

const { count: missing } = await supabase
  .from("chunks")
  .select("id", { count: "exact", head: true })
  .eq("source_id", sourceId)
  .is("embedding", null);
console.log(`✓  Imported (source ${sourceId}), ${missing ?? 0} chunk(s) without embedding`);
