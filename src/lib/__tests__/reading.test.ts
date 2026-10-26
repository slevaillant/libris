import { describe, it, expect } from "vitest";
import { toParagraphs } from "@/lib/reading";

describe("toParagraphs", () => {
  it("keeps existing paragraph breaks", () => {
    expect(toParagraphs("First paragraph.\n\nSecond paragraph.")).toEqual(["First paragraph.", "Second paragraph."]);
  });

  it("splits a flattened run into paragraphs at sentence boundaries", () => {
    const sentence = "Managers should hold regular one-on-ones with each report to surface problems early. ";
    const paragraphs = toParagraphs(sentence.repeat(20));
    expect(paragraphs.length).toBeGreaterThan(2);
    for (const p of paragraphs) {
      expect(p.endsWith(".")).toBe(true);
      expect(p.length).toBeLessThan(700);
    }
    expect(paragraphs.join(" ")).toBe(sentence.repeat(20).trim());
  });

  it("joins single line breaks inside a paragraph and drops soft hyphens", () => {
    expect(toParagraphs("A line broken\nin the middle by the PDF man­agement.")).toEqual([
      "A line broken in the middle by the PDF management.",
    ]);
  });
});
