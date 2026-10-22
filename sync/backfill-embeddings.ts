#!/usr/bin/env tsx
/**
 * Embed every chunk that has no embedding yet (they are invisible to match_chunks).
 * Resumable: re-run it any time, it only picks chunks where embedding is null.
 *
 * Usage: npx tsx sync/backfill-embeddings.ts [--dry-run] [--limit N] [--delay-ms N]
 *   --dry-run   only count what is missing
 *   --limit     stop after N chunks (default: all)
 *   --delay-ms  pause between batches of 100 (default: 1000) — raise it on a free Gemini tier
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_KEY and GEMINI_API_KEY from .env.local (or env).
 * Never prints chunk content.
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

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌  Missing SUPABASE_URL or SUPABASE_SERVICE_KEY (set in .env.local)");
  process.exit(1);
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes("--dry-run");
const limit = Number(arg("--limit") ?? Infinity);
const delayMs = Number(arg("--delay-ms") ?? 1000);
const BATCH = 100;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const countMissing = async () => {
  const { count, error } = await supabase
    .from("chunks")
    .select("id", { count: "exact", head: true })
    .is("embedding", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
};

const missingBefore = await countMissing();
console.log(`Chunks without embedding: ${missingBefore}`);
if (dryRun || missingBefore === 0) process.exit(0);
if (!GEMINI_API_KEY) {
  console.error("❌  Missing GEMINI_API_KEY (set in .env.local)");
  process.exit(1);
}

const { embedBatch } = await import("../src/lib/gemini.js");

let cursor = "00000000-0000-0000-0000-000000000000";
let embedded = 0;
let failed = 0;
let quotaExhausted = false;
const started = Date.now();

while (embedded + failed < limit && !quotaExhausted) {
  const { data: rows, error } = await supabase
    .from("chunks")
    .select("id, content")
    .is("embedding", null)
    .gt("id", cursor)
    .order("id")
    .limit(Math.min(BATCH, limit - embedded - failed));
  if (error) { console.error(`❌  ${error.message}`); break; }
  if (!rows?.length) break;
  cursor = rows[rows.length - 1].id as string;

  const vectors = await embedBatch(rows.map((r) => (r.content as string) ?? ""), {
    onBatchError: (status, body) => {
      // Daily quota: retrying later today won't help — stop and resume tomorrow
      if (status === 429 && /per ?day|daily/i.test(body)) quotaExhausted = true;
    },
  });

  // Write back with limited concurrency
  const updates = rows.map((r, i) => ({ id: r.id as string, v: vectors[i] }));
  for (let i = 0; i < updates.length; i += 10) {
    await Promise.all(
      updates.slice(i, i + 10).map(async ({ id, v }) => {
        if (!v) { failed++; return; }
        const { error: upErr } = await supabase.from("chunks").update({ embedding: JSON.stringify(v) }).eq("id", id);
        if (upErr) failed++; else embedded++;
      }),
    );
  }

  const rate = embedded / ((Date.now() - started) / 60_000);
  process.stdout.write(`\r  embedded ${embedded} · failed ${failed} · ${rate.toFixed(0)}/min   `);
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
}

const missingAfter = await countMissing();
console.log(`\n✓  Embedded ${embedded} chunk(s), ${failed} failed. Still missing: ${missingAfter}.`);
if (quotaExhausted) console.log("⏸  Gemini daily quota reached — re-run tomorrow to continue.");
else if (failed > 0) console.log("   Re-run to retry the failed chunks (see [gemini] errors above).");
