import { describe, it, expect } from "vitest";
import { buildDigestEmail } from "@/lib/email";

describe("buildDigestEmail — numbered references", () => {
  const { html, text } = buildDigestEmail("Seb", "Lumen", "Week 43", [
    {
      theme: "Choosing an approach",
      synthesis: "Passages [1] and [2] disagree. **Read [2] first this afternoon.**",
      citations: [
        { ref: 1, title: "Article A", author: "Author A", chapterTitle: null, url: "https://example.com/a" },
        { ref: 2, title: "Book B", author: "Author B", chapterTitle: "Chapter 3: Teams", url: "https://app.example/book/b" },
      ],
      readingSuggestion: null,
    },
  ]);

  it("lists every passage with the [n] number used in the paragraph", () => {
    expect(html).toContain("[1]</span>");
    expect(html).toContain("[2]</span>");
    expect(html).toContain("Chapter 3: Teams");
    expect(text).toContain("[2] Book B — Chapter 3: Teams");
  });

  it("renders **bold** as HTML", () => {
    expect(html).toContain("<strong>Read [2] first this afternoon.</strong>");
    expect(html).not.toContain("**");
  });
});
