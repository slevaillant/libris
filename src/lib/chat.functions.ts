import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { embed } from "@/lib/gemini";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConversationTurn = { role: "user" | "assistant"; content: string };

export type Citation = {
  chunkId: string;
  sourceId: string;
  title: string;
  author: string | null;
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

    // 1. Load user profile
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name, librarian_name, professional_context")
      .eq("user_id", userId)
      .maybeSingle();

    const displayName = (profile?.display_name as string) ?? "there";
    const librarianName = (profile?.librarian_name as string) ?? "Lumen";
    const professionalContext = (profile?.professional_context as string | null) ?? null;

    // 2. Embed the query
    const embedding = await embed(data.query);
    if (!embedding) throw new Error("Could not embed your question — please try again.");

    // 3. Semantic search
    const { data: rawChunks, error: rpcError } = await supabase.rpc("match_chunks", {
      p_user_id: userId,
      p_query_embedding: `[${embedding.join(",")}]`,
      p_match_count: 15,
      p_min_score: 0.45,
    });

    if (rpcError) throw new Error(rpcError.message);
    const chunks = (rawChunks ?? []) as MatchedChunk[];

    // 4. RAG passage selection (Haiku)
    const ragResult = await selectPassages(anthropic, data.query, chunks);

    // Map selected chunk IDs back to full chunk objects
    const selectedChunks = ragResult.passages
      .map((p) => chunks.find((c) => c.chunk_id === p.chunk_id))
      .filter((c): c is MatchedChunk => !!c);

    // 5. Build prompts and synthesise (Sonnet)
    const l3 = buildL3(data.turnNumber, data.sessionHistory, data.hasSummary);
    const l4 = buildL4(displayName, data.query, selectedChunks, ragResult.coverage_quality);
    const responseText = await synthesize(anthropic, displayName, librarianName, professionalContext, l3, l4);

    // 6. Store nudge
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

    // 7. Store citations
    const citations: Citation[] = ragResult.passages
      .map((p, rank): Citation | null => {
        const chunk = chunks.find((c) => c.chunk_id === p.chunk_id);
        if (!chunk) return null;
        return {
          chunkId: chunk.chunk_id,
          sourceId: chunk.source_id,
          title: chunk.title,
          author: chunk.author,
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
