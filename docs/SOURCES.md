# Sources — Per-Source Ingestion Strategy

Every source type entering Libris follows its own ingestion path.
All paths converge at the same destination: rows in `chunks` with embeddings in pgvector.

---

## Source Type Registry

| source_type | Entry point | Trigger | Chunking |
|---|---|---|---|
| `physical_book` | Cover scan or manual entry | Bounty indexer or user | Chapter-level AI summaries |
| `ebook` | File upload (epub/pdf) | User import | Section/paragraph |
| `pdf` | File upload | User import | Paragraph with page refs |
| `substack` | RSS feed | Daily cron | Key passage extraction |
| `github_repo` | URL entry | User import or weekly cron | Heading-based |
| `web_article` | URL paste | User triggered | Paragraph groups |

---

## Physical Books

**The core challenge**: no text to extract. Content is dark by definition.

**Strategy**: index at chapter level using two signals stacked on each other.

### Step 1 — Identify
Cover photo → `extractBookFromCoverImage` (Haiku vision) → title + author
→ Google Books API lookup → confirm metadata + fetch table of contents

### Step 2 — Generate chapter summaries (Haiku)
For each chapter in the TOC:
```
Prompt: "You are indexing [Title] by [Author] for a personal knowledge system.
Chapter [N]: [chapter_title].
Write a 150-word summary of this chapter's core argument, key concepts introduced,
and what type of question this chapter would help answer.
Be specific to this book — not generic."
```
Output: one chunk per chapter, `chunk_type = 'chapter_summary'`, embedded immediately.

**Important**: these summaries use Claude's training knowledge about the book.
They are clearly marked `chunk_type = 'chapter_summary'` so retrieval ranking
weights them below user highlights and actual text. They are the floor, not the ceiling.

### Step 3 — User highlights (optional, highest authority)
User can add highlights at any time via the chat interface or library page.
Each highlight: `chunk_type = 'highlight'`, `authority_tier = 1`.
These always outrank AI summaries in retrieval.

### Bounty indexer flow
Bounty indexers physically scan the library:
1. Photograph cover → identify book
2. Confirm title, author, shelf location
3. Open the book → confirm chapter list from TOC page
4. Submit — system generates summaries async

Indexers do NOT type content. They provide the structural skeleton; AI fills the semantic layer.

---

## E-Books (ePub) and PDFs

**The advantage**: actual text available.

### ePub
```
Upload → parse with epub.js → extract chapters as text blocks
→ chunk by paragraph (400 tokens, 50 token overlap)
→ preserve chapter_title and section_title from epub structure
→ embed all chunks
```

### PDF (text-based)
```
Upload → pdf-parse → extract text with page numbers
→ detect chapter/section boundaries (look for heading patterns)
→ chunk by paragraph group (400 tokens, 50 token overlap)
→ store page_number per chunk for citation accuracy
→ embed all chunks
```

### PDF (scanned / image-based)
Detected when pdf-parse returns <100 words for a 10+ page document.
Fall back to physical book flow: generate chapter summaries from title + known content.
Flag `ingest_status = 'skipped'` with `ingest_error = 'scanned_pdf_no_text'`.

### Deduplication
Before ingesting: check `sources` table for matching ISBN or URL.
If match found: update `last_ingested`, re-embed only chunks where content changed.

---

## Substack Newsletters

**Entry point**: user adds a Substack handle (e.g. `lenny`) → stored as a source subscription.
**Trigger**: daily cron at 02:00 (before digest runs at 06:00).

### RSS Fetch
```
https://[handle].substack.com/feed
→ parse atom/RSS XML
→ filter: only articles newer than last_ingested date
→ for each new article: create source row + trigger IngestionAgent
```

### Article Processing (Haiku)
```
1. Strip HTML → clean text (Readability parser)
2. Classify article type: analysis | interview | listicle | news
3. Extract 3–5 key passages (standalone claims worth citing)
4. Each key passage → one chunk, chunk_type = 'key_idea'
5. Full article → one chunk, chunk_type = 'passage' (lower priority)
6. Embed all chunks
```

**Retention policy**:
- `analysis` + `interview`: permanent
- `listicle`: 12 months
- `news`: 90 days → then `confidence` decayed to 0, excluded from retrieval

### Curated Substack List (initial seed)
Stored in `source_subscriptions` table. User can add/remove at any time.

**AI domain**: Ben's Bites, Interconnects (Nathan Lambert), One Useful Thing (Ethan Mollick),
Ahead of AI (Sebastian Raschka), Import AI (Jack Clark), The Algorithmic Bridge

**Product Management**: Lenny's Newsletter, The Beautiful Mess (John Cutler),
Product Thinking (Melissa Perri), The Product Compass

**Trading & Finance**: The Diff (Byrne Hobart), The Macro Compass (Alfonso Peccatiello),
Epsilon Theory (Ben Hunt), Lyn Alden, Doomberg, Verdad Research

---

## GitHub Repositories

**Entry point**: user pastes a GitHub URL, or selects from a curated trending list.
**Trigger**: user-triggered + weekly freshness check (re-ingest if repo updated).

### Content to Index
```
README.md           → always (primary signal)
docs/**/*.md        → if docs/ folder exists
CONTRIBUTING.md     → philosophy and design decisions
wiki pages          → if public wiki exists
GitHub Discussions  → top 20 by upvote (design decisions, Q&A)
```

### Content to Skip
```
Source code files (.ts, .py, .go, etc.)   — implementation, not knowledge
CHANGELOG.md                               — operational, not conceptual
Issue comments                             — too noisy
```

### Chunking
Split by markdown heading (`##` and `###`).
Each heading + its content block = one chunk.
Maximum chunk size: 600 tokens. If exceeded, split at paragraph boundary.

### GitHub API Requirements
Requires `GITHUB_TOKEN` (read-only, public repos only).
Rate limit: 5,000 requests/hour — sufficient for weekly re-ingestion of 50+ repos.

### Curated AI Repos (initial seed)
`anthropics/anthropic-cookbook`, `microsoft/graphrag`, `mem0ai/mem0`,
`BerriAI/litellm`, `run-llama/llama_index`, `karpathy/nanoGPT`,
`crewAIInc/crewAI`, `cloudflare/agents` (Agents SDK examples)

### Curated Trading/Quant Repos (initial seed)
`QuantConnect/Lean`, `mementum/backtrader`, `ranaroussi/yfinance`,
`twopirllc/pandas-ta`, `goldmansachs/gs-quant`

---

## Web Articles

**Entry point**: user pastes a URL into the import interface.
**Trigger**: always user-triggered (no auto-scraping of arbitrary URLs).

### Processing
```
URL → fetch with User-Agent header → Readability.js parse
→ extract: title, author (if bylined), publication_date, canonical_url, clean_text
→ classify with Haiku (analysis | interview | listicle | news)
→ chunk by paragraph groups (3–4 paragraphs per chunk)
→ extract 3 key ideas (Haiku) → chunk_type = 'key_idea'
→ embed all chunks
```

### Failure Handling
- Paywalled content: store metadata only, flag `ingest_status = 'paywalled'`
- JavaScript-rendered pages: attempt with Cloudflare Browser Rendering if available
- Fetch failure after 3 retries: `ingest_status = 'failed'`

---

## Ingestion Pipeline — Shared Rules (all source types)

1. **Non-blocking**: ingestion never blocks the UI. All processing via Cloudflare Workflow.
2. **Non-fatal embedding**: if Gemini embedding fails, store chunk without vector.
   Re-embed on next ingestion pass. Never fail ingestion due to embedding.
3. **Idempotent**: re-ingesting the same source re-processes only changed chunks.
   Identified by `source_id + chunk_index` unique constraint.
4. **Status tracking**: every source has `ingest_status` — always visible in the library UI.
5. **No content logging**: never log chunk content, highlights, or article text to console.
6. **Token cap per chunk**: 600 tokens maximum. Enforced before embedding call.
