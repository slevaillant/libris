import * as pdfjsLib from "pdfjs-dist";

export type PdfChunk = {
  content: string;
  pageNumber: number;
};

export type PdfExtractResult = {
  title: string | null;
  author: string | null;
  chunks: PdfChunk[];
  isScanned: boolean;
};

// Token estimate: 1 token ≈ 4 chars
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function extractPdf(file: File): Promise<PdfExtractResult> {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  // Extract document metadata
  const metaResult = await pdf.getMetadata().catch(() => null);
  const info = metaResult?.info as Record<string, unknown> | undefined;
  const title = typeof info?.Title === "string" && info.Title.trim() ? info.Title.trim() : null;
  const author = typeof info?.Author === "string" && info.Author.trim() ? info.Author.trim() : null;

  // Extract text page by page
  let totalTextLength = 0;
  const pages: { text: string; pageNumber: number }[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (text.length > 0) {
      pages.push({ text, pageNumber: i });
      totalTextLength += text.length;
    }
  }

  // Scanned PDF: less than 10 chars per page on average means no extractable text
  if (totalTextLength / pdf.numPages < 10) {
    return { title, author, chunks: [], isScanned: true };
  }

  // Chunk by paragraph, keeping page number of first paragraph in each chunk
  const chunks: PdfChunk[] = [];
  let buffer = "";
  let bufferPage = 1;

  for (const { text, pageNumber } of pages) {
    // Split page text into paragraphs (pdfjs joins lines with spaces; use sentence boundaries as proxy)
    const paragraphs = text
      .split(/(?<=[.!?])\s{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 30);

    for (const para of paragraphs) {
      const candidate = buffer ? `${buffer}\n\n${para}` : para;
      if (estimateTokens(candidate) > 600 && buffer) {
        chunks.push({ content: buffer, pageNumber: bufferPage });
        buffer = para;
        bufferPage = pageNumber;
      } else {
        if (!buffer) bufferPage = pageNumber;
        buffer = candidate;
      }
    }
  }
  if (buffer.trim()) chunks.push({ content: buffer, pageNumber: bufferPage });

  return { title, author, chunks, isScanned: false };
}
