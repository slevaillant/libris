#!/usr/bin/env tsx
/**
 * Fetch YouTube transcripts locally and push timestamped chunks to Supabase.
 *
 * YouTube blocks API calls from Cloudflare datacenter IPs. This script runs on
 * your local machine (residential IP) where transcripts are freely accessible.
 *
 * Usage:
 *   npx tsx sync/fetch-youtube-transcripts.ts
 *
 * It finds all YouTube sources in the library that have no transcript chunks
 * (i.e. only key_idea chunks or a single description passage), fetches the
 * transcript from YouTube, re-chunks with [MM:SS] timestamps, and upserts.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

// Load .env.local
const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── YouTube fetch helpers ────────────────────────────────────────────────────

const ANDROID_CLIENT_VERSION = "20.10.38";
const ANDROID_UA = `com.google.android.youtube/${ANDROID_CLIENT_VERSION} (Linux; U; Android 14)`;

function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Segment = { startSeconds: number; text: string };
type Chunk = { text: string; startSeconds: number };

function parseXml(xml: string): Segment[] {
  const segs: Segment[] = [];
  // format 3: <p t="ms">
  for (const m of xml.matchAll(/<p t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = decodeHtml(m[2].replace(/<s[^>]*>/g, "").replace(/<\/s>/g, "").replace(/\s+/g, " ").trim());
    if (text) segs.push({ startSeconds: parseInt(m[1]) / 1000, text });
  }
  // fallback: <text start="s">
  if (segs.length === 0) {
    for (const m of xml.matchAll(/<text[^>]+start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
      const text = decodeHtml(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (text) segs.push({ startSeconds: parseFloat(m[1]), text });
    }
  }
  return segs;
}

function chunkSegments(segs: Segment[], wordsPerChunk = 300): Chunk[] {
  if (segs.length === 0) return [];
  const chunks: Chunk[] = [];
  let words: string[] = [];
  let start = segs[0].startSeconds;
  for (const seg of segs) {
    if (words.length === 0) start = seg.startSeconds;
    words.push(...seg.text.split(/\s+/).filter(Boolean));
    if (words.length >= wordsPerChunk) {
      chunks.push({ text: `[${formatTimestamp(start)}] ${words.join(" ")}`, startSeconds: start });
      words = [];
    }
  }
  if (words.length > 15) chunks.push({ text: `[${formatTimestamp(start)}] ${words.join(" ")}`, startSeconds: start });
  return chunks;
}

async function fetchTranscript(videoId: string): Promise<Segment[] | null> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ANDROID_UA },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: ANDROID_CLIENT_VERSION } },
      videoId,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[] } } };
  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = tracks.find(t => t.languageCode === "en" && t.kind !== "asr") ?? tracks.find(t => t.languageCode === "en") ?? tracks[0];
  if (!track?.baseUrl) return null;

  const xmlRes = await fetch(track.baseUrl);
  if (!xmlRes.ok) return null;
  const xml = await xmlRes.text();
  return parseXml(xml);
}

// ─── Embedding helper (calls Gemini) ─────────────────────────────────────────

async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return texts.map(() => null);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests: texts.map(text => ({ model: "models/gemini-embedding-001", content: { parts: [{ text }] } })) }),
      }
    );
    const data = await res.json() as { embeddings?: { values?: number[] }[] };
    return (data.embeddings ?? []).map(e => e.values ?? null);
  } catch {
    return texts.map(() => null);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Find YouTube sources that need transcript chunks
  const { data: sources } = await supabase
    .from("sources")
    .select("id, title, url, total_chunks")
    .eq("source_type", "web_article")
    .like("url", "%youtube.com/watch%")
    .order("created_at", { ascending: false });

  if (!sources?.length) { console.log("No YouTube sources found."); return; }

  for (const source of sources) {
    // Check if this source already has timestamped chunks
    const { data: chunks } = await supabase
      .from("chunks")
      .select("chapter_title")
      .eq("source_id", source.id)
      .eq("chunk_type", "passage");

    const hasTimestamps = (chunks ?? []).some(c => /^\d+:\d+$/.test(c.chapter_title ?? ""));
    if (hasTimestamps) {
      console.log(`✓ ${source.title.slice(0, 60)} — already has timestamps`);
      continue;
    }

    const videoId = source.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) continue;

    console.log(`\nFetching transcript: ${source.title.slice(0, 60)}`);
    const segs = await fetchTranscript(videoId);
    if (!segs || segs.length === 0) {
      console.log("  ✗ No transcript available");
      continue;
    }
    console.log(`  ${segs.length} segments`);

    const timed = chunkSegments(segs);
    if (timed.length === 0) { console.log("  ✗ No chunks generated"); continue; }

    // Delete existing passage chunks (keep key_idea chunks)
    await supabase.from("chunks").delete().eq("source_id", source.id).eq("chunk_type", "passage");

    // Find the highest key_idea chunk index
    const { data: keyIdeas } = await supabase
      .from("chunks")
      .select("chunk_index")
      .eq("source_id", source.id)
      .eq("chunk_type", "key_idea")
      .order("chunk_index", { ascending: false })
      .limit(1);
    const offset = (keyIdeas?.[0]?.chunk_index ?? -1) + 1;

    // Embed and insert
    const texts = timed.map(c => c.text);
    const embeddings = await embedTexts(texts);
    console.log(`  Embedding ${timed.length} chunks…`);

    const rows = timed.map((c, i) => ({
      source_id: source.id,
      // Get user_id from existing chunks
      chunk_index: offset + i,
      content: c.text,
      chapter_title: formatTimestamp(c.startSeconds),
      chunk_type: "passage",
      embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
      indexed_at: new Date().toISOString(),
      token_count: Math.ceil(c.text.length / 4),
    }));

    // Get user_id from existing chunks
    const { data: existing } = await supabase.from("chunks").select("user_id").eq("source_id", source.id).limit(1).single();
    if (!existing?.user_id) { console.log("  ✗ Could not find user_id"); continue; }
    const withUser = rows.map(r => ({ ...r, user_id: existing.user_id }));

    const { error } = await supabase.from("chunks").insert(withUser);
    if (error) { console.log("  ✗ Insert error:", error.message); continue; }

    await supabase.from("sources")
      .update({ total_chunks: offset + timed.length, last_ingested: new Date().toISOString() })
      .eq("id", source.id);

    console.log(`  ✓ Inserted ${timed.length} timestamped chunks`);
  }

  console.log("\nDone.");
}

main().catch(console.error);
