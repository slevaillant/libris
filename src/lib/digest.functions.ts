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

// ─── Prompts ──────────────────────────────────────────────────────────────────

const L1 = `LIBRIS SYSTEM
You are part of Libris, a personal knowledge intelligence system.
CORE RULES:
1. Only use knowledge from the user's indexed library.
2. Every factual claim must cite a specific source: [Title — Author, Chapter N].
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
    .map((c, i) => `[${i + 1}] ${c.title}${c.author ? ` — ${c.author}` : ""}${c.chapter_title ? `, ${c.chapter_title}` : ""}\n${c.content.slice(0, 400)}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          { type: "text" as const, text: L1, cache_control: { type: "ephemeral" as const } },
          { type: "text" as const, text: buildDigestL2(displayName, librarianName), cache_control: { type: "ephemeral" as const } },
          {
            type: "text" as const,
            text: `Meeting theme: "${theme}"\n\nRelevant passages from ${displayName}'s library:\n${passagesText}\n\nWrite one focused paragraph connecting this theme to the library. End with a specific reading suggestion if you have one.`,
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
): Promise<{ digestRunId: string; sections: DigestSection[]; citationCount: number }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Flatten all theme types into searchable strings, tagged by type
  const themeEntries: { text: string; type: string }[] = [
    ...themes.problems.map((t) => ({ text: t, type: "problem" })),
    ...themes.decisions.map((t) => ({ text: t, type: "decision" })),
    ...themes.open_questions.map((t) => ({ text: t, type: "open_question" })),
    ...themes.topics.map((t) => ({ text: t, type: "topic" })),
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
    const { text: theme, type: themeType } = themeEntries[i];
    const chunks = chunksByTheme[i];

    if (chunks.length === 0 && themeType === "topic") continue; // skip thin topic matches

    const { synthesis, readingSuggestion } = await synthesiseSection(anthropic, "there", "Lumen", theme, chunks);

    const citations = chunks.slice(0, 3).map((c) => ({
      title: c.title,
      author: c.author,
      chapterTitle: c.chapter_title,
    }));
    citationCount += citations.length;

    sections.push({ theme, synthesis, citations, readingSuggestion });

    // Store theme in DB (anonymised — no transcript content)
    await supabase.from("digest_themes").insert({
      digest_run_id: digestRunId,
      user_id: userId,
      theme_text: theme,
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

// ─── runDigest — full pipeline (Granola themes injected here when available) ──

export const runDigest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      themes: z.object({
        problems: z.array(z.string()).default([]),
        decisions: z.array(z.string()).default([]),
        open_questions: z.array(z.string()).default([]),
        topics: z.array(z.string()).default([]),
      }),
      sendEmail: z.boolean().default(true),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name, librarian_name, digest_email, digest_enabled, timezone")
      .eq("user_id", userId)
      .maybeSingle();

    const displayName = (profile?.display_name as string) ?? "there";
    const librarianName = (profile?.librarian_name as string) ?? "Lumen";
    const digestEmail = profile?.digest_email as string | null;

    const runDate = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

    const { digestRunId, sections, citationCount } = await runDigestPipeline(
      supabase as Parameters<typeof runDigestPipeline>[0],
      userId,
      data.themes,
      runDate,
    );

    // Send email if configured
    let emailSent = false;
    if (data.sendEmail && digestEmail) {
      const dateLabel = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      const { subject, html, text } = buildDigestEmail(displayName, librarianName, dateLabel, sections);
      const result = await sendEmail({ to: digestEmail, subject, html, text });
      emailSent = result.sent;

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
