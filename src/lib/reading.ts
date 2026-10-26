// Turns an indexed passage back into readable paragraphs. Extraction flattened most
// ebook text into one long run (no line breaks), so long runs are re-split into
// paragraphs of a few sentences.

const SENTENCE_END = /(?<=[.!?…][»"”’)]?)\s+(?=[«"“(]?[A-ZÀ-ÖØ-Þ0-9])/;
const TARGET_CHARS = 450;

export function toParagraphs(text: string): string[] {
  const blocks = text
    .replace(/­/g, "") // soft hyphens
    .replace(/[ \t]+/g, " ")
    .split(/\n{2,}|\n(?=\s*[•\-–]\s)/)
    .map((b) => b.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

  const paragraphs: string[] = [];
  for (const block of blocks) {
    if (block.length <= TARGET_CHARS * 1.5) {
      paragraphs.push(block);
      continue;
    }
    let current = "";
    for (const sentence of block.split(SENTENCE_END)) {
      current = current ? `${current} ${sentence}` : sentence;
      if (current.length >= TARGET_CHARS) {
        paragraphs.push(current);
        current = "";
      }
    }
    if (current) paragraphs.push(current);
  }
  return paragraphs;
}
