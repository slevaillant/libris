# Skills — Domain Knowledge for AI Agents

This document gives every agent in the Libris system the domain knowledge it needs
to make correct decisions without burning tokens on inference.

---

## 1. Book Knowledge Domain

### Physical Book Indexing

A physical book that has never been digitised has **zero retrievable content** in the system.
The strategy is to index it at **chapter level** using two signals:

1. **Structural signal**: title, author, ISBN, table of contents (scanned by bounty indexer)
2. **Semantic signal**: AI-generated chapter summary using Claude's training knowledge

A chapter summary must answer:
- What is the core argument or teaching of this chapter?
- What are the 2–3 key concepts introduced?
- What type of reader would benefit from this chapter?
- What problem does it solve?

Chapter summaries are NOT retrieved directly — they seed the embedding. The user's own
highlights and notes, once added, become the high-fidelity signal that sits on top.

### Book Importance Hierarchy (for retrieval ranking)

```
User highlight from this book          ← highest signal (they marked it)
User note linked to a chapter          ← high signal (they processed it)
AI chapter summary                     ← medium signal (AI-generated)
Book-level metadata (title, author)    ← lowest signal (structural only)
```

When ranking retrieval results, prefer user-generated content over AI-generated content
from the same book.

### E-Book / PDF Content

E-books and PDFs contain the actual text. Chunk strategy:

| Format | Chunk size | Overlap | Boundary |
|---|---|---|---|
| PDF (non-scanned) | 400 tokens | 50 tokens | Paragraph |
| ePub | 400 tokens | 50 tokens | Paragraph |
| Scanned PDF | Not processable — treat as physical book |
| PDF with TOC | Use TOC to define chapter boundaries |

Always store: `source_id`, `chunk_index`, `page_number` (PDF), `chapter_title`, `section_title`.

---

## 2. Online Sources Domain

### Substack Newsletters

Substack articles are high-signal, curated, author-attributed content.
Ingestion strategy:

1. Fetch via RSS (atom feed: `substack.com/feed`)
2. Strip HTML → extract clean text
3. Extract: `title`, `author`, `publication_date`, `url`, `estimated_read_time`
4. Classify article type (haiku):
   - `analysis` — deep argument, citable claims
   - `interview` — Q&A format, attribute quotes to interviewee
   - `listicle` — extract individual items as separate chunks
   - `news` — low long-term value, shorter retention
5. Extract key passages (haiku): 3–5 passages per article that contain a standalone claim
6. Embed passages independently (not the full article)

**Retention policy**: `analysis` and `interview` types kept indefinitely.
`news` type expires after 90 days (configurable).

### GitHub Repositories

GitHub repos are indexed for their **conceptual content**, not their code.

Content to index per repo:
- `README.md` (primary — always index)
- `CONTRIBUTING.md` (secondary — patterns and philosophy)
- `docs/` folder markdown files (if exists)
- GitHub Discussions (if public) — high signal for design decisions
- Wiki (if public)

Content to **skip**:
- Source code files (`.ts`, `.py`, `.go` etc) — not knowledge, it's implementation
- `CHANGELOG.md` — operational, not conceptual
- Issue comments — too noisy

Chunking: by heading (`##` and `###` boundaries). Each heading + its content = one chunk.

### Web Articles

Ingested via URL paste (user-triggered) or via RSS feeds of specific authors.

Extract:
- `title`, `author` (if attributable), `publication_date`, `canonical_url`
- Article text (Readability-parsed, no ads/nav)
- Chunk by paragraph groups (3–4 paragraphs per chunk)

---

## 3. Granola Integration Domain

Granola is a meeting transcript and notes application used via the MCP server.

### Available Data

Via Granola MCP:
- `list_meetings` — recent meetings with metadata
- `get_meeting_transcript` — full transcript of a specific meeting
- `query_granola_meetings` — semantic search across all meetings

### Daily Digest Pipeline

The daily digest runs at 06:00 user local time and processes **yesterday's meetings**.

Pipeline:
1. Fetch all meetings from the previous day via `list_meetings`
2. For each meeting, fetch the transcript via `get_meeting_transcript`
3. Extract themes using Haiku (`extract_meeting_themes` tool):
   - Problems discussed
   - Decisions made
   - Open questions
   - People / organisations mentioned
4. For each theme, run a parallel RAG search across the knowledge base
5. Filter results by relevance score > 0.75
6. Orchestrator synthesises into a digest:
   - "In your meeting about X, you discussed Y. Here's what your library says:"
   - Specific chapter/article citations
   - One synthesised connection you may not have seen

### Privacy Rules for Granola Data

- Meeting transcripts are **never stored** in Supabase — processed in memory only
- Only the extracted **themes** are persisted (anonymised from names/companies)
- Themes are associated with the user's digest, not the original meeting
- Meeting participant names are never included in RAG queries

---

## 4. Financial & Trading Domain Knowledge

For users with trading or finance content in their library, agents must understand:

### Document Types in Finance

| Type | Key fields to extract | Chunk strategy |
|---|---|---|
| Investment thesis | Ticker, thesis statement, catalysts, risks | By section |
| Market analysis | Timeframe, asset class, macro view | By paragraph |
| Trading strategy | Entry rules, exit rules, timeframe | By rule |
| Book (finance) | Same as general book | By chapter |
| Newsletter (finance) | Author view vs market consensus | By claim |

### Terminology Agents Must Recognise

- Asset classes: equities, fixed income, crypto, commodities, FX, derivatives
- Strategies: momentum, mean reversion, carry, value, trend following, arbitrage
- Risk concepts: drawdown, Sharpe ratio, correlation, beta, tail risk, VaR
- Macro concepts: yield curve, credit spreads, monetary policy, fiscal policy

When a user nudge contains financial terminology, the RAG agent should
**weight finance-tagged sources higher** in the retrieval ranking.

---

## 5. AI & Technology Domain Knowledge

For users with AI/ML content in their library:

### Taxonomy for AI Content

| Category | Examples |
|---|---|
| Foundational | Attention is All You Need, GPT papers |
| Applied | Prompt engineering, RAG patterns, agent design |
| Tooling | LangChain, LlamaIndex, Cloudflare Agents |
| Strategic | AI in business, AI safety, policy |

### GitHub AI Repos — What to Extract

For AI repos specifically, also index:
- `examples/` folder — concrete usage patterns
- Paper links mentioned in README — record as references
- Benchmark results — extract as structured data points

---

## 6. Quiz Generation Domain

### Purpose

After the daily digest email, the user can click "Test your memory" to open a multiple-choice quiz
at `/quiz/<digestRunId>`. Questions are generated on-demand from the `digest_themes.synthesis` text
already stored in Supabase — no additional API calls to external data.

### Question design rules

A well-formed quiz question:
- Tests **understanding of the key insight**, not surface recall of a word or name
- Has exactly **4 options**: one unambiguously correct, three plausible distractors
- Includes a one-sentence **explanation** that references the synthesis text
- Is answerable from the synthesis alone — not from background knowledge

Poor question (avoid): "Which company did the author mention as an example?"
Good question: "According to the synthesis, what is the primary reason delegation fails in fast-growing teams?"

### Model and prompt strategy

- Model: `claude-haiku-4-5-20251001` (classification/extraction task)
- One Haiku call per theme (parallelised)
- Input capped at 1200 chars of synthesis to stay within Haiku's optimal window
- `tool_choice: {type: "tool", name: "generate_question"}` — no freeform parsing
- System prompt cached with `cache_control: {type: "ephemeral"}`

### Failure modes

- `correct_index` out of range (0–3): clamped server-side to prevent invalid state
- Fewer than 4 options returned: question is discarded (returns `null`), not surfaced to user
- All themes fail: throw `"Could not generate quiz questions — please try again"` to the UI

---

## 7. Source Authority Ranking

When returning multiple results for a nudge, rank by:

1. **User highlights** (from any source) — always top
2. **Books the user has read** (flagged as "read") — over unread
3. **Substack articles** from authors the user follows explicitly — over auto-discovered
4. **GitHub repos** the user starred — over auto-indexed
5. **Web articles** the user manually ingested — over auto-scraped
6. **AI-generated summaries** — always last unless nothing else matches

Recency bonus: for `news` and `newsletter` types, boost articles from the last 30 days.
For `book` and `analysis` types, recency is irrelevant — timeless content ranks on relevance alone.
