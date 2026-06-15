import { describe, it, expect } from "vitest";
import { parseTopicsFromMd, parseTopicTitlesFromMd } from "@/lib/digest.functions";

// ── TOPICS.md parser ──────────────────────────────────────────────────

const LEGACY_TOPICS_MD = `
# TOPICS

## À approfondir

<!-- TOPICS_START -->
- [ ] 2026-06-10 | #delegation-frameworks | _source : Alice / Bob_
- [ ] 2026-06-10 | #technical-debt-prioritization | _source : Alice / Carol_
- [x] 2026-06-09 | #already-explored | _source : Team_

---

## Explorés

<!-- TOPICS_DONE -->
- [x] 2026-06-08 | #done-topic | _source : Dave_
`;

const NEW_FORMAT_TOPICS_MD = `
# TOPICS

<!-- TOPICS_START -->
- [ ] 2026-06-11 | **AI agent design** | _source : Reading_
  > **Question à explorer :** How should an AI agent decide when to delegate to a sub-agent vs handle a task inline?

- [ ] 2026-06-11 | **Delegation frameworks** | _source : Meeting_
  > **Question à explorer :** What criteria should guide when a manager delegates authority vs stays involved?

- [x] 2026-06-10 | **Already done** | _source : Reading_
  > **Question à explorer :** This should not appear.

<!-- TOPICS_DONE -->
`;

const MIXED_MD = `
<!-- TOPICS_START -->
- [ ] 2026-06-11 | **New format topic** | _source : Reading_
  > **Question à explorer :** What is the core insight?

- [ ] 2026-06-10 | #legacy-topic | _source : Meeting_
- [x] 2026-06-09 | #should-be-excluded | _source : Note_
<!-- TOPICS_DONE -->
`;

const EMPTY_MD = `
<!-- TOPICS_START -->
<!-- TOPICS_DONE -->
`;

const NO_MARKERS_MD = `
- [ ] 2026-06-10 | #no-markers-topic | _source : Test_
- [x] 2026-06-09 | #checked-topic | _source : Test_
`;

describe("parseTopicsFromMd — legacy format", () => {
  it("extracts unchecked hashtag topics", () => {
    const topics = parseTopicsFromMd(LEGACY_TOPICS_MD);
    expect(topics).toContain("delegation frameworks");
    expect(topics).toContain("technical debt prioritization");
  });

  it("excludes checked topics", () => {
    const topics = parseTopicsFromMd(LEGACY_TOPICS_MD);
    expect(topics).not.toContain("already explored");
    expect(topics).not.toContain("done topic");
  });

  it("strips the leading # and converts hyphens to spaces", () => {
    const topics = parseTopicsFromMd(LEGACY_TOPICS_MD);
    expect(topics.every((t) => !t.startsWith("#"))).toBe(true);
    expect(topics.every((t) => !t.includes("-"))).toBe(true);
  });
});

describe("parseTopicsFromMd — new format", () => {
  it("returns the Question à explorer text, not the bold title", () => {
    const topics = parseTopicsFromMd(NEW_FORMAT_TOPICS_MD);
    expect(topics).toContain(
      "How should an AI agent decide when to delegate to a sub-agent vs handle a task inline?",
    );
    expect(topics).toContain(
      "What criteria should guide when a manager delegates authority vs stays involved?",
    );
  });

  it("excludes checked items in new format", () => {
    const topics = parseTopicsFromMd(NEW_FORMAT_TOPICS_MD);
    expect(topics).not.toContain("This should not appear.");
    expect(topics.length).toBe(2);
  });

  it("falls back to bold title when no Question line is present", () => {
    const md = `<!-- TOPICS_START -->\n- [ ] 2026-06-11 | **No question line** | _source_\n<!-- TOPICS_DONE -->`;
    const topics = parseTopicsFromMd(md);
    expect(topics).toContain("No question line");
  });
});

describe("parseTopicsFromMd — mixed and edge cases", () => {
  it("handles mixed new + legacy format in the same file", () => {
    const topics = parseTopicsFromMd(MIXED_MD);
    expect(topics).toContain("What is the core insight?");
    expect(topics).toContain("legacy topic");
    expect(topics).not.toContain("should be excluded");
  });

  it("returns empty array when no active topics", () => {
    expect(parseTopicsFromMd(EMPTY_MD)).toEqual([]);
  });

  it("falls back to full doc when TOPICS_START marker is absent", () => {
    const topics = parseTopicsFromMd(NO_MARKERS_MD);
    expect(topics).toContain("no markers topic");
    expect(topics).not.toContain("checked topic");
  });

  it("caps output at 8 topics", () => {
    const lines = Array.from(
      { length: 12 },
      (_, i) => `- [ ] 2026-06-10 | #topic-${i} | _source_`,
    ).join("\n");
    const md = `<!-- TOPICS_START -->\n${lines}\n<!-- TOPICS_DONE -->`;
    expect(parseTopicsFromMd(md).length).toBe(8);
  });
});

describe("parseTopicTitlesFromMd", () => {
  it("returns bold titles for new format (not the question text)", () => {
    const titles = parseTopicTitlesFromMd(NEW_FORMAT_TOPICS_MD);
    expect(titles).toContain("AI agent design");
    expect(titles).toContain("Delegation frameworks");
    expect(titles).not.toContain("How should an AI agent");
  });

  it("returns cleaned hashtags for legacy format", () => {
    const titles = parseTopicTitlesFromMd(LEGACY_TOPICS_MD);
    expect(titles).toContain("delegation frameworks");
    expect(titles).toContain("technical debt prioritization");
  });

  it("excludes checked items", () => {
    const titles = parseTopicTitlesFromMd(LEGACY_TOPICS_MD);
    expect(titles).not.toContain("already explored");
  });

  it("aligns with parseTopicsFromMd length for new format", () => {
    const topics = parseTopicsFromMd(NEW_FORMAT_TOPICS_MD);
    const titles = parseTopicTitlesFromMd(NEW_FORMAT_TOPICS_MD);
    expect(topics.length).toBe(titles.length);
  });

  it("caps output at 8 titles", () => {
    const lines = Array.from(
      { length: 12 },
      (_, i) => `- [ ] 2026-06-10 | **Title ${i}** | _source_`,
    ).join("\n");
    const md = `<!-- TOPICS_START -->\n${lines}\n<!-- TOPICS_DONE -->`;
    expect(parseTopicTitlesFromMd(md).length).toBe(8);
  });
});

// ── Quiz option builder (pure logic extracted from quiz.functions.ts) ──

const OPTION_IDS = ["a", "b", "c", "d"];

function buildOptions(rawOptions: string[]): { id: string; text: string }[] {
  return rawOptions.map((text, i) => ({ id: OPTION_IDS[i], text }));
}

function clampCorrectIndex(rawIndex: number): string {
  return OPTION_IDS[Math.max(0, Math.min(3, rawIndex))];
}

describe("quiz option builder", () => {
  it("assigns ids a, b, c, d to 4 options", () => {
    const options = buildOptions(["Option 1", "Option 2", "Option 3", "Option 4"]);
    expect(options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("preserves option text exactly", () => {
    const options = buildOptions(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(options.map((o) => o.text)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
  });
});

describe("clampCorrectIndex", () => {
  it("maps index 0 → a", () => expect(clampCorrectIndex(0)).toBe("a"));
  it("maps index 1 → b", () => expect(clampCorrectIndex(1)).toBe("b"));
  it("maps index 2 → c", () => expect(clampCorrectIndex(2)).toBe("c"));
  it("maps index 3 → d", () => expect(clampCorrectIndex(3)).toBe("d"));
  it("clamps negative index to a", () => expect(clampCorrectIndex(-1)).toBe("a"));
  it("clamps out-of-range index to d", () => expect(clampCorrectIndex(5)).toBe("d"));
  it("clamps large index to d", () => expect(clampCorrectIndex(99)).toBe("d"));
});
