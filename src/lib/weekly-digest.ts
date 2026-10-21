// Weekly "Friday deep-dive" digest: matches the week's critical topics (TOPICS.md,
// synced to user_profiles.topics_md) against the user's library and sends one email.
// Shared by the Cloudflare cron handler (src/server.ts) and sync/trigger-digest.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { parseTopicEntriesFromMd } from "./digest.functions";
import { buildDigestEmail, sendEmail, type DigestSection } from "./email";
import { embed } from "./gemini";
import type { DiscoveredResource } from "./discovery";

const DIGEST_TZ = "Europe/Paris";
const DIGEST_WEEKDAY = "Fri";
const DIGEST_HOUR = 12;
const STALE_TOPICS_DAYS = 6;

// ─── Scheduling ───────────────────────────────────────────────────────────────

/**
 * Cloudflare crons are UTC, so the digest is scheduled at both 10:00 and 11:00 UTC on
 * Fridays and only the run that lands on 12:00 Paris time proceeds (CEST vs CET).
 */
export function isWeeklyDigestSlot(now: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: DIGEST_TZ, weekday: "short" }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: DIGEST_TZ, hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  return weekday === DIGEST_WEEKDAY && hour === DIGEST_HOUR;
}

/** ISO-8601 week number of the given date in the digest timezone. */
export function isoWeek(now: Date): number {
  const [y, m, d] = now.toLocaleDateString("en-CA", { timeZone: DIGEST_TZ }).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

type MatchedChunk = {
  chunk_id: string;
  source_id: string;
  title: string;
  author: string | null;
  chapter_title: string | null;
  content: string;
  similarity: number;
  url: string | null;
};

type DigestProfile = {
  user_id: string;
  display_name: string | null;
  librarian_name: string | null;
  digest_email: string;
  topics_md: string;
  topics_updated_at: string | null;
};

export type WeeklyDigestOptions = {
  appUrl: string;
  now?: Date;
  /** Send even if this week's digest was already emailed (manual re-runs). */
  force?: boolean;
  log?: (msg: string) => void;
};

export async function runWeeklyDigest(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  { appUrl, now = new Date(), force = false, log = console.log }: WeeklyDigestOptions,
): Promise<void> {
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, librarian_name, digest_email, topics_md, topics_updated_at")
    .eq("digest_enabled", true)
    .not("topics_md", "is", null)
    .not("digest_email", "is", null);

  if (!profiles?.length) {
    log("Weekly digest: no eligible profiles (digest_enabled, topics_md and digest_email required)");
    return;
  }

  for (const p of profiles as DigestProfile[]) {
    try {
      await runForProfile(supabase, anthropic, p, { appUrl, now, force, log });
    } catch (err) {
      console.error(`Weekly digest failed for user ${p.user_id}:`, err);
    }
  }
}

async function runForProfile(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  p: DigestProfile,
  { appUrl, now, force, log }: Required<WeeklyDigestOptions>,
): Promise<void> {
  const topics = parseTopicEntriesFromMd(p.topics_md);
  if (topics.length === 0) {
    log(`Weekly digest: no active topics for user ${p.user_id}`);
    return;
  }

  const runDate = now.toLocaleDateString("en-CA", { timeZone: DIGEST_TZ });

  // Idempotence: one email per run date, even if the cron fires twice
  const { data: existing } = await supabase
    .from("digest_runs")
    .select("id, email_sent")
    .eq("user_id", p.user_id)
    .eq("run_date", runDate)
    .maybeSingle();
  if (existing?.email_sent && !force) {
    log(`Weekly digest: already sent for user ${p.user_id} on ${runDate}`);
    return;
  }

  const displayName = p.display_name ?? "there";
  const librarianName = p.librarian_name ?? "Lumen";

  const { data: run } = await supabase
    .from("digest_runs")
    .upsert(
      { user_id: p.user_id, run_date: runDate, meetings_found: 1, themes_found: topics.length },
      { onConflict: "user_id,run_date" },
    )
    .select("id")
    .single();
  const digestRunId = (run?.id as string) ?? crypto.randomUUID();
  if (run?.id) await supabase.from("digest_themes").delete().eq("digest_run_id", digestRunId);

  const sections: DigestSection[] = [];
  let citationCount = 0;

  for (const [i, topic] of topics.entries()) {
    log(`  [${i + 1}/${topics.length}] ${topic.title}`);

    const embedding = await embed(topic.query).catch(() => null);
    if (!embedding) continue;

    const { data: chunks } = await supabase.rpc("match_chunks", {
      p_user_id: p.user_id,
      p_query_embedding: `[${embedding.join(",")}]`,
      p_match_count: 5,
      p_min_score: 0.5,
    });
    const matched = (chunks ?? []) as MatchedChunk[];

    // Discovery: find and ingest external resources when coverage is thin
    let discovered: DiscoveredResource[] = [];
    if (matched.length < 2) {
      const { discoverAndIngest } = await import("./discovery");
      discovered = await discoverAndIngest(supabase, anthropic, p.user_id, topic.query);
    }
    if (matched.length === 0 && !discovered.some((r) => r.ingested)) continue;

    let synthesis = `My sources on "${topic.title}" are thinner than I'd like.`;
    if (matched.length > 0) {
      const passages = matched
        .map((c, j) => `[${j + 1}] ${c.title}${c.author ? ` — ${c.author}` : ""}\n${c.content.slice(0, 400)}`)
        .join("\n\n");
      const res = await anthropic.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: `You are ${librarianName}, writing ${displayName}'s weekly Friday deep-dive. They set Friday afternoon aside to dig into the critical work challenges of their week. Write one focused paragraph connecting this week's challenge to the library passages. End with what to read first this afternoon, and why.`,
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: `Challenge: "${topic.title}"\n\nQuestion: "${topic.query}"\n\nPassages:\n${passages}` },
          ],
        }],
      });
      const tb = res.content.find((b) => b.type === "text");
      if (tb?.type === "text") synthesis = tb.text;
    }

    const seen = new Set<string>();
    const citations = matched
      .filter((c) => { const k = c.url ?? c.source_id; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 3)
      .map((c) => ({ title: c.title, author: c.author, chapterTitle: null, url: c.url ?? null }));
    citationCount += citations.length;
    sections.push({
      theme: topic.title,
      synthesis,
      citations,
      readingSuggestion: null,
      discoveredResources: discovered.length > 0 ? discovered : undefined,
    });

    await supabase.from("digest_themes").insert({
      digest_run_id: digestRunId,
      user_id: p.user_id,
      theme_text: topic.title,
      theme_type: "topic",
      synthesis,
    });
  }

  await supabase.from("digest_runs").update({ citations_found: citationCount }).eq("id", digestRunId);
  if (sections.length === 0) {
    log(`Weekly digest: no sections generated for user ${p.user_id}`);
    return;
  }

  // Flag a broken TOPICS.md sync instead of silently re-sending last week's topics
  const updatedAt = p.topics_updated_at ? new Date(p.topics_updated_at) : null;
  const staleDays = updatedAt ? Math.floor((now.getTime() - updatedAt.getTime()) / 86_400_000) : null;
  const notice = staleDays === null || staleDays >= STALE_TOPICS_DAYS
    ? `Heads-up: your topics haven't been synced for ${staleDays === null ? "a while" : `${staleDays} days`} — check the TOPICS.md routine and sync.`
    : undefined;

  const dayLabel = now.toLocaleDateString("en-GB", { timeZone: DIGEST_TZ, weekday: "long", day: "numeric", month: "long" });
  const dateLabel = `Week ${isoWeek(now)} · ${dayLabel}`;
  const { subject, html, text } = buildDigestEmail(
    displayName, librarianName, dateLabel, sections, `${appUrl}/quiz/${digestRunId}`, { notice },
  );
  const result = await sendEmail({ to: p.digest_email, subject, html, text });

  await supabase
    .from("digest_runs")
    .update({ email_sent: result.sent, email_sent_at: result.sent ? new Date().toISOString() : null })
    .eq("id", digestRunId);
  log(`Weekly digest: user=${p.user_id} topics=${topics.length} sections=${sections.length} sent=${result.sent}`);
  if (!result.sent && result.error) console.error(`Weekly digest email failed: ${result.error}`);
}
