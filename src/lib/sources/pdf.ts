import { chunkParagraphs, linesToParagraphs, type Paragraph, type PdfLine } from "./paragraphs";

type PdfjsLib = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<PdfjsLib["getDocument"]>["promise"]>;

export type PdfChunk = {
  content: string;
  pageNumber: number | null;
  chapterTitle: string | null;
};

export type PdfExtractResult = {
  title: string | null;
  author: string | null;
  chunks: PdfChunk[];
  isScanned: boolean;
  /** Whitespace-collapsed page text, as the previous extractor produced it — used to match re-imports. */
  matchText: string;
};

export async function extractPdf(file: File): Promise<PdfExtractResult> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();

  return extractPdfData(new Uint8Array(await file.arrayBuffer()), pdfjsLib);
}

type TextItem = { str: string; transform: number[]; width: number; height: number };
type Part = { str: string; x: number; w: number };

// Fake bold draws a word's fragments several times over ("vanvanvanishishish"):
// collapse a short fragment repeated 3+ times in a row.
const OVERPRINT = /([^\s\d.\-_=*]{2,6}?)\1{2,}/g;

/** Join a line's fragments in content order, adding a space where there is a visible gap. */
function joinParts(parts: Part[], height: number): string {
  let out = "";
  let end = -Infinity;
  for (const p of parts) {
    const gap = p.x - end;
    if (out && gap > height * 0.15 && !out.endsWith(" ") && !p.str.startsWith(" ")) out += " ";
    out += p.str;
    end = p.x + p.w;
  }
  return out.replace(OVERPRINT, "$1").replace(/\s+/g, " ").trim();
}

/** Group a page's text items into visual lines, top to bottom. */
function pageLines(items: TextItem[]): PdfLine[] {
  const lines: { y: number; height: number; parts: Part[] }[] = [];
  for (const item of items) {
    if (!item.str) continue;
    const [, , , , x, y] = item.transform;
    const line = lines.find((l) => Math.abs(l.y - y) < Math.max(2, item.height * 0.4));
    const part = { str: item.str, x, w: item.width };
    if (line) line.parts.push(part);
    else lines.push({ y, height: item.height, parts: [part] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => ({ text: joinParts(l.parts, l.height), y: l.y, height: l.height }));
}

/**
 * Chapter of each page from the PDF outline (bookmarks): the first outline level
 * with at least 3 entries (a single "Book" root is skipped). Pages are 1-based.
 */
async function chapterByPage(pdf: PdfDocument): Promise<(page: number) => string | null> {
  type OutlineItem = { title: string; dest: unknown; items: OutlineItem[] };
  const outline = ((await pdf.getOutline().catch(() => null)) ?? []) as OutlineItem[];
  let level = outline;
  while (level.length > 0 && level.length < 3 && level.some((i) => i.items?.length)) {
    level = level.flatMap((i) => i.items ?? []);
  }

  // Parts ("Part I", "II Approximate Methods") contain the chapters: use both levels
  const isPart = (t: string) => /^(part|partie)\b|^[IVXLC]+[\s.:]/i.test(t.trim());
  const entries = level.flatMap((i) => (isPart(i.title) ? [i, ...(i.items ?? [])] : [i]));

  const starts: { page: number; title: string }[] = [];
  for (const item of entries) {
    try {
      const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
      const ref = Array.isArray(dest) ? dest[0] : null;
      if (!ref) continue;
      const index = typeof ref === "number" ? ref : await pdf.getPageIndex(ref as Parameters<PdfDocument["getPageIndex"]>[0]);
      starts.push({ page: index + 1, title: item.title.replace(/\s+/g, " ").trim() });
    } catch {
      /* unresolvable bookmark */
    }
  }
  starts.sort((a, b) => a.page - b.page);
  return (page) => {
    let title: string | null = null;
    for (const s of starts) {
      if (s.page > page) break;
      title = s.title;
    }
    return title;
  };
}

/**
 * Same extraction from raw bytes. Outside the browser, pass the Node build:
 * `await import("pdfjs-dist/legacy/build/pdf.mjs")` (see sync/import-pdf.ts).
 */
export async function extractPdfData(data: Uint8Array, pdfjsLib: PdfjsLib): Promise<PdfExtractResult> {
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  const metaResult = await pdf.getMetadata().catch(() => null);
  const info = metaResult?.info as Record<string, unknown> | undefined;
  const title = typeof info?.Title === "string" && info.Title.trim() ? info.Title.trim() : null;
  const author = typeof info?.Author === "string" && info.Author.trim() ? info.Author.trim() : null;

  const chapterOf = await chapterByPage(pdf);
  const paragraphs: Paragraph[] = [];
  const matchParts: string[] = [];
  let totalTextLength = 0;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const items = (await page.getTextContent()).items.filter((it) => "str" in it) as unknown as TextItem[];
    const flat = items.map((it) => it.str).join(" ").replace(/\s{2,}/g, " ").trim();
    if (!flat) continue;
    totalTextLength += flat.length;
    matchParts.push(flat);

    const chapterTitle = chapterOf(i);
    for (const text of linesToParagraphs(pageLines(items))) {
      // Running headers, footers and page numbers are short: drop them
      if (text.length < 30 && !/[.!?:]$/.test(text)) continue;
      paragraphs.push({ text, chapterTitle, pageNumber: i });
    }
  }

  // Scanned PDF: less than 10 chars per page on average means no extractable text
  if (totalTextLength / pdf.numPages < 10) {
    return { title, author, chunks: [], isScanned: true, matchText: "" };
  }

  return {
    title,
    author,
    chunks: chunkParagraphs(paragraphs),
    isScanned: false,
    matchText: matchParts.join(" "),
  };
}
