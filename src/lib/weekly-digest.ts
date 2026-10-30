// Weekly "Friday deep-dive" digest: matches the week's critical topics (TOPICS.md,
// synced to user_profiles.topics_md) against the user's library and sends one email.
// Shared by the Cloudflare cron handler (src/server.ts) and sync/trigger-digest.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { parseTopicEntriesFromMd } from "./digest.functions";
import { sendEmail } from "./email";
import { briefToText, buildWeeklyDigestEmail, type RadarPick, type TopicBrief, type TopicReference } from "./weekly-email";
import { embed } from "./gemini";
import type { DiscoveredResource } from "./discovery";

const DIGEST_TZ = "Europe/Paris";
const DIGEST_WEEKDAY = "Fri";
const DIGEST_HOUR = 12;
const STALE_TOPICS_DAYS = 6;
// Generated chunk labels ("Key idea 2", "Section 3") mean nothing to a reader
const CHUNK_LABEL = /^(key idea|section) \d+$/i;

// ─── Tech radar (one reading pick per week, beyond the week's topics) ─────────

// Standing interests of a product leader in tech — intentionally NOT derived from the week
const RADAR_QUERY =
  "frontier AI capabilities and acceleration, the future of software and SaaS under AI agents, service-as-software, product leadership through technological disruption";

const RADAR_TOOL = {
  name: "pick_radar" as const,
  description: "Pick one source worth reading this week for a product leader in tech",
  input_schema: {
    type: "object" as const,
    properties: {
      pick: { type: "integer" as const, description: "1-based index of the chosen candidate" },
      why: { type: "string" as const, description: "Why it matters right now for a product leader in tech (max 40 words), grounded in the excerpt" },
    },
    required: ["pick", "why"],
  },
};

/**
 * One reading recommendation per digest, tied to the standing stakes of leading product
 * in tech rather than to the week's topics. Sources cited in this digest and all past
 * radar picks (digest_themes.theme_type = 'tech_radar') are excluded, so it rotates.
 */
async function pickTechRadar(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  userId: string,
  briefs: TopicBrief[],
  appUrl: string,
): Promise<RadarPick | null> {
  const embedding = await embed(RADAR_QUERY).catch(() => null);
  if (!embedding) return null;
  const { data: chunks } = await supabase.rpc("match_chunks", {
    p_user_id: userId,
    p_query_embedding: `[${embedding.join(",")}]`,
    p_match_count: 30,
    p_min_score: 0.3,
  });

  const { data: past } = await supabase
    .from("digest_themes")
    .select("theme_text")
    .eq("user_id", userId)
    .eq("theme_type", "tech_radar");
  const excluded = new Set<string>((past ?? []).map((r) => (r.theme_text as string).toLowerCase()));
  for (const b of briefs) for (const r of b.references) excluded.add(r.title.toLowerCase());

  // One candidate per source, best chunk first
  const seen = new Set<string>();
  const candidates: (MatchedChunk & { libUrl: string })[] = [];
  for (const c of (chunks ?? []) as MatchedChunk[]) {
    if (seen.has(c.source_id) || excluded.has(c.title.toLowerCase())) continue;
    seen.add(c.source_id);
    candidates.push({ ...c, libUrl: c.url ?? `${appUrl}/book/${c.source_id}?passage=${c.chunk_id}` });
    if (candidates.length === 6) break;
  }
  if (candidates.length === 0) return null;

  const res = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 300,
    system: [{
      type: "text",
      text: "You pick one weekly reading for a product leader in tech, from their own library. Choose the source whose excerpt speaks most to the standing stakes of the moment (AI acceleration, the future of software, leading product through disruption) — independent of any current project. Use the pick_radar tool only.",
      cache_control: { type: "ephemeral" },
    }],
    tools: [RADAR_TOOL],
    tool_choice: { type: "tool", name: RADAR_TOOL.name },
    messages: [{
      role: "user",
      content: candidates
        .map((c, i) => `[${i + 1}] ${c.title}${c.author ? ` — ${c.author}` : ""}\n${c.content.slice(0, 350)}`)
        .join("\n\n"),
    }],
  });
  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;
  const { pick, why } = toolUse.input as { pick: number; why: string };
  const chosen = candidates[pick - 1] ?? candidates[0];
  if (!why?.trim()) return null;
  return {
    title: chosen.title,
    author: chosen.author,
    chapterTitle: chosen.chapter_title && !CHUNK_LABEL.test(chosen.chapter_title) ? chosen.chapter_title : null,
    url: chosen.libUrl,
    why,
  };
}

// ─── Topic brief (Opus, structured) ───────────────────────────────────────────

const BRIEF_SYSTEM = (librarianName: string, displayName: string) => `You are ${librarianName}, writing ${displayName}'s weekly Friday deep-dive.
${displayName} spends at most 15 minutes on this email to decide which 3–4 sources to read this afternoon.
For each work challenge you get numbered library passages [n]. Write a scannable brief with the write_topic_brief tool.

RULES:
- Concise and precise: every bullet states one concrete idea from the passages — no filler, no hedging, no restating the question.
- Only use what the passages say. Cite each idea with the [n] numbers it comes from.
- "why" lines tell the reader what they will get from reading that source, so they can decide in seconds.
- Recommend as read_first the single passage most useful for deciding on this challenge.
- Write in English.`;

const BRIEF_TOOL = {
  name: "write_topic_brief" as const,
  description: "Scannable brief connecting one work challenge to library passages",
  input_schema: {
    type: "object" as const,
    properties: {
      takeaway: { type: "string" as const, description: "The one thing to retain, in one sentence (max 25 words)" },
      ideas: {
        type: "array" as const,
        minItems: 2,
        maxItems: 4,
        description: "Key ideas from the passages, one per bullet (max 25 words each)",
        items: {
          type: "object" as const,
          properties: {
            text: { type: "string" as const },
            refs: { type: "array" as const, items: { type: "integer" as const }, description: "Passage numbers supporting this idea" },
          },
          required: ["text", "refs"],
        },
      },
      tension: {
        type: ["string", "null"] as const,
        description: "Where passages disagree or a key caveat for this context (max 25 words), or null",
      },
      read_first: {
        type: "object" as const,
        properties: {
          ref: { type: "integer" as const },
          why: { type: "string" as const, description: "Why read this first, for this challenge (max 20 words)" },
        },
        required: ["ref", "why"],
      },
      source_notes: {
        type: "array" as const,
        description: "For each passage worth reading: what reading its source gives you (max 15 words)",
        items: {
          type: "object" as const,
          properties: { ref: { type: "integer" as const }, why: { type: "string" as const } },
          required: ["ref", "why"],
        },
      },
    },
    required: ["takeaway", "ideas", "tension", "read_first", "source_notes"],
  },
};

type BriefInput = {
  takeaway: string;
  ideas: { text: string; refs: number[] }[];
  tension: string | null;
  read_first: { ref: number; why: string };
  source_notes: { ref: number; why: string }[];
};

async function writeTopicBrief(
  anthropic: Anthropic,
  names: { librarianName: string; displayName: string },
  topic: { title: string; query: string },
  matched: MatchedChunk[],
  references: TopicReference[],
): Promise<Omit<TopicBrief, "discoveredResources">> {
  const passages = matched
    .map((c, j) => `[${j + 1}] ${c.title}${c.author ? ` — ${c.author}` : ""}\n${c.content.slice(0, 600)}`)
    .join("\n\n");
  const res = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    system: [{ type: "text", text: BRIEF_SYSTEM(names.librarianName, names.displayName), cache_control: { type: "ephemeral" } }],
    tools: [BRIEF_TOOL],
    tool_choice: { type: "tool", name: BRIEF_TOOL.name },
    messages: [{ role: "user", content: `Challenge: "${topic.title}"\n\nQuestion: "${topic.query}"\n\nPassages:\n${passages}` }],
  });
  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("No brief returned");
  const b = toolUse.input as BriefInput;

  const valid = (r: number) => Number.isInteger(r) && r >= 1 && r <= references.length;
  const ideas = (b.ideas ?? [])
    .map((i) => ({ text: i.text, refs: (i.refs ?? []).filter(valid) }))
    .filter((i) => i.text?.trim());
  const notes = new Map((b.source_notes ?? []).filter((n) => valid(n.ref)).map((n) => [n.ref, n.why]));
  const readFirst = b.read_first && valid(b.read_first.ref) ? b.read_first : null;
  // Show only the passages the brief actually uses, in [n] order
  const used = new Set<number>([...ideas.flatMap((i) => i.refs), ...notes.keys(), ...(readFirst ? [readFirst.ref] : [])]);

  return {
    theme: topic.title,
    takeaway: b.takeaway,
    ideas,
    tension: b.tension?.trim() ? b.tension : null,
    readFirst,
    references: references.filter((r) => used.has(r.ref)).map((r) => ({ ...r, why: notes.get(r.ref) ?? null })),
  };
}

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
  /** Build the email without sending it or writing to the database; receives the result. */
  preview?: (email: { to: string; subject: string; html: string; text: string }) => void;
  log?: (msg: string) => void;
};

export async function runWeeklyDigest(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  { appUrl, now = new Date(), force = false, log = console.log, preview }: WeeklyDigestOptions,
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
      await runForProfile(supabase, anthropic, p, { appUrl, now, force: force || Boolean(preview), log, preview });
    } catch (err) {
      console.error(`Weekly digest failed for user ${p.user_id}:`, err);
    }
  }
}

async function runForProfile(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  p: DigestProfile,
  { appUrl, now, force, log, preview }: Required<Omit<WeeklyDigestOptions, "preview">> & Pick<WeeklyDigestOptions, "preview">,
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

  const { data: run } = preview
    ? { data: null }
    : await supabase
        .from("digest_runs")
        .upsert(
          { user_id: p.user_id, run_date: runDate, meetings_found: 1, themes_found: topics.length },
          { onConflict: "user_id,run_date" },
        )
        .select("id")
        .single();
  const digestRunId = (run?.id as string) ?? "preview";
  if (run?.id) await supabase.from("digest_themes").delete().eq("digest_run_id", digestRunId);

  const briefs: TopicBrief[] = [];
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

    // One numbered reference per passage, matching the [n] markers in the brief.
    // Books have no external URL: link to the cited passage in the Libris reader.
    const references: TopicReference[] = matched.map((c, j) => ({
      ref: j + 1,
      title: c.title,
      author: c.author,
      chapterTitle: c.chapter_title && !CHUNK_LABEL.test(c.chapter_title) ? c.chapter_title : null,
      url: c.url ?? `${appUrl}/book/${c.source_id}?passage=${c.chunk_id}`, // opens the reader on this passage
      why: null,
    }));

    let brief: TopicBrief;
    if (matched.length > 0) {
      try {
        brief = await writeTopicBrief(anthropic, { librarianName, displayName }, topic, matched, references);
      } catch (err) {
        console.error(`Weekly digest: brief failed for topic ${i + 1}:`, err);
        continue;
      }
    } else {
      brief = {
        theme: topic.title,
        takeaway: "Your library has little on this yet — new sources were added below.",
        ideas: [],
        tension: null,
        readFirst: null,
        references: [],
      };
    }
    if (discovered.length > 0) brief.discoveredResources = discovered;
    briefs.push(brief);
    citationCount += new Set(brief.references.map((r) => r.url)).size;
    const synthesis = briefToText(brief);

    if (!preview) {
      const themeRow = {
        digest_run_id: digestRunId,
        user_id: p.user_id,
        theme_text: topic.title,
        theme_type: "topic",
        synthesis,
      };
      const sources = brief.references.map(({ ref, title, author, chapterTitle, url }) => ({ ref, title, author, chapterTitle, url }));
      const { error: themeErr } = await supabase.from("digest_themes").insert({ ...themeRow, sources });
      if (themeErr) {
        // sources column not migrated yet: keep the digest working without it
        console.error(`Weekly digest: theme insert with sources failed (${themeErr.message}) — retrying without`);
        await supabase.from("digest_themes").insert(themeRow);
      }
    }
  }

  if (!preview) await supabase.from("digest_runs").update({ citations_found: citationCount }).eq("id", digestRunId);
  if (briefs.length === 0) {
    log(`Weekly digest: no sections generated for user ${p.user_id}`);
    return;
  }

  // Flag a broken TOPICS.md sync instead of silently re-sending last week's topics
  const updatedAt = p.topics_updated_at ? new Date(p.topics_updated_at) : null;
  const staleDays = updatedAt ? Math.floor((now.getTime() - updatedAt.getTime()) / 86_400_000) : null;
  const notice = staleDays === null || staleDays >= STALE_TOPICS_DAYS
    ? `Heads-up: your topics haven't been synced for ${staleDays === null ? "a while" : `${staleDays} days`} — check the TOPICS.md routine and sync.`
    : undefined;

  // Weekly reading pick, beyond this week's topics
  const radar = await pickTechRadar(supabase, anthropic, p.user_id, briefs, appUrl).catch((err) => {
    console.error("Weekly digest: tech radar failed:", err);
    return null;
  });
  if (radar && !preview) {
    await supabase.from("digest_themes").insert({
      digest_run_id: digestRunId,
      user_id: p.user_id,
      theme_text: radar.title,
      theme_type: "tech_radar",
      synthesis: radar.why,
    });
  }

  const dayLabel = now.toLocaleDateString("en-GB", { timeZone: DIGEST_TZ, weekday: "long", day: "numeric", month: "long" });
  const dateLabel = `Week ${isoWeek(now)} · ${dayLabel}`;
  const { subject, html, text } = buildWeeklyDigestEmail(displayName, librarianName, dateLabel, briefs, {
    quizUrl: `${appUrl}/quiz/${digestRunId}`,
    notice,
    radar: radar ?? undefined,
  });
  if (preview) {
    preview({ to: p.digest_email, subject, html, text });
    return;
  }
  const result = await sendEmail({ to: p.digest_email, subject, html, text });

  await supabase
    .from("digest_runs")
    .update({ email_sent: result.sent, email_sent_at: result.sent ? new Date().toISOString() : null })
    .eq("id", digestRunId);
  log(`Weekly digest: user=${p.user_id} topics=${topics.length} sections=${briefs.length} sent=${result.sent}`);
  if (!result.sent && result.error) console.error(`Weekly digest email failed: ${result.error}`);
}
