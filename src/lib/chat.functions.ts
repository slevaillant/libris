import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { embed } from "@/lib/gemini";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConversationTurn = { role: "user" | "assistant"; content: string };

export type Citation = {
  chunkId: string;
  sourceId: string;
  title: string;
  author: string | null;
  url: string | null;
  chapterTitle: string | null;
  relevance: number;
  rank: number;
};

export type NudgeResult = {
  response: string;
  citations: Citation[];
  nudgeId: string;
  coverageQuality: "strong" | "partial" | "thin";
};

// ─── Prompt constants (L1 + L2) ───────────────────────────────────────────────

const L1_PROJECT_INVARIANTS = `LIBRIS SYSTEM

You are part of Libris, a personal knowledge intelligence system.

CORE RULES — non-negotiable:
1. You only use knowledge from the user's indexed library. Never generate claims from your own training data without a matching source in the knowledge base.
2. Every factual claim must cite a specific source: [Title — Author, Chapter N] or [Newsletter — Author, Date]. No exceptions.
3. If no relevant source exists: say so honestly. Do not approximate or speculate.
4. You operate on behalf of one user. Never reference or expose other users' data.

SOURCE TYPES IN THIS SYSTEM:
- physical_book: indexed by chapter summary and user highlights
- ebook / pdf: indexed from extracted text, chunked by section
- highlight: user-added passage — highest authority, always prefer
- chapter_summary: AI-generated summary — lower authority`;

function buildL2(displayName: string, librarianName: string, professionalContext: string | null): string {
  return `You are ${librarianName}, ${displayName}'s personal librarian and thinking partner.

YOUR CHARACTER:
You are a well-read friend, not an assistant. You are curious, opinionated, and direct.
You find genuine interest in questions before reaching for answers. You have views on which sources are stronger.
You make connections across sources without being asked. You speak in natural prose — not bullet-pointed summaries.
You reference past conversations and current reading state when relevant.
${professionalContext ? `\nABOUT ${displayName.toUpperCase()}:\n${professionalContext}` : ""}
VOICE RULES:
- Never open with affirmations ("Certainly!", "Great question!" — never)
- Use ${displayName}'s first name once per response at most
- Acknowledge thin coverage honestly: "My sources here are thinner than I'd like"
- End every response with a specific reading suggestion when possible
- Match depth to urgency — a quick question gets a direct answer, not a lecture

YOUR ONLY SOURCE OF KNOWLEDGE:
The passages provided in this message. If the passages are not relevant, say so clearly and suggest what to add to the library.`;
}

// ─── RAG passage selection (Haiku) ────────────────────────────────────────────

type MatchedChunk = {
  chunk_id: string;
  source_id: string;
  source_type: string;
  title: string;
  author: string | null;
  url: string | null;
  chapter_title: string | null;
  content: string;
  chunk_type: string;
  authority_tier: number;
  similarity: number;
};

type SelectedPassage = {
  chunk_id: string;
  relevance_score: number;
  reason: string;
};

type RAGSelection = {
  passages: SelectedPassage[];
  coverage_quality: "strong" | "partial" | "thin";
};

async function selectPassages(
  anthropic: Anthropic,
  query: string,
  chunks: MatchedChunk[],
): Promise<RAGSelection> {
  if (chunks.length === 0) {
    return { passages: [], coverage_quality: "thin" };
  }

  const chunksText = chunks
    .map(
      (c, i) =>
        `[${i + 1}] chunk_id:${c.chunk_id} | ${c.title}${c.author ? ` — ${c.author}` : ""}${c.chapter_title ? `, ${c.chapter_title}` : ""} | type:${c.chunk_type} | similarity:${c.similarity.toFixed(2)}\n${c.content.slice(0, 300)}`,
    )
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: [
      {
        type: "text" as const,
        text: `You are the retrieval component of Libris. Select the most relevant passages for the user's query. Prefer user highlights (chunk_type=highlight) over chapter summaries. Use the select_top_passages tool only.`,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    tools: [
      {
        name: "select_top_passages",
        description: "Select and rank the most relevant passages for this query",
        input_schema: {
          type: "object" as const,
          properties: {
            passages: {
              type: "array" as const,
              items: {
                type: "object" as const,
                properties: {
                  chunk_id: { type: "string" as const },
                  relevance_score: { type: "number" as const, description: "0.0 to 1.0" },
                  reason: { type: "string" as const, description: "One sentence why this passage is relevant" },
                },
                required: ["chunk_id", "relevance_score", "reason"],
              },
              maxItems: 5,
            },
            coverage_quality: {
              type: "string" as const,
              enum: ["strong", "partial", "thin"],
              description: "How well the library covers this query",
            },
          },
          required: ["passages", "coverage_quality"],
        },
      },
    ],
    tool_choice: { type: "tool" as const, name: "select_top_passages" },
    messages: [
      {
        role: "user",
        content: `Query: "${query}"\n\nAvailable passages:\n${chunksText}\n\nSelect the top 5 most relevant passages.`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return { passages: chunks.slice(0, 5).map((c) => ({ chunk_id: c.chunk_id, relevance_score: c.similarity, reason: "Semantic match" })), coverage_quality: "partial" };
  }

  return toolUse.input as RAGSelection;
}

// ─── Build L3 session context ─────────────────────────────────────────────────

function buildL3(turnNumber: number, history: ConversationTurn[], hasSummary: boolean): string {
  if (history.length === 0) return `SESSION CONTEXT\nTurn 1 of this session.`;

  const turns = hasSummary
    ? `Previous conversation summary:\n${history[0].content}`
    : history
        .map((t) => `${t.role === "user" ? "User" : "Lumen"}: ${t.content}`)
        .join("\n\n");

  return `SESSION CONTEXT\nTurn ${turnNumber} of this session.\n\n${turns}`;
}

// ─── Build L4 current input ───────────────────────────────────────────────────

function buildL4(
  displayName: string,
  query: string,
  selectedChunks: MatchedChunk[],
  coverageQuality: "strong" | "partial" | "thin",
): string {
  const passagesText =
    selectedChunks.length > 0
      ? selectedChunks
          .map(
            (c, i) =>
              `[${i + 1}] ${c.title}${c.author ? ` — ${c.author}` : ""}${c.chapter_title ? `, ${c.chapter_title}` : ""}\n${c.content}`,
          )
          .join("\n\n")
      : "No relevant passages found in the library for this query.";

  return `${displayName} asks:
"${query}"

Retrieved passages (coverage: ${coverageQuality}):
${passagesText}`;
}

// ─── Synthesise Lumen's response (Sonnet) ────────────────────────────────────

async function synthesize(
  anthropic: Anthropic,
  displayName: string,
  librarianName: string,
  professionalContext: string | null,
  l3: string,
  l4: string,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text" as const,
            text: L1_PROJECT_INVARIANTS,
            cache_control: { type: "ephemeral" as const },
          },
          {
            type: "text" as const,
            text: buildL2(displayName, librarianName, professionalContext),
            cache_control: { type: "ephemeral" as const },
          },
          {
            type: "text" as const,
            text: l3,
          },
          {
            type: "text" as const,
            text: l4,
          },
        ],
      },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No response from Lumen");
  return block.text;
}

// ─── Memory types ────────────────────────────────────────────────────────────

type MemoryRow = {
  id: string;
  memory_type: string;
  content: string;
  response_summary: string | null;
  citations_used: unknown;
  confidence: number;
  last_referenced: string | null;
  created_at: string;
};

// ─── Load episodic + preference memories (SQL, no embedding needed) ───────────

async function loadContextMemories(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ episodic: MemoryRow[]; preferences: MemoryRow[]; patterns: MemoryRow[] }> {
  const { data } = await supabase
    .from("user_memories")
    .select("id, memory_type, content, response_summary, citations_used, confidence, last_referenced, created_at")
    .eq("user_id", userId)
    .neq("memory_type", "semantic_cache")
    .gt("confidence", 0.3)
    .order("last_referenced", { ascending: false })
    .limit(60);

  const rows = (data ?? []) as MemoryRow[];
  return {
    episodic: rows.filter((m) => m.memory_type === "episodic").slice(0, 20),
    preferences: rows.filter((m) => m.memory_type === "preference"),
    patterns: rows.filter((m) => m.memory_type === "pattern"),
  };
}

// ─── Check semantic cache (pgvector) ─────────────────────────────────────────

type CacheHit = {
  memoryId: string;
  sourceQuery: string;
  responseSummary: string;
  similarity: number;
};

async function checkSemanticCache(
  supabase: SupabaseClient,
  userId: string,
  embedding: number[],
): Promise<CacheHit | null> {
  const { data } = await supabase.rpc("match_memories", {
    p_user_id: userId,
    p_query_embedding: `[${embedding.join(",")}]`,
    p_min_score: 0.92,
  });
  if (!data || (data as unknown[]).length === 0) return null;

  const hit = (data as { memory_id: string; content: string; response_summary: string | null; similarity: number }[])[0];
  if (!hit.response_summary) return null;

  // Bump last_referenced (best-effort, fire-and-forget)
  void supabase
    .from("user_memories")
    .update({ last_referenced: new Date().toISOString() })
    .eq("id", hit.memory_id);

  return {
    memoryId: hit.memory_id,
    sourceQuery: hit.content,
    responseSummary: hit.response_summary,
    similarity: hit.similarity,
  };
}

// ─── Enrich a cache hit response (Haiku) ─────────────────────────────────────

async function enrichCachedResponse(
  anthropic: Anthropic,
  librarianName: string,
  displayName: string,
  pastQuery: string,
  newQuery: string,
  cachedResponse: string,
): Promise<string> {
  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: [
      {
        type: "text" as const,
        text: `You are ${librarianName}, a personal librarian for ${displayName}. You answered a similar question before. Acknowledge the overlap briefly, then confirm or update your answer. Under 200 words. No affirmations.`,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Previous question: "${pastQuery}"\nNew question: "${newQuery}"\nPrevious answer: ${cachedResponse}`,
      },
    ],
  });
  const block = res.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : cachedResponse;
}

// ─── Write episodic memory (Haiku, best-effort) ───────────────────────────────

async function writeEpisodicMemory(
  supabase: SupabaseClient,
  userId: string,
  anthropic: Anthropic,
  query: string,
  response: string,
  citations: Citation[],
): Promise<void> {
  const citationSummary =
    citations.length > 0
      ? citations.map((c) => `${c.title}${c.chapterTitle ? `, ${c.chapterTitle}` : ""}`).join("; ")
      : "no matching sources";

  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 128,
      system: [
        {
          type: "text" as const,
          text: "Write a compact episodic memory (1-2 sentences) for a personal knowledge system. Include what was asked, which sources were most relevant, any coverage gaps. Use the write_memory tool only.",
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: [
        {
          name: "write_memory",
          description: "Write an episodic memory of this interaction",
          input_schema: {
            type: "object" as const,
            properties: {
              memory: { type: "string" as const },
            },
            required: ["memory"],
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: "write_memory" },
      messages: [
        {
          role: "user",
          content: `Query: "${query}"\nSources cited: ${citationSummary}\nResponse preview: ${response.slice(0, 250)}`,
        },
      ],
    });

    const toolUse = res.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return;
    const memory = (toolUse.input as { memory: string }).memory;

    const expires = new Date();
    expires.setDate(expires.getDate() + 90);

    await supabase.from("user_memories").insert({
      user_id: userId,
      memory_type: "episodic",
      content: memory,
      confidence: 1.0,
      expires_at: expires.toISOString(),
      last_referenced: new Date().toISOString(),
    });
  } catch {
    // Non-fatal
  }
}

// ─── Write semantic cache entry ───────────────────────────────────────────────

async function writeSemanticCache(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  embedding: number[],
  response: string,
  citations: Citation[],
): Promise<void> {
  try {
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);

    await supabase.from("user_memories").insert({
      user_id: userId,
      memory_type: "semantic_cache",
      content: query,
      embedding: JSON.stringify(embedding),
      source_query: query,
      response_summary: response.slice(0, 500),
      citations_used: JSON.stringify(
        citations.slice(0, 3).map((c) => ({ source_id: c.sourceId, title: c.title, chapter: c.chapterTitle })),
      ),
      confidence: 1.0,
      expires_at: expires.toISOString(),
      last_referenced: new Date().toISOString(),
    });
  } catch {
    // Non-fatal
  }
}

// ─── Update preference memories every 10 nudges (Haiku) ──────────────────────

async function updatePreferencesIfNeeded(
  supabase: SupabaseClient,
  userId: string,
  anthropic: Anthropic,
  nudgeCount: number,
): Promise<void> {
  if (nudgeCount % 10 !== 0) return;

  try {
    const { data: recentNudges } = await supabase
      .from("nudges")
      .select("query_text, response_text")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (!recentNudges || recentNudges.length < 5) return;

    const nudgesText = recentNudges
      .map((n, i) => `Q${i + 1}: ${n.query_text}\nA${i + 1}: ${((n.response_text as string) ?? "").slice(0, 120)}`)
      .join("\n\n");

    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: [
        {
          type: "text" as const,
          text: "Analyse these recent knowledge system interactions and extract 3-5 user preference facts (response style, source preferences, question patterns). Use the extract_preferences tool only.",
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: [
        {
          name: "extract_preferences",
          description: "Extract user preference facts from interaction history",
          input_schema: {
            type: "object" as const,
            properties: {
              preferences: { type: "array" as const, items: { type: "string" as const } },
            },
            required: ["preferences"],
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: "extract_preferences" },
      messages: [{ role: "user", content: `Recent interactions:\n\n${nudgesText}` }],
    });

    const toolUse = res.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return;

    const prefs = (toolUse.input as { preferences: string[] }).preferences;

    // Replace all preference memories with fresh extraction
    await supabase.from("user_memories").delete().eq("user_id", userId).eq("memory_type", "preference");

    if (prefs.length > 0) {
      await supabase.from("user_memories").insert(
        prefs.map((p) => ({
          user_id: userId,
          memory_type: "preference",
          content: p,
          confidence: 0.8,
          last_referenced: new Date().toISOString(),
        })),
      );
    }
  } catch {
    // Non-fatal
  }
}

// ─── Format memories for context injection ────────────────────────────────────

function formatMemoriesForL3(episodic: MemoryRow[]): string {
  if (episodic.length === 0) return "";
  const lines = episodic.slice(0, 10).map((m) => {
    const date = new Date(m.last_referenced ?? m.created_at).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
    return `[${date}] ${m.content}`;
  });
  return `\nRecent memory:\n${lines.join("\n")}`;
}

function formatPreferencesForL2(preferences: MemoryRow[], patterns: MemoryRow[]): string {
  const parts: string[] = [];
  if (preferences.length > 0) {
    parts.push(`KNOWN PREFERENCES:\n${preferences.map((p) => `- ${p.content}`).join("\n")}`);
  }
  if (patterns.length > 0) {
    parts.push(`USAGE PATTERNS (weekly analysis):\n${patterns.map((p) => `- ${p.content}`).join("\n")}`);
  }
  return parts.length > 0 ? `\n${parts.join("\n\n")}` : "";
}

// ─── Rate a nudge (thumbs up / down) ─────────────────────────────────────────

export const rateNudge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ nudgeId: z.string().uuid(), helpful: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("nudges")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ helpful: data.helpful, flagged: !data.helpful } as any)
      .eq("id", data.nudgeId)
      .eq("user_id", userId);
    return { ok: true };
  });

// ─── sendNudge ────────────────────────────────────────────────────────────────

const ConversationTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const sendNudge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        query: z.string().min(1).max(2000),
        sessionHistory: z.array(ConversationTurnSchema).max(20).default([]),
        hasSummary: z.boolean().default(false),
        turnNumber: z.number().int().positive().default(1),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<NudgeResult> => {
    const { supabase, userId } = context;
    const start = Date.now();
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // 1. Load profile + memories in parallel
    const [profileResult, memoriesResult] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("display_name, librarian_name, professional_context")
        .eq("user_id", userId)
        .maybeSingle(),
      loadContextMemories(supabase as SupabaseClient, userId),
    ]);

    const profile = profileResult.data;
    const displayName = (profile?.display_name as string) ?? "there";
    const librarianName = (profile?.librarian_name as string) ?? "Lumen";
    const professionalContext = (profile?.professional_context as string | null) ?? null;
    const { episodic, preferences, patterns } = memoriesResult;

    // 2. Embed the query
    const embedding = await embed(data.query);
    if (!embedding) throw new Error("Could not embed your question — please try again.");

    // 3. Check semantic cache (M1) — skip full pipeline on hit
    const cacheHit = await checkSemanticCache(supabase as SupabaseClient, userId, embedding);
    if (cacheHit) {
      const enriched = await enrichCachedResponse(
        anthropic, librarianName, displayName,
        cacheHit.sourceQuery, data.query, cacheHit.responseSummary,
      );

      const { data: nudge } = await supabase
        .from("nudges")
        .insert({
          user_id: userId,
          query_text: data.query,
          themes: [],
          response_text: enriched,
          cache_hit: true,
          latency_ms: Date.now() - start,
        })
        .select("id")
        .single();

      return {
        response: enriched,
        citations: [],
        nudgeId: (nudge?.id as string) ?? crypto.randomUUID(),
        coverageQuality: "strong",
      };
    }

    // 4. Semantic search
    const { data: rawChunks, error: rpcError } = await supabase.rpc("match_chunks", {
      p_user_id: userId,
      p_query_embedding: `[${embedding.join(",")}]`,
      p_match_count: 15,
      p_min_score: 0.45,
    });

    if (rpcError) throw new Error(rpcError.message);
    const chunks = (rawChunks ?? []) as MatchedChunk[];

    // 5. RAG passage selection (Haiku)
    const ragResult = await selectPassages(anthropic, data.query, chunks);
    const selectedChunks = ragResult.passages
      .map((p) => chunks.find((c) => c.chunk_id === p.chunk_id))
      .filter((c): c is MatchedChunk => !!c);

    // 6. Build prompts with memory context and synthesise (Sonnet)
    const l2Suffix = formatPreferencesForL2(preferences, patterns);
    const l3Base = buildL3(data.turnNumber, data.sessionHistory, data.hasSummary);
    const l3 = l3Base + formatMemoriesForL3(episodic);
    const l4 = buildL4(displayName, data.query, selectedChunks, ragResult.coverage_quality);
    const responseText = await synthesize(
      anthropic, displayName, librarianName,
      professionalContext + (l2Suffix ? "\n" + l2Suffix : ""),
      l3, l4,
    );

    // 7. Store nudge
    const { data: nudge } = await supabase
      .from("nudges")
      .insert({
        user_id: userId,
        query_text: data.query,
        themes: [],
        response_text: responseText,
        cache_hit: false,
        tokens_used: null,
        latency_ms: Date.now() - start,
      })
      .select("id")
      .single();

    const nudgeId = (nudge?.id as string) ?? crypto.randomUUID();

    // 8. Store citations
    const citations: Citation[] = ragResult.passages
      .map((p, rank): Citation | null => {
        const chunk = chunks.find((c) => c.chunk_id === p.chunk_id);
        if (!chunk) return null;
        return {
          chunkId: chunk.chunk_id,
          sourceId: chunk.source_id,
          title: chunk.title,
          author: chunk.author,
          url: chunk.url ?? null,
          chapterTitle: chunk.chapter_title,
          relevance: p.relevance_score,
          rank: rank + 1,
        };
      })
      .filter((c): c is Citation => !!c);

    if (nudge && citations.length > 0) {
      await supabase.from("nudge_citations").insert(
        citations.map((c) => ({
          nudge_id: nudgeId,
          chunk_id: c.chunkId,
          source_id: c.sourceId,
          relevance: c.relevance,
          rank: c.rank,
        })),
      );
    }

    // 9. Write memories async (best-effort, non-blocking on response)
    const { count: nudgeCount } = await supabase
      .from("nudges")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .then((r) => ({ count: r.count ?? 0 }));

    await Promise.allSettled([
      writeEpisodicMemory(supabase as SupabaseClient, userId, anthropic, data.query, responseText, citations),
      writeSemanticCache(supabase as SupabaseClient, userId, data.query, embedding, responseText, citations),
      updatePreferencesIfNeeded(supabase as SupabaseClient, userId, anthropic, nudgeCount),
    ]);

    return { response: responseText, citations, nudgeId, coverageQuality: ragResult.coverage_quality };
  });

// ─── Summarise conversation after turn 10 (Haiku) ────────────────────────────

export const summarizeConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ turns: z.array(ConversationTurnSchema).min(1).max(20) }).parse(i),
  )
  .handler(async ({ data }) => {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const turnsText = data.turns
      .map((t) => `${t.role === "user" ? "User" : "Lumen"}: ${t.content}`)
      .join("\n\n");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: [
        {
          type: "text" as const,
          text: "You are a conversation summariser. Produce a compact summary of this conversation using the summarise_conversation tool. Focus on: topics explored, key insights surfaced, unresolved questions. Under 200 tokens.",
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: [
        {
          name: "summarise_conversation",
          description: "Summarise the conversation so far",
          input_schema: {
            type: "object" as const,
            properties: {
              summary: {
                type: "string" as const,
                description: "Compact 1–3 sentence summary of what was discussed and any open threads",
              },
            },
            required: ["summary"],
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: "summarise_conversation" },
      messages: [{ role: "user", content: `Summarise this conversation:\n\n${turnsText}` }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return { summary: "Earlier conversation." };
    return { summary: (toolUse.input as { summary: string }).summary };
  });
