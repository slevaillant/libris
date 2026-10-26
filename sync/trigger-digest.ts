#!/usr/bin/env tsx
/**
 * Trigger the weekly Friday digest now (same logic as the Cloudflare cron handler).
 * Usage: npx tsx sync/trigger-digest.ts [--force] [--preview out.html]
 *   --force    re-send even if today's digest was already emailed
 *   --preview  write the email to a local HTML file instead of sending it (no DB writes)
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

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌  Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const { runWeeklyDigest } = await import("../src/lib/weekly-digest.js");

const previewIdx = process.argv.indexOf("--preview");
const previewPath = previewIdx >= 0 ? process.argv[previewIdx + 1] : undefined;

await runWeeklyDigest(
  createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }),
  new Anthropic({ apiKey: ANTHROPIC_API_KEY }),
  {
    appUrl: process.env.APP_URL ?? "https://libris.seblevaillant.com",
    force: process.argv.includes("--force"),
    preview: previewPath
      ? ({ subject, html, text }) => {
          fs.writeFileSync(previewPath, html);
          fs.writeFileSync(previewPath.replace(/\.html?$/, "") + ".txt", text);
          console.log(`✓  Preview written: ${previewPath} — "${subject}" (${text.split(/\s+/).length} words)`);
        }
      : undefined,
  },
);
