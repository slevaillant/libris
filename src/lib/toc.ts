// Finds a book's real table of contents instead of reconstructing it from model memory.
// Order: Open Library (structured TOC) → web search via Gemini + Google Search grounding
// (publisher pages) → model memory, which must return nothing rather than invent chapters.

import type Anthropic from "@anthropic-ai/sdk";

export type TocSource = "screenshot" | "open_library" | "web" | "ai_memory";
export type TocResult = { chapters: string[]; source: TocSource; sourceUrl: string | null };
export type BookRef = { title: string; author?: string | null; isbn?: string | null };

const MIN_CHAPTERS = 3;
const MAX_CHAPTERS = 40;

// Front/back matter that carries no searchable knowledge
const NON_CHAPTER = /^(table of )?contents$|^copyright|^index$|^about the authors?$|^acknowledg|^dedication$|^colophon$|^also by |^praise for |^preface$|^foreword$|^cover$|flyleaf|^title page|imprint$|^quotations$/i;
// Chatter around a list ("Here is the table of contents:"), not a chapter
const NOT_A_TITLE = /table of contents|:\s*$/i;

/** Normalise raw chapter titles: strip numbering artefacts and page numbers, drop matter, dedupe. */
export function cleanChapterTitles(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = r
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "") // list markers ("1. ", "- ")
      .replace(/\*\*/g, "")
      .replace(/[\s.·…]+\d+\s*$/, "") // trailing page numbers / leader dots
      .replace(/\s+/g, " ")
      .trim();
    if (t.length < 2 || t.length > 150 || NON_CHAPTER.test(t) || NOT_A_TITLE.test(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.slice(0, MAX_CHAPTERS);
}

// ─── Open Library ─────────────────────────────────────────────────────────────

type OlEdition = { table_of_contents?: { level?: number; title?: string; label?: string }[] };

async function olJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { "User-Agent": "Libris (personal knowledge base)" } }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

/**
 * Open Library TOCs mix parts, chapters and sections (by `level`), and sometimes put the title
 * in `label` and the page number in `title`. Keep the first level made of real chapters.
 */
export function tocFromEdition(ed: OlEdition | null): string[] {
  const entries = (ed?.table_of_contents ?? [])
    .map((e) => ({
      level: e.level ?? 0,
      text: [e.label, e.title].filter((p) => p && !/^\s*[\dxivlc]+\s*$/i.test(p)).join(" ").trim(),
    }))
    .filter((e) => e.text);
  const levels = [...new Set(entries.map((e) => e.level))].sort((a, b) => a - b);
  for (const level of levels) {
    const titles = entries.filter((e) => e.level === level).map((e) => e.text);
    const onlyParts = titles.every((t) => /^part\b/i.test(t));
    const chapters = cleanChapterTitles(titles);
    if (chapters.length >= MIN_CHAPTERS && !onlyParts) return chapters;
  }
  return [];
}

export async function findOpenLibraryToc(book: BookRef): Promise<TocResult | null> {
  const isbn = book.isbn?.replace(/[^0-9X]/gi, "");
  if (isbn) {
    const chapters = tocFromEdition(await olJson<OlEdition>(`https://openlibrary.org/isbn/${isbn}.json`));
    if (chapters.length >= MIN_CHAPTERS) {
      return { chapters, source: "open_library", sourceUrl: `https://openlibrary.org/isbn/${isbn}` };
    }
  }

  const q = new URLSearchParams({ title: book.title, fields: "edition_key", limit: "1" });
  if (book.author) q.set("author", book.author);
  const search = await olJson<{ docs?: { edition_key?: string[] }[] }>(`https://openlibrary.org/search.json?${q}`);
  for (const key of (search?.docs?.[0]?.edition_key ?? []).slice(0, 5)) {
    const chapters = tocFromEdition(await olJson<OlEdition>(`https://openlibrary.org/books/${key}.json`));
    if (chapters.length >= MIN_CHAPTERS) {
      return { chapters, source: "open_library", sourceUrl: `https://openlibrary.org/books/${key}` };
    }
  }
  return null;
}

// ─── Web search (Gemini + Google Search grounding) ───────────────────────────

type GeminiGrounded = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
};

export async function findWebToc(book: BookRef, geminiApiKey: string): Promise<TocResult | null> {
  const prompt = `Find the published table of contents of the book "${book.title}"${book.author ? ` by ${book.author}` : ""}.
Use the publisher's page or another reliable listing of this exact book.
Reply with the chapter titles only, one per line, in book order, exactly as published — no summaries, no page numbers, no commentary.
If you cannot find a published table of contents for this exact book, reply with exactly: NOT_FOUND`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ googleSearch: {} }] }),
    },
  ).catch(() => null);
  if (!res?.ok) {
    console.error(`[toc] web search failed: ${res ? `HTTP ${res.status}` : "network error"}`);
    return null;
  }

  const data = (await res.json()) as GeminiGrounded;
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("\n").trim();
  const sources = (candidate?.groundingMetadata?.groundingChunks ?? []).filter((c) => c.web?.uri);
  // Without grounding sources the answer came from memory, not the web: reject it
  if (!text || text.includes("NOT_FOUND") || sources.length === 0) return null;

  const chapters = cleanChapterTitles(text.split("\n"));
  if (chapters.length < MIN_CHAPTERS) return null;
  return { chapters, source: "web", sourceUrl: sources[0].web?.uri ?? null };
}

// ─── Model memory (last resort — must not invent) ─────────────────────────────

export async function recallTocFromMemory(anthropic: Anthropic, book: BookRef): Promise<TocResult | null> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: [
      {
        type: "text" as const,
        text: "You are a book knowledge agent. List a book's actual chapters only if you know them reliably. If you are not sure of the exact chapters, return an empty array — never invent plausible chapter titles.",
        cache_control: { type: "ephemeral" as const },
      },
    ],
    tools: [
      {
        name: "suggest_chapters",
        description: "List the chapters of a known book, or an empty array if unsure",
        input_schema: {
          type: "object" as const,
          properties: { chapters: { type: "array" as const, items: { type: "string" as const } } },
          required: ["chapters"],
        },
      },
    ],
    tool_choice: { type: "tool" as const, name: "suggest_chapters" },
    messages: [{ role: "user", content: `Book: "${book.title}"${book.author ? ` by ${book.author}` : ""}. List the chapters.` }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  const chapters = cleanChapterTitles(
    toolUse && toolUse.type === "tool_use" ? (toolUse.input as { chapters: string[] }).chapters : [],
  );
  return chapters.length >= MIN_CHAPTERS ? { chapters, source: "ai_memory", sourceUrl: null } : null;
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/** Drop entries that just repeat the book's own title (listings often start with it). */
export function withoutBookTitle(toc: TocResult | null, bookTitle: string): TocResult | null {
  if (!toc) return null;
  const main = bookTitle.split(":")[0].trim().toLowerCase();
  const chapters = toc.chapters.filter((c) => {
    const t = c.toLowerCase();
    return t !== bookTitle.toLowerCase() && t !== main && !t.startsWith(`${main}:`);
  });
  return chapters.length >= MIN_CHAPTERS ? { ...toc, chapters } : null;
}

export async function findTableOfContents(
  book: BookRef,
  { anthropic, geminiApiKey, allowMemory = true }: { anthropic: Anthropic; geminiApiKey?: string; allowMemory?: boolean },
): Promise<TocResult | null> {
  const fromOpenLibrary = withoutBookTitle(await findOpenLibraryToc(book).catch(() => null), book.title);
  if (fromOpenLibrary) return fromOpenLibrary;
  if (geminiApiKey) {
    const fromWeb = withoutBookTitle(await findWebToc(book, geminiApiKey).catch(() => null), book.title);
    if (fromWeb) return fromWeb;
  }
  return allowMemory ? withoutBookTitle(await recallTocFromMemory(anthropic, book).catch(() => null), book.title) : null;
}
