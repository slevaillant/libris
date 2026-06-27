import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { embed } from "@/lib/gemini";
import { sendEmail, buildDigestEmail, type DigestSection } from "@/lib/email";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MeetingThemes = {
  problems: string[];
  decisions: string[];
  open_questions: string[];
  topics: string[];
  topicTitles?: string[]; // short display labels; topics[] holds the RAG search query
};

export type DigestRunSummary = {
  id: string;
  runDate: string;
  meetingsFound: number;
  themesFound: number;
  citationsFound: number;
  emailSent: boolean;
  emailSentAt: string | null;
  createdAt: string;
};

export type DigestThemeRow = {
  id: string;
  themeText: string;
  themeType: string;
  synthesis: string | null;
};

// ─── Topics parser ───────────────────────────────────────────────────────────

/**
 * Extract active (unchecked) topics from TOPICS.md.
 * Supports two formats:
 *   New: - [ ] date | **Bold Title** | _source_
 *        > **Question à explorer :** <question text>
 *   Legacy: - [ ] date | #hashtag-title | _source_
 *
 * Returns the "Question à explorer" text when present (better for RAG embedding),
 * otherwise the title. Returns at most 8 topics.
 */
export function parseTopicsFromMd(md: string): string[] {
  const section = md.match(/<!-- TOPICS_START -->([\s\S]*?)(?:<!-- TOPICS_DONE -->|$)/)?.[1] ?? md;
  const lines = section.split("\n");
  const topics: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New format: - [ ] date | **Title** | _source_
    const boldMatch = line.match(/^- \[ \] .+\| \*\*([^*]+)\*\*/);
    if (boldMatch) {
      const title = boldMatch[1].trim();
      // Look ahead up to 5 lines for "Question à explorer"
      let query = title;
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (lines[j].startsWith("- [")) break;
        const qMatch = lines[j].match(/Question [àa]\s+explorer\s*:\*\*\s*(.+)/i);
        if (qMatch) { query = qMatch[1].trim(); break; }
      }
      topics.push(query);
      continue;
    }

    // Legacy format: - [ ] date | #hashtag-title | _source_
    const hashMatch = line.match(/^- \[ \] .+\| (#[\wÀ-ž-]+)/);
    if (hashMatch) topics.push(hashMatch[1].slice(1).replace(/-/g, " "));
  }

  return topics.slice(0, 8);
}

/**
 * Extract display titles only (for the UI chips).
 * Returns bold titles or cleaned hashtags — NOT the full question text.
 */
export function parseTopicTitlesFromMd(md: string): string[] {
  const section = md.match(/<!-- TOPICS_START -->([\s\S]*?)(?:<!-- TOPICS_DONE -->|$)/)?.[1] ?? md;
  const titles: string[] = [];
  for (const line of section.split("\n")) {
    const boldMatch = line.match(/^- \[ \] .+\| \*\*([^*]+)\*\*/);
    if (boldMatch) { titles.push(boldMatch[1].trim()); continue; }
    const hashMatch = line.match(/^- \[ \] .+\| (#[\wÀ-ž-]+)/);
    if (hashMatch) titles.push(hashMatch[1].slice(1).replace(/-/g, " "));
  }
  return titles.slice(0, 8);
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const L1 = `LIBRIS SYSTEM
You are part of Libris, a personal knowledge intelligence system.
CORE RULES:
1. Only use knowledge from the user's indexed library.
2. Cite sources inline by author last name, e.g. (Huryn) or (Wensing). Never mention "Key idea N", "Section N", or any chunk label.
3. If no relevant source exists: say so honestly.`;

function buildDigestL2(displayName: string, librarianName: string): string {
  return `You are ${librarianName}, synthesising a morning digest for ${displayName}.
The digest connects yesterday's meeting themes to passages from their personal library.
This is not a search result summary — it is a letter from their librarian.

VOICE: warm, direct, opinionated. No corporate language. No bullet points.
Speak in natural prose. Reference specific chapters and passages.
If a theme has no strong library match, say so and suggest what to add.`;
}

// ─── RAG search for a single theme ───────────────────────────────────────────

type MatchedChunk = {
  chunk_id: string;
  source_id: string;
  title: string;
  author: string | null;
  chapter_title: string | null;
  content: string;
  similarity: number;
  url: string | null;
  source_type: string;
};

async function searchTheme(
  supabase: SupabaseClient,
  userId: string,
  theme: string,
): Promise<MatchedChunk[]> {
  const embedding = await embed(theme).catch(() => null);
  if (!embedding) return [];

  const { data } = await supabase.rpc("match_chunks", {
    p_user_id: userId,
    p_query_embedding: `[${embedding.join(",")}]`,
    p_match_count: 5,
    p_min_score: 0.50,
  });

  return (data ?? []) as MatchedChunk[];
}

// ─── Synthesise one digest section (Opus) ────────────────────────────────────

async function synthesiseSection(
  anthropic: Anthropic,
  displayName: string,
  librarianName: string,
  theme: string,
  chunks: MatchedChunk[],
): Promise<{ synthesis: string; readingSuggestion: { title: string; chapter: string } | null }> {
  if (chunks.length === 0) {
    return {
      synthesis: `My sources on "${theme}" are thinner than I'd like. Worth adding more on this topic.`,
      readingSuggestion: null,
    };
  }

  const passagesText = chunks
    .map((c, i) => `[${i + 1}] ${c.title}${c.author ? ` — ${c.author}` : ""}\n${c.content.slice(0, 400)}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "text" as const, text: L1, cache_control: { type: "ephemeral" as const } },
          { type: "text" as const, text: buildDigestL2(displayName, librarianName), cache_control: { type: "ephemeral" as const } },
          {
            type: "text" as const,
            text: `Meeting theme: "${theme}"\n\nRelevant passages from ${displayName}'s library:\n${passagesText}\n\nWrite 3-4 direct sentences connecting this theme to the most relevant passage(s). Quote or paraphrase the actual insight — don't summarise generically. Cite authors by last name inline. No bullet points. If you have a specific reading suggestion, add it as a final sentence starting with "→".`,
          },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  const synthesis = text?.type === "text" ? text.text : `No synthesis available for "${theme}".`;

  // Extract reading suggestion from the synthesis text
  const suggestionMatch = synthesis.match(/(?:re-read|read|revisit)[:\s]+([^\.]+?(?:Chapter|chapter)[^\.]+)/i);
  const readingSuggestion = suggestionMatch
    ? { title: chunks[0].title, chapter: chunks[0].chapter_title ?? "Chapter 1" }
    : null;

  return { synthesis, readingSuggestion };
}

// ─── Core digest pipeline ─────────────────────────────────────────────────────

async function runDigestPipeline(
  supabase: SupabaseClient,
  userId: string,
  themes: MeetingThemes,
  runDate: string,
  displayName = "there",
  librarianName = "Lumen",
): Promise<{ digestRunId: string; sections: DigestSection[]; citationCount: number }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Flatten all theme types into searchable strings, tagged by type.
  // `text` is used for RAG embedding; `label` is shown to the user.
  const themeEntries: { text: string; type: string; label: string }[] = [
    ...themes.problems.map((t) => ({ text: t, type: "problem", label: t })),
    ...themes.decisions.map((t) => ({ text: t, type: "decision", label: t })),
    ...themes.open_questions.map((t) => ({ text: t, type: "open_question", label: t })),
    ...themes.topics.map((t, i) => ({
      text: t,
      type: "topic",
      label: themes.topicTitles?.[i] ?? t, // short title when available
    })),
  ].slice(0, 8); // max 8 themes per digest

  // Create digest_run record
  const { data: run } = await supabase
    .from("digest_runs")
    .upsert({ user_id: userId, run_date: runDate, meetings_found: 1, themes_found: themeEntries.length }, { onConflict: "user_id,run_date" })
    .select("id")
    .single();

  const digestRunId = run?.id as string ?? crypto.randomUUID();

  // Parallel RAG search for all themes
  const chunksByTheme = await Promise.all(
    themeEntries.map((e) => searchTheme(supabase as Parameters<typeof searchTheme>[0], userId, e.text)),
  );

  // Sequential synthesis (Opus — rate limit friendly)
  const sections: DigestSection[] = [];
  let citationCount = 0;

  for (let i = 0; i < themeEntries.length; i++) {
    const { text: searchQuery, type: themeType, label: displayTheme } = themeEntries[i];
    const chunks = chunksByTheme[i];

    // Discovery: when library coverage is thin, find and ingest external resources
    let discoveredResources: { url: string; title: string; sourceType: string; ingested: boolean }[] = [];
    if (chunks.length < 2 && themeType === "topic") {
      const { discoverAndIngest } = await import("./discovery");
      discoveredResources = await discoverAndIngest(supabase as Parameters<typeof searchTheme>[0], anthropic, userId, searchQuery);
      if (chunks.length === 0 && discoveredResources.filter((r) => r.ingested).length === 0) continue;
    }

    const { synthesis, readingSuggestion } = await synthesiseSection(anthropic, displayName, librarianName, searchQuery, chunks);

    // Deduplicate citations by source URL — same article matched by multiple chunks shows once
    const seenSources = new Set<string>();
    const citations = chunks
      .filter((c) => {
        const key = c.url ?? c.source_id;
        if (seenSources.has(key)) return false;
        seenSources.add(key);
        return true;
      })
      .slice(0, 3)
      .map((c) => ({ title: c.title, author: c.author, chapterTitle: null, url: c.url ?? null }));
    citationCount += citations.length;

    sections.push({ theme: displayTheme, synthesis, citations, readingSuggestion, discoveredResources: discoveredResources.length > 0 ? discoveredResources : undefined });

    // Store theme in DB (anonymised — no transcript content)
    await supabase.from("digest_themes").insert({
      digest_run_id: digestRunId,
      user_id: userId,
      theme_text: displayTheme,
      theme_type: themeType,
      synthesis,
    });
  }

  // Update run stats
  await supabase
    .from("digest_runs")
    .update({ citations_found: citationCount })
    .eq("id", digestRunId);

  return { digestRunId, sections, citationCount };
}

// ─── runDigest — reads topics_md from profile when no themes supplied ─────────

export const runDigest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      themes: z.object({
        problems: z.array(z.string()).default([]),
        decisions: z.array(z.string()).default([]),
        open_questions: z.array(z.string()).default([]),
        topics: z.array(z.string()).default([]),
      }).optional(),
      sendEmail: z.boolean().default(true),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name, librarian_name, digest_email, digest_enabled, timezone, topics_md")
      .eq("user_id", userId)
      .maybeSingle();

    const displayName = (profile?.display_name as string) ?? "there";
    const librarianName = (profile?.librarian_name as string) ?? "Lumen";
    const digestEmail = profile?.digest_email as string | null;

    // Use provided themes, or fall back to topics from TOPICS.md.
    // When reading from TOPICS.md, store short titles separately from the search queries.
    const themes: MeetingThemes = data.themes ?? (() => {
      const md = profile?.topics_md as string | null;
      return {
        problems: [],
        decisions: [],
        open_questions: [],
        topics: md ? parseTopicsFromMd(md) : [],        // full questions → RAG
        topicTitles: md ? parseTopicTitlesFromMd(md) : [], // short titles → display
      };
    })();

    if (themes.topics.length === 0 && themes.problems.length === 0 && themes.open_questions.length === 0) {
      throw new Error("No topics found — sync your TOPICS.md first (npx tsx sync/push-topics.ts)");
    }

    const runDate = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

    const { digestRunId, sections, citationCount } = await runDigestPipeline(
      supabase as Parameters<typeof runDigestPipeline>[0],
      userId,
      themes,
      runDate,
    );

    // Send email if configured
    let emailSent = false;
    if (data.sendEmail && digestEmail) {
      const dateLabel = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      const appUrl = process.env.APP_URL ?? "https://libris.seblevaillant.com";
      const quizUrl = `${appUrl}/quiz/${digestRunId}`;
      const { subject, html, text } = buildDigestEmail(displayName, librarianName, dateLabel, sections, quizUrl);
      const result = await sendEmail({ to: digestEmail, subject, html, text });
      emailSent = result.sent;
      if (!result.sent && result.error) console.error(`[digest] email failed: ${result.error}`);

      await supabase
        .from("digest_runs")
        .update({ email_sent: emailSent, email_sent_at: emailSent ? new Date().toISOString() : null })
        .eq("id", digestRunId);
    }

    return { digestRunId, sectionsCount: sections.length, citationCount, emailSent, sections };
  });

// ─── Test digest with predefined themes ──────────────────────────────────────

export const triggerTestDigest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const testThemes: MeetingThemes = {
      problems: ["scaling a team while maintaining speed and quality"],
      decisions: [],
      open_questions: ["how to evaluate leadership potential in senior hires"],
      topics: ["management", "team building", "decision making under uncertainty"],
    };

    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name, librarian_name, digest_email")
      .eq("user_id", userId)
      .maybeSingle();

    const displayName = (profile?.display_name as string) ?? "there";
    const librarianName = (profile?.librarian_name as string) ?? "Lumen";

    const runDate = new Date().toLocaleDateString("en-CA");
    const { digestRunId, sections, citationCount } = await runDigestPipeline(
      supabase as Parameters<typeof runDigestPipeline>[0],
      userId,
      testThemes,
      runDate,
    );

    return { digestRunId, sectionsCount: sections.length, citationCount, sections, displayName, librarianName };
  });

// ─── List last 7 digest runs ──────────────────────────────────────────────────

export const listDigestRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("digest_runs")
      .select("id, run_date, meetings_found, themes_found, citations_found, email_sent, email_sent_at, created_at")
      .eq("user_id", userId)
      .order("run_date", { ascending: false })
      .limit(7);

    if (error) throw new Error(error.message);

    return (data ?? []).map(
      (r): DigestRunSummary => ({
        id: r.id,
        runDate: r.run_date,
        meetingsFound: r.meetings_found,
        themesFound: r.themes_found,
        citationsFound: r.citations_found,
        emailSent: r.email_sent,
        emailSentAt: r.email_sent_at,
        createdAt: r.created_at,
      }),
    );
  });

// ─── Get a single digest run with its themes ─────────────────────────────────

export const getDigestRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ digestRunId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: themes, error } = await supabase
      .from("digest_themes")
      .select("id, theme_text, theme_type, synthesis")
      .eq("digest_run_id", data.digestRunId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    return (themes ?? []).map(
      (t): DigestThemeRow => ({
        id: t.id,
        themeText: t.theme_text,
        themeType: t.theme_type,
        synthesis: t.synthesis,
      }),
    );
  });
