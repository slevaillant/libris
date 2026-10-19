import { describe, it, expect } from "vitest";
import { parseTopicEntriesFromMd } from "@/lib/digest.functions";
import { isWeeklyDigestSlot, isoWeek } from "@/lib/weekly-digest";

// ── TOPICS.md written by the weekly routine ───────────────────────────

const ROUTINE_MD = `# TOPICS — Knowledge Enrichment Feed

## To Explore

<!-- TOPICS_START -->

> Current selection: 2026-W43. Three questions.

- [ ] 2026-10-15 | **Team topologies for a growing product org** | _source: [1:1](https://example.com/a) · [thread](https://example.com/b)_
  > **Challenge:** A new team is being formed.
  > **Libris query:** When should a software company split a team around a single customer segment?
  > **Evidence update (2026-10-16):** New constraints.
  <!-- morning-2026-10-16:topic-teams -->

  > **Weekly focus (2026-W43, reviewed 2026-10-19):** Still open.

- [ ] 2026-09-14 | **Fixed-date launch under uncertainty** | _source: Meeting (Sep 11)_
  > **Weekly focus (2026-W42):** Scenario-based feasibility.
  > **Libris query:** How should a team build probability-based delivery scenarios?
  > **Historical framing (retained; not current status):**
  > **Question to explore:** Is this older question ignored?

- [ ] 2026-09-11 | **Legacy question only** | _source: Meeting_
  > **Question to explore:** What resolves conflicting priorities?

---

## Explored

<!-- TOPICS_DONE -->
- [x] 2026-08-31 | **Explored topic** | _source: Ticket_

## Backlog from previous weeks

- [ ] 2026-09-18 | **Backlog topic** | _source: Working session_
  > **Libris query:** This should not appear.
`;

describe("parseTopicEntriesFromMd — weekly routine format", () => {
  const entries = parseTopicEntriesFromMd(ROUTINE_MD);

  it("only returns the weekly selection (not explored or backlog)", () => {
    expect(entries.map((e) => e.title)).toEqual([
      "Team topologies for a growing product org",
      "Fixed-date launch under uncertainty",
      "Legacy question only",
    ]);
  });

  it("uses the Libris query, even when it is not in the first lines of the block", () => {
    expect(entries[0].query).toBe(
      "When should a software company split a team around a single customer segment?",
    );
  });

  it("prefers the Libris query over a historical question", () => {
    expect(entries[1].query).toBe("How should a team build probability-based delivery scenarios?");
  });

  it("falls back to the English 'Question to explore' label", () => {
    expect(entries[2].query).toBe("What resolves conflicting priorities?");
  });
});

// ── Scheduling ────────────────────────────────────────────────────────

describe("isWeeklyDigestSlot — Friday 12:00 Europe/Paris", () => {
  it("fires at 10:00 UTC on a summer-time Friday", () => {
    expect(isWeeklyDigestSlot(new Date("2026-10-23T10:00:00Z"))).toBe(true);
    expect(isWeeklyDigestSlot(new Date("2026-10-23T11:00:00Z"))).toBe(false);
  });

  it("fires at 11:00 UTC on a winter-time Friday", () => {
    expect(isWeeklyDigestSlot(new Date("2026-10-30T11:00:00Z"))).toBe(true);
    expect(isWeeklyDigestSlot(new Date("2026-10-30T10:00:00Z"))).toBe(false);
  });

  it("never fires on other days", () => {
    expect(isWeeklyDigestSlot(new Date("2026-10-22T10:00:00Z"))).toBe(false);
  });
});

describe("isoWeek", () => {
  it("matches ISO-8601 week numbers", () => {
    expect(isoWeek(new Date("2026-10-23T10:00:00Z"))).toBe(43);
    expect(isoWeek(new Date("2026-01-01T10:00:00Z"))).toBe(1);
    expect(isoWeek(new Date("2027-01-01T10:00:00Z"))).toBe(53);
  });
});
