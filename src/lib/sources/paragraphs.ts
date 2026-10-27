// Paragraph-preserving chunking shared by the PDF and ePub extractors.
// Chunks are built from whole paragraphs (joined by blank lines) so the reader can
// show them as they appear in the book, with their chapter and page.

export type Paragraph = { text: string; chapterTitle: string | null; pageNumber: number | null };
export type TextChunk = { content: string; chapterTitle: string | null; pageNumber: number | null };

const MAX_TOKENS = 600;
const tokens = (t: string) => Math.ceil(t.length / 4);
const SENTENCE_END = /(?<=[.!?…][»"”’)]?)\s+(?=[«"“(]?[A-ZÀ-ÖØ-Þ0-9])/;

/** Split one oversized paragraph at sentence boundaries. */
function splitLong(p: Paragraph): Paragraph[] {
  if (tokens(p.text) <= MAX_TOKENS) return [p];
  const out: Paragraph[] = [];
  let buf = "";
  for (const sentence of p.text.split(SENTENCE_END)) {
    const cand = buf ? `${buf} ${sentence}` : sentence;
    if (tokens(cand) > MAX_TOKENS && buf) {
      out.push({ ...p, text: buf });
      buf = sentence;
    } else buf = cand;
  }
  if (buf) out.push({ ...p, text: buf });
  return out;
}

/** Group paragraphs into ~600-token chunks; a new chapter always starts a new chunk. */
export function chunkParagraphs(paragraphs: Paragraph[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  let parts: Paragraph[] = [];
  const flush = () => {
    if (parts.length === 0) return;
    chunks.push({
      content: parts.map((p) => p.text).join("\n\n"),
      chapterTitle: parts[0].chapterTitle,
      pageNumber: parts[0].pageNumber,
    });
    parts = [];
  };
  for (const para of paragraphs.flatMap(splitLong)) {
    if (!para.text.trim()) continue;
    const size = tokens(parts.map((p) => p.text).join("\n\n")) + tokens(para.text);
    if (parts.length && (size > MAX_TOKENS || para.chapterTitle !== parts[0].chapterTitle)) flush();
    parts.push(para);
  }
  flush();
  return chunks;
}

export type PdfLine = { text: string; y: number; height: number; endsWithHyphen?: boolean };

/**
 * Rebuild paragraphs from a PDF page's text lines (top to bottom).
 * A paragraph ends on a vertical gap clearly larger than the usual line spacing,
 * or on a short line ending a sentence. Line-end hyphenation is undone.
 */
export function linesToParagraphs(lines: PdfLine[]): string[] {
  const clean = lines.filter((l) => l.text.trim());
  if (clean.length === 0) return [];
  const gaps = clean.slice(1).map((l, i) => Math.abs(clean[i].y - l.y)).filter((g) => g > 0).sort((a, b) => a - b);
  const typicalGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const lengths = clean.map((l) => l.text.trim().length).sort((a, b) => a - b);
  const typicalLength = lengths[Math.floor(lengths.length * 0.75)] ?? 0;

  const paragraphs: string[] = [];
  let buf = "";
  clean.forEach((line, i) => {
    const text = line.text.trim();
    if (!buf) buf = text;
    else if (/[A-Za-zÀ-ÿ]-$/.test(buf) && /^[a-zà-ÿ]/.test(text)) buf = buf.slice(0, -1) + text; // hyphenation
    else buf = `${buf} ${text}`;

    const next = clean[i + 1];
    const gap = next ? Math.abs(line.y - next.y) : Infinity;
    const bigGap = typicalGap > 0 && gap > typicalGap * 1.45;
    const shortSentenceEnd = /[.!?:…»"”]$/.test(text) && text.length < typicalLength * 0.7;
    if (!next || bigGap || shortSentenceEnd) {
      paragraphs.push(buf);
      buf = "";
    }
  });
  if (buf) paragraphs.push(buf);
  return paragraphs;
}
