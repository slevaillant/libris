import { describe, it, expect } from "vitest";
import { buildWeeklyDigestEmail, briefToText, type TopicBrief } from "@/lib/weekly-email";

const brief: TopicBrief = {
  theme: "Choosing between two delivery approaches",
  takeaway: "Pick the approach whose risks you can measure early.",
  ideas: [
    { text: "Small reversible experiments reveal hidden costs before full commitment.", refs: [2, 3] },
    { text: "Teams that own outcomes adapt faster to surprises.", refs: [1] },
  ],
  tension: "Sources disagree on how much upfront design is worth.",
  readFirst: { ref: 2, why: "The clearest test to run before deciding." },
  references: [
    { ref: 1, title: "Article A", author: "Author A", chapterTitle: null, url: "https://example.com/a", why: "Case study of an outcome-owning team." },
    { ref: 2, title: "Book <B>", author: "Author B", chapterTitle: "Ch. 3", url: "https://app.example/book/b", why: "Diagnostic questions to run first." },
  ],
};

describe("buildWeeklyDigestEmail", () => {
  const { html, text, subject } = buildWeeklyDigestEmail("Seb", "Lumen", "Week 44", [brief], { quizUrl: "https://app.example/quiz/1" });

  it("opens with this afternoon's reading list, then the quiz", () => {
    const list = html.indexOf("This afternoon");
    expect(list).toBeGreaterThan(-1);
    expect(html.indexOf("The clearest test")).toBeGreaterThan(list);
    expect(html.indexOf("quiz →")).toBeGreaterThan(list);
    expect(html.indexOf("quiz →")).toBeLessThan(html.indexOf(brief.theme, html.indexOf("quiz →")));
    expect(subject).toBe("Friday deep-dive — Week 44");
  });

  it("renders ideas as bullets with their [n] refs and a why line per source", () => {
    expect(html).toContain("<li");
    expect(html).toContain("[2][3]");
    expect(html).toContain("Diagnostic questions to run first.");
  });

  it("escapes model and title text", () => {
    expect(html).toContain("Book &lt;B&gt;");
    expect(html).not.toContain("Book <B>");
  });

  it("has a readable text version", () => {
    expect(text).toContain("THIS AFTERNOON — READ THESE");
    expect(text).toContain("- Small reversible experiments reveal hidden costs before full commitment. [2][3]");
  });
});

describe("buildWeeklyDigestEmail — tech radar", () => {
  const radar = {
    title: "Situational <Awareness>",
    author: "An Author",
    chapterTitle: null,
    url: "https://app.example/book/x?passage=y",
    why: "The clearest map of the decade ahead for anyone shipping software.",
  };
  const { html, text } = buildWeeklyDigestEmail("Seb", "Lumen", "Week 44", [brief], { radar });

  it("renders the Beyond this week block after the topics, escaped", () => {
    expect(html.indexOf("Beyond this week")).toBeGreaterThan(html.indexOf(brief.theme));
    expect(html).toContain("Situational &lt;Awareness&gt;");
    expect(html).toContain("The clearest map of the decade ahead");
    expect(text).toContain("BEYOND THIS WEEK");
  });

  it("is absent when no radar pick is given", () => {
    expect(buildWeeklyDigestEmail("Seb", "Lumen", "W", [brief], {}).html).not.toContain("Beyond this week");
  });
});

describe("briefToText", () => {
  it("keeps takeaway, bullets and tension for the quiz", () => {
    expect(briefToText(brief).split("\n")).toHaveLength(4);
  });
});
