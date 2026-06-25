# Granola Integration

Granola is a macOS meeting intelligence app. It captures meeting audio and generates
transcripts, summaries, and notes. The Libris system uses Granola as the **daily life signal**
that drives proactive knowledge surfacing.

---

## What Granola Gives Us

| Data | Available via MCP | Usage |
|---|---|---|
| Meeting list | `list_meetings` | Find yesterday's meetings |
| Full transcript | `get_meeting_transcript` | Extract themes |
| Semantic search | `query_granola_meetings` | Find meetings about a topic |
| Account info | `get_account_info` | Confirm user identity |

---

## Daily Digest Pipeline (Scheduled — 10:00 CEST / 08:00 UTC)

```
10:00 — Digest Workflow starts
   │
   ├─ 1. list_meetings(date = yesterday)
   │        → array of { meeting_id, title, duration, participants }
   │
   ├─ 2. For each meeting (parallel):
   │        get_meeting_transcript(meeting_id)
   │        → { transcript_text, summary, action_items }
   │
   ├─ 3. Haiku: extract_themes tool
   │        Input: transcript_text (first 4,000 tokens max)
   │        Output: {
   │          problems: string[],
   │          decisions: string[],
   │          open_questions: string[],
   │          topics: string[]        ← anonymised, no names
   │        }
   │        ⚠ Transcripts are NOT stored — processed in memory only
   │
   ├─ 4. For each theme (parallel RAG search):
   │        embed(theme) → search pgvector (top 5 per theme)
   │        filter: relevance_score > 0.75
   │
   ├─ 5. Opus: synthesise_digest tool
   │        Input: themes + retrieved chunks
   │        Output: digest_sections[] = {
   │          meeting_theme: string,
   │          library_says: string,    ← synthesised paragraph
   │          citations: Citation[],
   │          reading_suggestion: { title, chapter } | null
   │        }
   │
   └─ 6. Send digest via email (Cloudflare Email) or push notification
```

---

## On-Demand Granola Query

The user can also explicitly ask: *"What does my library say about what I discussed yesterday?"*

This triggers the same pipeline but:
- User can specify a specific meeting or date range
- Results are returned in the chat interface, not email
- User can drill down: "Tell me more about the [Grove] reference"

---

## Privacy Architecture

Meeting transcripts contain sensitive information (names, companies, deals, strategies).

**Rules — non-negotiable:**

1. Transcripts are fetched, processed in memory, and immediately discarded
2. Only the extracted `topics` array is persisted — never names, companies, or verbatim quotes
3. The `topics` array is stored in a `digest_themes` table associated with `user_id` and `date` only
4. RAG queries use `topics` strings — never transcript content
5. The digest email contains knowledge base citations, not transcript excerpts

---

## extract_meeting_themes Tool Schema

```typescript
const extractMeetingThemesTool = {
  name: "extract_meeting_themes",
  description: "Extract anonymised discussion themes from a meeting transcript for knowledge matching. Remove all proper nouns — people names, company names, product names.",
  input_schema: {
    type: "object",
    properties: {
      problems: {
        type: "array",
        items: { type: "string" },
        description: "Problems or challenges discussed, expressed as generic concepts"
      },
      decisions: {
        type: "array",
        items: { type: "string" },
        description: "Decisions made, expressed as generic principles"
      },
      open_questions: {
        type: "array",
        items: { type: "string" },
        description: "Unresolved questions that could benefit from external knowledge"
      },
      topics: {
        type: "array",
        items: { type: "string" },
        description: "General topics discussed (management, strategy, product, trading, etc.)"
      }
    },
    required: ["problems", "decisions", "open_questions", "topics"]
  }
}
```

**Example input**: "We discussed whether to promote Sarah to lead the new payments team or hire externally given the speed we need..."

**Example output**:
```json
{
  "problems": ["internal promotion vs external hire trade-off when speed matters"],
  "decisions": [],
  "open_questions": ["how to evaluate internal candidates against speed requirements"],
  "topics": ["team building", "hiring", "organisational design", "leadership transitions"]
}
```

---

## Digest Email Format

```
Subject: Your library for today — [Date]

Based on your [N] conversations yesterday, here's what your library has to say:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

THEME: Scaling team structure without losing speed

📚 High Output Management — Andy Grove
   Chapter 4: "Managerial Leverage"
   "The output of a manager is the output of the organisational units under
    their supervision or influence."

📧 Lenny's Newsletter — "How Linear builds product" (2024-01-15)
   "Speed comes from small teams with full context, not from process."

CONNECTION: Both Grove and Lenny's data point to the same root cause:
coordination cost grows as O(n²) with team size. Grove's answer is managerial
leverage; Linear's answer is radical context-sharing.

→ Suggested re-read: High Output Management, Chapter 4

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Next theme...]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Libris · [N] sources indexed · Manage your library →
```
