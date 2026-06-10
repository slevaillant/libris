#!/usr/bin/env tsx
/**
 * Sync local TOPICS.md to Libris.
 * Usage: npx tsx sync/push-topics.ts [/path/to/TOPICS.md]
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from .env.local (or env).
 * Finds the single user profile in the database and updates topics_md.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Load .env.local
const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌  Missing SUPABASE_URL or SUPABASE_SERVICE_KEY (set in .env.local)");
  process.exit(1);
}

const DEFAULT_PATH =
  process.env.TOPICS_FILE_PATH ??
  path.join(os.homedir(), "Documents/chief-of-staff/seb-obsidian/TOPICS.md");
const topicsPath = process.argv[2] ?? DEFAULT_PATH;

if (!fs.existsSync(topicsPath)) {
  console.error(`❌  File not found: ${topicsPath}`);
  process.exit(1);
}

const content = fs.readFileSync(topicsPath, "utf-8");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Single-user app — grab the only profile
const { data: profile, error: profileErr } = await supabase
  .from("user_profiles")
  .select("user_id, display_name")
  .limit(1)
  .single();

if (profileErr || !profile) {
  console.error("❌  No user profile found:", profileErr?.message);
  process.exit(1);
}

const { error } = await supabase
  .from("user_profiles")
  .update({ topics_md: content, topics_updated_at: new Date().toISOString() })
  .eq("user_id", profile.user_id);

if (error) {
  console.error("❌  Update failed:", error.message);
  process.exit(1);
}

const activeCount = (content.match(/^- \[ \]/gm) ?? []).length;
console.log(`✓  Synced ${activeCount} active topic${activeCount !== 1 ? "s" : ""} for ${profile.display_name ?? profile.user_id}`);
console.log(`   Source: ${topicsPath}`);
