import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { embedBatch } from "@/lib/gemini";

// ─── Shared types ─────────────────────────────────────────────────────────────

export type BookCandidate = {
  googleBooksId: string;
  title: string;
  authors: string[];
  isbn: string | null;
  description: string | null;
  coverUrl: string | null;
  publishedDate: string | null;
};

export type SourceRow = {
  id: string;
  sourceType: string;
  title: string;
  author: string | null;
  isbn: string | null;
  coverUrl: string | null;
  description: string | null;
  totalChunks: number;
  ingestStatus: string;
  createdAt: string;
};

export type ChunkRow = {
  id: string;
  chunkIndex: number;
  chapterTitle: string | null;
  content: string;
  chunkType: string;
};

// ─── Extract book metadata from cover image (Haiku vision) ───────────────────

export const extractBookFromCover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        imageBase64: z.string(),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: [
        {
          type: "text" as const,
          text: "You are a book metadata extraction agent. Extract book details from cover images using the provided tool. Only include what is clearly visible.",
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: [
        {
          name: "extract_book_metadata",
          description: "Extract book metadata visible on the cover",
          input_schema: {
            type: "object" as const,
            properties: {
              title: { type: "string" as const, description: "Book title" },
              author: { type: "string" as const, description: "Author name(s)" },
              isbn: { type: "string" as const, description: "ISBN if visible, otherwise omit" },
            },
            required: ["title", "author"],
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: "extract_book_metadata" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: data.mimeType,
                data: data.imageBase64,
              },
            },
            { type: "text" as const, text: "Extract the book title and author from this cover." },
          ],
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("Could not extract book metadata");

    const input = toolUse.input as { title: string; author: string; isbn?: string };
    return { title: input.title, author: input.author, isbn: input.isbn ?? null };
  });

// ─── Google Books lookup ──────────────────────────────────────────────────────

export const lookupBook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ query: z.string().min(2) }).parse(i))
  .handler(async ({ data }) => {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(data.query)}&maxResults=5&printType=books`;
    const res = await fetch(url);
    if (!res.ok) return [] as BookCandidate[];

    const json = (await res.json()) as {
      items?: {
        id: string;
        volumeInfo: {
          title: string;
          authors?: string[];
          description?: string;
          publishedDate?: string;
          imageLinks?: { thumbnail?: string };
          industryIdentifiers?: { type: string; identifier: string }[];
        };
      }[];
    };

    return (json.items ?? []).map((item): BookCandidate => {
      const v = item.volumeInfo;
      const isbn =
        v.industryIdentifiers?.find((id) => id.type === "ISBN_13")?.identifier ??
        v.industryIdentifiers?.find((id) => id.type === "ISBN_10")?.identifier ??
        null;
      return {
        googleBooksId: item.id,
        title: v.title,
        authors: v.authors ?? [],
        isbn,
        description: v.description ?? null,
        coverUrl: v.imageLinks?.thumbnail?.replace("http://", "https://") ?? null,
        publishedDate: v.publishedDate ?? null,
      };
    });
  });

// ─── Suggest chapters for a book (Haiku) ─────────────────────────────────────

export const suggestChapters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ title: z.string(), author: z.string() }).parse(i),
  )
  .handler(async ({ data }) => {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: [
        {
          type: "text" as const,
          text: "You are a book knowledge agent. List a book's actual chapters using your training knowledge. If you don't know the exact chapters, return an empty array.",
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: [
        {
          name: "suggest_chapters",
          description: "List the chapters of a known book",
          input_schema: {
            type: "object" as const,
            properties: {
              chapters: {
                type: "array" as const,
                items: { type: "string" as const },
                description: "Chapter titles in order",
              },
            },
            required: ["chapters"],
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: "suggest_chapters" },
      messages: [
        {
          role: "user",
          content: `Book: "${data.title}" by ${data.author}. List the chapters.`,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return [] as string[];
    return (toolUse.input as { chapters: string[] }).chapters;
  });

// ─── Generate a single chapter summary (Haiku, prompt-cached) ────────────────

const CHAPTER_SUMMARY_SYSTEM = `You are a knowledge indexing agent for Libris.
Generate a 100-150 word chapter summary for semantic search.
Cover: the core argument, 2-3 key concepts introduced, the type of reader who benefits, and the problem it solves.
Be specific and accurate. Use the provided tool only.`;

const CHAPTER_SUMMARY_TOOL = {
  name: "generate_chapter_summary" as const,
  description: "Generate a chapter summary for semantic indexing",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string" as const,
        description: "100-150 word summary of this chapter",
      },
    },
    required: ["summary"],
  },
};

async function generateChapterSummary(
  anthropic: Anthropic,
  bookTitle: string,
  bookAuthor: string,
  chapterTitle: string,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: [
      {
        type: "text" as const,
        text: CHAPTER_SUMMARY_SYSTEM,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    tools: [CHAPTER_SUMMARY_TOOL],
    tool_choice: { type: "tool" as const, name: "generate_chapter_summary" },
    messages: [
      {
        role: "user",
        content: `Book: "${bookTitle}" by ${bookAuthor}\nChapter: "${chapterTitle}"`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return chapterTitle;
  return (toolUse.input as { summary: string }).summary;
}

// ─── Add physical book (create source + ingest synchronously) ─────────────────

export const addPhysicalBook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        title: z.string().min(1),
        author: z.string().optional(),
        isbn: z.string().optional(),
        coverUrl: z.string().optional(),
        description: z.string().optional(),
        shelfLocation: z.string().optional(),
        chapters: z.array(z.string()).min(1, "Add at least one chapter"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // 1. Create source (processing)
    const { data: source, error: sourceErr } = await supabase
      .from("sources")
      .insert({
        user_id: userId,
        source_type: "physical_book",
        title: data.title,
        author: data.author ?? null,
        isbn: data.isbn ?? null,
        cover_url: data.coverUrl ?? null,
        description: data.description ?? null,
        shelf_location: data.shelfLocation ?? null,
        ingest_status: "processing",
        authority_tier: 3,
      })
      .select("id")
      .single();

    if (sourceErr || !source) throw new Error(sourceErr?.message ?? "Failed to create source");

    try {
      // 2. Generate chapter summaries sequentially (prompt cache warms after first call)
      const summaries: string[] = [];
      for (const chapter of data.chapters) {
        summaries.push(
          await generateChapterSummary(anthropic, data.title, data.author ?? "Unknown", chapter),
        );
      }

      // 3. Embed all summaries in one Gemini batch
      const embeddings = await embedBatch(summaries);

      // 4. Insert chunks
      const chunkRows = data.chapters.map((chapter, i) => ({
        source_id: source.id,
        user_id: userId,
        chunk_index: i,
        content: summaries[i],
        chapter_title: chapter,
        chunk_type: "chapter_summary",
        embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
        indexed_at: new Date().toISOString(),
        token_count: Math.ceil(summaries[i].length / 4),
      }));

      const { error: chunksErr } = await supabase.from("chunks").insert(chunkRows);
      if (chunksErr) throw new Error(chunksErr.message);

      // 5. Mark complete
      await supabase
        .from("sources")
        .update({
          ingest_status: "complete",
          total_chunks: data.chapters.length,
          last_ingested: new Date().toISOString(),
        })
        .eq("id", source.id);

      return { sourceId: source.id };
    } catch (err) {
      await supabase
        .from("sources")
        .update({ ingest_status: "failed", ingest_error: String(err) })
        .eq("id", source.id);
      throw err;
    }
  });

// ─── List all sources for user ────────────────────────────────────────────────

export const listSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("sources")
      .select(
        "id, source_type, title, author, isbn, cover_url, description, total_chunks, ingest_status, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return (data ?? []).map(
      (s): SourceRow => ({
        id: s.id,
        sourceType: s.source_type,
        title: s.title,
        author: s.author,
        isbn: s.isbn,
        coverUrl: s.cover_url,
        description: s.description,
        totalChunks: s.total_chunks,
        ingestStatus: s.ingest_status,
        createdAt: s.created_at,
      }),
    );
  });

// ─── Get single source with its chunks ───────────────────────────────────────

export const getSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ sourceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: source, error } = await supabase
      .from("sources")
      .select("*")
      .eq("id", data.sourceId)
      .eq("user_id", userId)
      .single();

    if (error || !source) throw new Error("Source not found");

    const { data: chunks } = await supabase
      .from("chunks")
      .select("id, chunk_index, chapter_title, content, chunk_type")
      .eq("source_id", data.sourceId)
      .order("chunk_index", { ascending: true });

    return {
      source: {
        id: source.id,
        sourceType: source.source_type,
        title: source.title,
        author: source.author as string | null,
        isbn: source.isbn as string | null,
        coverUrl: source.cover_url as string | null,
        description: source.description as string | null,
        shelfLocation: source.shelf_location as string | null,
        totalChunks: source.total_chunks,
        ingestStatus: source.ingest_status,
        ingestError: source.ingest_error as string | null,
        isRead: source.is_read as boolean,
        tags: source.tags as string[],
        createdAt: source.created_at,
      },
      chunks: (chunks ?? []).map(
        (c): ChunkRow => ({
          id: c.id,
          chunkIndex: c.chunk_index,
          chapterTitle: c.chapter_title,
          content: c.content,
          chunkType: c.chunk_type,
        }),
      ),
    };
  });
