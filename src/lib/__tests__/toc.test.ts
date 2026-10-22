import { describe, it, expect } from "vitest";
import { cleanChapterTitles, tocFromEdition } from "@/lib/toc";

describe("cleanChapterTitles", () => {
  it("strips list markers, page numbers and front matter, and dedupes", () => {
    expect(
      cleanChapterTitles([
        "Here is the table of contents of the book:",
        "1. Getting Started ........ 12",
        "- **Getting Started**",
        "Copyright",
        "2) Scaling Teams 45",
        "Index",
      ]),
    ).toEqual(["Getting Started", "Scaling Teams"]);
  });
});

describe("tocFromEdition (Open Library)", () => {
  it("keeps chapter level, reading titles from label when title is a page number", () => {
    const ed = {
      table_of_contents: [
        { level: 1, label: "Preface", title: "10" },
        { level: 2, label: "Who This Book Is For", title: "18" },
        { level: 1, label: "1. Introduction", title: "34" },
        { level: 2, label: "A Section", title: "36" },
        { level: 1, label: "2. Evaluation", title: "90" },
        { level: 1, label: "3. Deployment", title: "150" },
      ],
    };
    expect(tocFromEdition(ed)).toEqual(["Introduction", "Evaluation", "Deployment"]);
  });

  it("goes below a level made only of parts", () => {
    const ed = {
      table_of_contents: [
        { level: 0, title: "Part I. Foundations" },
        { level: 1, title: "Chapter One" },
        { level: 1, title: "Chapter Two" },
        { level: 0, title: "Part II. Practice" },
        { level: 1, title: "Chapter Three" },
        { level: 0, title: "Part III. Beyond" },
        { level: 1, title: "Chapter Four" },
      ],
    };
    expect(tocFromEdition(ed)).toEqual(["Chapter One", "Chapter Two", "Chapter Three", "Chapter Four"]);
  });
});
