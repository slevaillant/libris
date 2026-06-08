# Libris — Product Requirements Document

## Tagline
*Surface what you know, when you need it.*

---

## Problem

Knowledge workers accumulate high-signal, curated information across three categories of **dark data**:

| Source | Why it's dark | Your signal |
|---|---|---|
| Physical books | Content locked in atoms — unsearchable | You chose every one deliberately |
| E-books / PDFs | Locked behind platforms or file systems | Curated, annotated, highlighted |
| Substack / GitHub / web | Scattered, not personal, not structured | You filtered the signal already |

The result: at the moment a conversation, idea, or decision demands it, you cannot access the knowledge you already trust. You either forget it exists, can't find it, or spend 20 minutes searching.

This is not a search problem. It is a **retrieval at the right moment** problem.

---

## Solution

A multi-agent knowledge system that:
1. **Indexes** all three source types with AI-generated structure
2. **Listens** to your daily life via Granola meeting transcripts
3. **Surfaces** the right knowledge at the right moment — proactively and on demand
4. **Cites** every answer back to a specific source, chapter, or passage — no hallucination by design

---

## Primary Persona

**The high-signal knowledge worker**
- Maintains a curated physical library (50–500 books)
- Follows 10–30 high-quality Substacks and GitHub accounts
- Has 3–8 professional conversations per day (captured in Granola)
- Wants to make decisions informed by accumulated wisdom, not just recent memory
- Values citation over fluency — wrong-but-confident answers are worse than no answer

---

## Core Features

### 1. Universal Ingestion
Index every source type into a unified semantic knowledge base.

| Source | Method | Granularity |
|---|---|---|
| Physical book | Cover scan → identify → AI chapter summaries | Chapter + section |
| E-book / PDF | Text extraction + chunking | Paragraph / section |
| Substack | RSS auto-fetch; daily cron + manual "Sync feeds" button | Article + key passages |
| GitHub repo | README + wiki + discussions | Section |
| Web article | URL paste → instant ingestion | Article + key passages |
| YouTube video | youtubei API → transcript + key ideas; falls back to description | ~2-min transcript segments |
| User highlights | Manual input, linked to source | Passage |

### 2. Bounty Indexing (Physical Library)
Invite others to physically scan books in your library. Each scanner photographs covers, confirms title/author/chapters, earns a bounty per book. Reuses Libris indexer flow.

### 3. On-Demand Chat (Nudge Interface)
User pastes a thought, conversation fragment, or question. The system:
- Extracts themes and concepts
- Searches all sources in parallel
- Returns cited recommendations with a synthesized connection
- Each citation is a clickable link — external URL for articles/videos, internal source page for books
- Responds in <3 seconds

Example input: *"Had a meeting about scaling our team from 8 to 30 people while keeping speed. What do I have?"*

Example output:
```
📚 High Output Management (Grove) — Ch. 4
   "Managerial leverage scales inversely with team size unless..."

📧 Lenny's Newsletter — "How Figma Scaled Product" (2024-03)
   "The moment you hit 15 engineers, informal coordination breaks..."

💻 github.com/basecamp/handbook
   "We don't coordinate with meetings — we coordinate with writing..."

These three converge on one idea: [synthesis paragraph]
```

### 4. Proactive Daily Digest
Every morning, an email or notification summarising:
- Yesterday's Granola meeting themes
- What your knowledge base says about those themes
- Specific chapters or articles to (re)read today
- Cross-source connections you haven't seen before

### 5. Connection Engine
Finds non-obvious links across sources:
- "This Substack post by Lenny connects to Chapter 7 of The Innovator's Dilemma"
- "Three sources in your library independently say X about Y"
- Surfaces under-referenced knowledge ("You have 3 books on negotiation — you've never cited them")

---

## Non-Functional Requirements

### Token Efficiency (critical)
- `claude-haiku-4-5`: all classification, extraction, chunking decisions
- `claude-sonnet-4-6`: RAG retrieval + passage selection
- `claude-opus-4-7`: orchestration, synthesis, connection engine
- Prompt caching on all stable system prompts (`cache_control: {type: "ephemeral"}`)
- Specialists receive only what they need — never full conversation history
- Conversation summarised every 10 turns, never raw-truncated

### Citation-first (structural guarantee)
- No answer is generated without a matching chunk in the knowledge base
- Every response includes `source_id`, `document_title`, `author`, `chapter`, `chunk_index`
- If no relevant chunk exists: "I don't have anything indexed on this topic yet."

### Performance
- On-demand nudge response: <3 seconds end-to-end
- Ingestion: non-blocking (queue-based, never fails the UI)
- Daily digest: generated at 06:00 user local time

### Privacy & Security
- Single-user first — all data scoped to `user_id` via Supabase RLS
- No financial amounts, conversation content, or highlights logged to console
- Service key never deployed — stays local only (sync scripts)
- API keys in Cloudflare secrets only

### Open-Source Readiness
- Clean separation of user data (Supabase) and application logic (Workers)
- No hardcoded user preferences — everything configurable
- MIT license ready from day one

---

## Out of Scope (Phase 1)

- Multi-user / org sharing
- Native mobile app (PWA-first)
- Audio/podcast ingestion
- Automatic highlight sync from Kindle (manual import only)
- Public library discovery

---

## Success Metrics

| Metric | Target |
|---|---|
| Nudge → relevant citation rate | >80% of queries return ≥1 citation |
| On-demand response latency | <3s p95 |
| Daily digest open rate | >60% |
| Books cited per week | Increasing week-over-week |
| Sources indexed | 100% of curated Substack list within week 1 |

---

## Phases

| Phase | Deliverable |
|---|---|
| 1 — Foundation | Schema, auth, agent base, embeddings pipeline |
| 2 — Books | Physical book indexing (bounty system) + e-book/PDF ingestion |
| 3 — Web sources | Substack RSS + GitHub + web article ingestion |
| 4 — Nudge chat | On-demand chat interface with citations |
| 5 — Proactive digest | Granola integration + daily email |
| 6 — Connection engine | Cross-source synthesis + under-reference surfacing |
