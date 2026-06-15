import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { embedBatch } from "@/lib/gemini";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BountyConfig = {
  id: string;
  userId: string;
  pricePerBook: number;
  currency: string;
  active: boolean;
};

export type IndexingSession = {
  id: string;
  ownerUserId: string;
  indexerUserId: string;
  indexerName: string | null;
  indexerPaymentLink: string | null;
  pricePerBook: number;
  currency: string;
  bookCount: number;
  totalAmount: number;
  startedAt: string;
  endedAt: string | null;
  paid: boolean;
  paidAt: string | null;
};

// ─── Chapter summary helper ───────────────────────────────────────────────────

const CHAPTER_SUMMARY_SYSTEM = `You are a knowledge indexing agent for Libris.
Generate a 100-150 word chapter summary for semantic search.
Cover: the core argument, 2-3 key concepts introduced, the type of reader who benefits, and the problem it solves.
Be specific and accurate. Use the provided tool only.`;

async function generateChapterSummary(
  anthropic: Anthropic,
  bookTitle: string,
  bookAuthor: string,
  chapterTitle: string,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: [{ type: "text" as const, text: CHAPTER_SUMMARY_SYSTEM, cache_control: { type: "ephemeral" as const } }],
    tools: [{
      name: "generate_chapter_summary",
      description: "Generate a chapter summary for semantic indexing",
      input_schema: {
        type: "object" as const,
        properties: { summary: { type: "string" as const, description: "100-150 word summary" } },
        required: ["summary"],
      },
    }],
    tool_choice: { type: "tool" as const, name: "generate_chapter_summary" },
    messages: [{ role: "user", content: `Book: "${bookTitle}" by ${bookAuthor}\nChapter: "${chapterTitle}"` }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return chapterTitle;
  return (toolUse.input as { summary: string }).summary;
}

// ─── Owner: bounty config ─────────────────────────────────────────────────────

export const getBountyConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = supabase as any;
    const { data } = await s.from("bounty_configs").select("*").eq("user_id", userId).maybeSingle();
    if (!data) return null;
    return {
      id: data.id as string,
      userId: data.user_id as string,
      pricePerBook: Number(data.price_per_book),
      currency: data.currency as string,
      active: data.active as boolean,
    } as BountyConfig;
  });

export const upsertBountyConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      pricePerBook: z.number().min(0).max(100),
      currency: z.string().length(3),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = supabase as any;
    const { error } = await s.from("bounty_configs").upsert(
      {
        user_id: userId,
        price_per_book: data.pricePerBook,
        currency: data.currency.toUpperCase(),
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Owner: invite tokens ─────────────────────────────────────────────────────

export const createInviteToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = supabase as any;
    const { data, error } = await s
      .from("indexer_invites")
      .insert({ owner_user_id: userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { tokenId: data.id as string };
  });

// ─── Indexer: payment link ───────────────────────────────────────────────────

export const setIndexerPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ paymentLink: z.string().url().nullable() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = supabase as any;
    const { error } = await s
      .from("indexer_memberships")
      .update({ payment_link: data.paymentLink })
      .eq("indexer_user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Indexer: redeem invite ───────────────────────────────────────────────────

export const redeemInviteToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ token: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ownerUserId, error } = await supabase.rpc("redeem_indexer_invite" as never, {
      p_token: data.token,
      p_user_id: userId,
    } as never);
    if (error) throw new Error(error.message);
    return { ownerUserId: ownerUserId as string };
  });

// ─── Indexer: find owner ──────────────────────────────────────────────────────

export const getOwnerForIndexer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = supabase as any;
    const { data } = await s
      .from("indexer_memberships")
      .select("owner_user_id")
      .eq("indexer_user_id", userId)
      .limit(1)
      .maybeSingle();
    return { ownerUserId: (data?.owner_user_id as string | null) ?? null };
  });

// ─── Indexer: sessions ────────────────────────────────────────────────────────

export const startSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ ownerUserId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = supabase as any;

    const { data: config } = await s
      .from("bounty_configs")
      .select("price_per_book, currency, active")
      .eq("user_id", data.ownerUserId)
      .maybeSingle();

    if (!config?.active) throw new Error("No active bounty for this library");

    const { data: session, error } = await s
      .from("indexing_sessions")
      .insert({
        owner_user_id: data.ownerUserId,
        indexer_user_id: userId,
        price_per_book: config.price_per_book,
        currency: config.currency,
      })
      .select("id, price_per_book, currency")
      .single();

    if (error) throw new Error(error.message);
    return {
      sessionId: session.id as string,
      pricePerBook: Number(session.price_per_book),
      currency: session.currency as string,
    };
  });

export const endSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ sessionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = supabase as any;
    const { data: session, error } = await s
      .from("indexing_sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", data.sessionId)
      .eq("indexer_user_id", userId)
      .select("book_count, price_per_book, currency")
      .single();
    if (error) throw new Error(error.message);
    return {
      bookCount: session.book_count as number,
      totalAmount: Number(session.price_per_book) * (session.book_count as number),
      currency: session.currency as string,
    };
  });

// ─── Indexer: add book (source + chapters + embeddings) ──────────────────────

export const indexerAddBook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      title: z.string().min(1),
      author: z.string().optional(),
      isbn: z.string().optional().nullable(),
      coverUrl: z.string().optional().nullable(),
      shelfLocation: z.string().min(1),
      chapters: z.array(z.string()).default([]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // 1. Create source as the library owner via SECURITY DEFINER RPC
    const { data: sourceId, error: sourceErr } = await supabase.rpc("indexer_create_source" as never, {
      p_session_id:     data.sessionId,
      p_indexer_id:     userId,
      p_title:          data.title,
      p_author:         data.author ?? "",
      p_isbn:           data.isbn ?? null,
      p_cover_url:      data.coverUrl ?? null,
      p_shelf_location: data.shelfLocation,
    } as never);

    if (sourceErr) throw new Error(sourceErr.message);

    // 2. Generate chapter summaries (Haiku, prompt-cached after first call)
    const chapters = data.chapters.slice(0, 20);
    const summaries: string[] = [];
    for (const chapter of chapters) {
      summaries.push(
        await generateChapterSummary(anthropic, data.title, data.author ?? "Unknown", chapter)
          .catch(() => chapter),
      );
    }

    // 3. Embed (non-fatal)
    const embeddings = await embedBatch(summaries).catch(() => summaries.map(() => null));

    // 4. Bulk-insert chunks as owner via RPC
    if (chapters.length > 0) {
      const chunks = chapters.map((chapter, i) => ({
        chunk_index: i,
        content: summaries[i],
        chapter_title: chapter,
        embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
        token_count: Math.ceil(summaries[i].length / 4),
      }));

      const { error: chunksErr } = await supabase.rpc("indexer_create_chunks" as never, {
        p_session_id: data.sessionId,
        p_indexer_id: userId,
        p_source_id:  sourceId,
        p_chunks:     JSON.stringify(chunks),
      } as never);

      if (chunksErr) console.error("[indexerAddBook] chunks RPC error:", chunksErr.message);
    }

    // 5. Increment session counter atomically
    const { data: bookCount } = await supabase.rpc("increment_session_book_count" as never, {
      p_session_id: data.sessionId,
      p_user_id:    userId,
    } as never);

    return { sourceId: sourceId as string, bookCount: (bookCount as number | null) ?? 0 };
  });

// ─── Owner: leaderboard ───────────────────────────────────────────────────────

export const getLeaderboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = supabase as any;

    const { data: sessions, error } = await s
      .from("indexing_sessions")
      .select("id, indexer_user_id, price_per_book, currency, book_count, started_at, ended_at, paid, paid_at")
      .eq("owner_user_id", userId)
      .order("book_count", { ascending: false });

    if (error) throw new Error(error.message);

    const indexerIds = [...new Set((sessions ?? []).map((s2: { indexer_user_id: string }) => s2.indexer_user_id))] as string[];

    const [{ data: profiles }, { data: memberships }] = await Promise.all([
      supabase.from("user_profiles").select("user_id, display_name").in("user_id", indexerIds),
      s.from("indexer_memberships")
        .select("indexer_user_id, payment_link")
        .eq("owner_user_id", userId)
        .in("indexer_user_id", indexerIds),
    ]);

    const nameById = Object.fromEntries(
      (profiles ?? []).map((p) => [p.user_id as string, p.display_name as string | null]),
    );
    const paymentLinkById = Object.fromEntries(
      (memberships ?? []).map((m: { indexer_user_id: string; payment_link: string | null }) =>
        [m.indexer_user_id, m.payment_link ?? null],
      ),
    );

    return (sessions ?? []).map((row: {
      id: string; indexer_user_id: string; price_per_book: number; currency: string;
      book_count: number; started_at: string; ended_at: string | null; paid: boolean; paid_at: string | null;
    }) => ({
      id: row.id,
      ownerUserId: userId,
      indexerUserId: row.indexer_user_id,
      indexerName: nameById[row.indexer_user_id] ?? "Indexer",
      indexerPaymentLink: paymentLinkById[row.indexer_user_id] ?? null,
      pricePerBook: Number(row.price_per_book),
      currency: row.currency,
      bookCount: row.book_count,
      totalAmount: Number(row.price_per_book) * row.book_count,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? null,
      paid: row.paid,
      paidAt: row.paid_at ?? null,
    })) as IndexingSession[];
  });

export const markSessionPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ sessionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = supabase as any;
    const { error } = await s
      .from("indexing_sessions")
      .update({ paid: true, paid_at: new Date().toISOString() })
      .eq("id", data.sessionId)
      .eq("owner_user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
