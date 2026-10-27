import { describe, it, expect } from "vitest";
import { chunkParagraphs, linesToParagraphs, type Paragraph } from "@/lib/sources/paragraphs";

const para = (text: string, chapterTitle: string | null = "Ch 1", pageNumber: number | null = 1): Paragraph => ({ text, chapterTitle, pageNumber });

describe("chunkParagraphs", () => {
  it("keeps paragraphs whole, separated by blank lines", () => {
    const chunks = chunkParagraphs([para("First paragraph."), para("Second paragraph.")]);
    expect(chunks).toEqual([{ content: "First paragraph.\n\nSecond paragraph.", chapterTitle: "Ch 1", pageNumber: 1 }]);
  });

  it("starts a new chunk at each chapter and keeps the first page of each chunk", () => {
    const chunks = chunkParagraphs([para("A.", "Ch 1", 3), para("B.", "Ch 2", 9), para("C.", "Ch 2", 10)]);
    expect(chunks.map((c) => [c.chapterTitle, c.pageNumber, c.content])).toEqual([
      ["Ch 1", 3, "A."],
      ["Ch 2", 9, "B.\n\nC."],
    ]);
  });

  it("caps chunk size and splits oversized paragraphs at sentences", () => {
    const long = "This sentence is about thirty-nine chars. ".repeat(150);
    const chunks = chunkParagraphs([para(long)]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(2600);
  });
});

describe("linesToParagraphs", () => {
  it("joins wrapped lines, breaks on larger gaps and undoes hyphenation", () => {
    const lines = [
      { text: "Managers should hold regular one-on-ones with each of their direct", y: 700, height: 10 },
      { text: "reports to surface problems early and build man-", y: 688, height: 10 },
      { text: "agement trust over time.", y: 676, height: 10 },
      { text: "A second paragraph starts after a visible gap in the page layout and", y: 650, height: 10 },
      { text: "continues on this line.", y: 638, height: 10 },
    ];
    expect(linesToParagraphs(lines)).toEqual([
      "Managers should hold regular one-on-ones with each of their direct reports to surface problems early and build management trust over time.",
      "A second paragraph starts after a visible gap in the page layout and continues on this line.",
    ]);
  });
});
