import { describe, it, expect } from "vitest";

// ── Token counting ────────────────────────────────────────────────────
// Rough estimate: 1 token ≈ 4 characters (English prose)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function exceedsTokenLimit(text: string, limit = 600): boolean {
  return estimateTokens(text) > limit;
}

// ── Chunk splitting ───────────────────────────────────────────────────
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function chunkByParagraph(text: string, maxTokens = 600): string[] {
  const paragraphs = splitIntoParagraphs(text);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (exceedsTokenLimit(candidate, maxTokens) && current) {
      chunks.push(current);
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ── Source type detection ─────────────────────────────────────────────
type SourceType = "physical_book" | "ebook" | "pdf" | "substack" | "github_repo" | "web_article";

function detectSourceType(url: string): SourceType | null {
  if (url.includes(".substack.com")) return "substack";
  if (url.includes("github.com")) return "github_repo";
  if (url.endsWith(".pdf")) return "pdf";
  if (url.endsWith(".epub")) return "ebook";
  if (url.startsWith("http")) return "web_article";
  return null;
}

// ── Authority tier ────────────────────────────────────────────────────
type ChunkType = "highlight" | "passage" | "chapter_summary" | "key_idea";

function authorityTierForChunkType(chunkType: ChunkType): number {
  const tiers: Record<ChunkType, number> = {
    highlight: 1,
    passage: 2,
    key_idea: 2,
    chapter_summary: 5,
  };
  return tiers[chunkType];
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("estimates tokens for a short sentence", () => {
    expect(estimateTokens("Hello world")).toBe(3);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("flags text over 600 token limit", () => {
    const longText = "a".repeat(2401); // 2401 / 4 = 601 tokens
    expect(exceedsTokenLimit(longText)).toBe(true);
  });

  it("does not flag text under 600 token limit", () => {
    const shortText = "a".repeat(100);
    expect(exceedsTokenLimit(shortText)).toBe(false);
  });
});

describe("splitIntoParagraphs", () => {
  it("splits on double newlines", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    expect(splitIntoParagraphs(text)).toHaveLength(2);
  });

  it("trims whitespace from paragraphs", () => {
    const text = "  First.  \n\n  Second.  ";
    const result = splitIntoParagraphs(text);
    expect(result[0]).toBe("First.");
    expect(result[1]).toBe("Second.");
  });

  it("filters empty paragraphs", () => {
    const text = "First.\n\n\n\nSecond.";
    expect(splitIntoParagraphs(text)).toHaveLength(2);
  });
});

describe("chunkByParagraph", () => {
  it("keeps short text as a single chunk", () => {
    const text = "Short paragraph.\n\nAnother short one.";
    expect(chunkByParagraph(text)).toHaveLength(1);
  });

  it("splits when combined text exceeds token limit", () => {
    const longPara = "word ".repeat(300); // ~375 tokens each
    const text = `${longPara}\n\n${longPara}`;
    const chunks = chunkByParagraph(text, 600);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("never produces a chunk exceeding the token limit", () => {
    const longPara = "word ".repeat(300);
    const text = `${longPara}\n\n${longPara}\n\n${longPara}`;
    const chunks = chunkByParagraph(text, 600);
    for (const chunk of chunks) {
      expect(exceedsTokenLimit(chunk, 600)).toBe(false);
    }
  });
});

describe("detectSourceType", () => {
  it("detects substack URLs", () => {
    expect(detectSourceType("https://lenny.substack.com/p/article")).toBe("substack");
  });

  it("detects github URLs", () => {
    expect(detectSourceType("https://github.com/anthropics/anthropic-cookbook")).toBe("github_repo");
  });

  it("detects PDF files", () => {
    expect(detectSourceType("https://example.com/report.pdf")).toBe("pdf");
  });

  it("detects web articles", () => {
    expect(detectSourceType("https://example.com/article")).toBe("web_article");
  });

  it("returns null for unknown sources", () => {
    expect(detectSourceType("not-a-url")).toBeNull();
  });
});

describe("authorityTierForChunkType", () => {
  it("gives highlights the highest authority (tier 1)", () => {
    expect(authorityTierForChunkType("highlight")).toBe(1);
  });

  it("gives chapter summaries the lowest authority (tier 5)", () => {
    expect(authorityTierForChunkType("chapter_summary")).toBe(5);
  });

  it("highlights outrank chapter summaries", () => {
    expect(authorityTierForChunkType("highlight")).toBeLessThan(
      authorityTierForChunkType("chapter_summary"),
    );
  });
});
