# Libris — Implementation Plan

Phases are ordered by dependency. Each phase produces a working, deployable slice.
Never start a phase until the previous one is fully working in production.

---

## Phase 0 — Project Scaffold
*Goal: empty app boots locally and deploys to Cloudflare Workers.*

- [ ] Init TanStack Start project (`npm create tsrouter-app`)
- [ ] Configure Cloudflare Workers (`wrangler.jsonc`, `nodejs_compat` flag)
- [ ] Configure Cloudflare Vite plugin
- [ ] Set up Supabase project (new project, separate from Libris/finance-advisor)
- [ ] Set up Supabase Auth (magic link / email OTP)
- [ ] Configure `requireSupabaseAuth` middleware (carry over from Libris)
- [ ] Set up all Cloudflare secrets (`wrangler secret put`)
- [ ] Verify: `npm run dev` works locally, `npx wrangler deploy` deploys successfully
- [ ] Set up CI: push to `main` → auto-deploy via GitHub Actions

---

## Phase 1 — Database Foundation
*Goal: schema live in Supabase, all RLS verified.*

- [ ] Migration 001: pgvector extension
- [ ] Migration 002: `user_profiles` + auto-create trigger on signup
- [ ] Migration 003: `sources` + `chunks`
- [ ] Migration 004: `highlights`
- [ ] Migration 005: `user_memories` (partial ivfflat index on `semantic_cache` only)
- [ ] Migration 006: `nudges` + `nudge_citations`
- [ ] Migration 007: `digest_runs` + `digest_themes`
- [ ] Migration 008: Bounty system (copy from Libris migration)
- [ ] Migration 009: `match_chunks` RPC
- [ ] Migration 010: `match_memories` RPC (semantic_cache only)
- [ ] Migration 011: All RLS policies
- [ ] Verify RLS: test with two users — no cross-contamination
- [ ] Verify: `match_chunks` returns correct ranked results for a test query

---

## Phase 2 — Auth & User Onboarding
*Goal: user can sign up, land on dashboard, see empty state.*

- [ ] Login page (magic link email form)
- [ ] Auth callback handler
- [ ] `user_profiles` auto-created on first login
- [ ] Onboarding flow: set display name, librarian name, timezone, digest email
- [ ] Dashboard page (empty state — no sources yet)
- [ ] Library page (empty state)
- [ ] Basic app shell: sidebar, mobile nav, focus routes

---

## Phase 3 — Book Ingestion (Physical)
*Goal: user can add a physical book via cover scan and get chapter summaries.*

- [ ] Cover photo upload → `extractBookFromCoverImage` (Haiku vision)
- [ ] Google Books API lookup → confirm metadata
- [ ] Manual entry fallback (title + author form)
- [ ] TOC extraction / manual chapter entry
- [ ] `generateChapterSummaries` server function (Haiku, one call per chapter)
- [ ] `IngestionAgent` Workflow: store source + chunks + embed
- [ ] Gemini embedding helper (`src/lib/gemini.ts`)
- [ ] Library page: shows books with ingest status indicator
- [ ] Book detail page: shows chapters + highlights
- [ ] Verify: chapter summaries are embedded and retrievable via `match_chunks`

---

## Phase 4 — Book Ingestion (Digital)
*Goal: user can upload a PDF or ePub and have it fully indexed.*

- [ ] PDF upload → `pdf-parse` → chunk by paragraph
- [ ] ePub upload → parse → chunk by section
- [ ] Scanned PDF detection → fall back to physical book flow
- [ ] Deduplication check (ISBN / URL match before re-ingesting)
- [ ] Import page: drag-and-drop upload + progress indicator
- [ ] Verify: uploaded PDF chunks retrievable with correct page numbers

---

## Phase 5 — Highlights
*Goal: user can add personal highlights to any source.*

- [ ] Highlight input UI (book detail page + floating highlight button)
- [ ] `createHighlight` server function → inserts into `highlights`, creates chunk
- [ ] Highlight chunk embedded immediately (not via Workflow — fast path)
- [ ] Verify: highlight outranks AI chapter summary in `match_chunks` (authority_tier = 1)

---

## Phase 6 — On-Demand Nudge (RAG Chat)
*Goal: user can type a question and get a cited response from Lumen.*

- [ ] `OrchestratorAgent` Durable Object — session state management
- [ ] `RAGAgent` — `match_chunks` search + passage ranking
- [ ] `MemoryAgent` — `load_session_memories` (in-context, SQL only)
- [ ] `MemoryAgent` — `check_memory_cache` (pgvector, semantic_cache only)
- [ ] Orchestrator flow: memory check → RAG → synthesis → store memory
- [ ] Lumen system prompt (L1 + L2 from PROMPTS.md), prompt caching enabled
- [ ] Chat UI: nudge input + streamed response + citations panel
- [ ] `nudges` + `nudge_citations` written after each response
- [ ] Conversation summarisation after turn 10
- [ ] Verify: cache hit on repeated similar query (check `nudges.cache_hit = true`)
- [ ] Verify: Lumen voice matches PERSONA.md (no affirmations, cites sources, direct)

---

## Phase 7 — Web Sources (Substack + GitHub + Articles)
*Goal: user can subscribe to Substacks, add GitHub repos, and import URLs.*

- [ ] `source_subscriptions` table + CRUD
- [ ] Substack RSS ingestion (`src/lib/sources/rss.ts`)
- [ ] GitHub repo ingestion (`src/lib/sources/github.ts`) — README + docs/ only
- [ ] Web article ingestion (`src/lib/sources/web.ts`) — Readability parse
- [ ] Daily cron: RSS fetch + re-index changed repos (Cloudflare Agents SDK `schedule()`)
- [ ] Substack subscription UI: add handle → preview → subscribe
- [ ] GitHub repo UI: add URL → preview README → confirm
- [ ] URL import UI: paste link → instant ingest → confirmation
- [ ] Verify: Substack article key ideas retrievable and ranked correctly
- [ ] Verify: GitHub repo chunks retrievable with correct heading structure

---

## Phase 8 — Memory Layer (Full)
*Goal: Lumen remembers past conversations and adapts to user preferences.*

- [ ] `write_episodic_memory` after each nudge (async, Haiku)
- [ ] `update_preferences` every 10 nudges (async, Haiku)
- [ ] `analyse_patterns` weekly cron (Haiku)
- [ ] User model built from preference + pattern memories → injected into L2 cache
- [ ] Episodic memories injected into L3 context
- [ ] Verify: second session references first session's topic without being asked
- [ ] Verify: preference memory shapes response style after 10+ interactions

---

## Phase 9 — Daily Digest (Granola Integration)
*Goal: user receives a morning email connecting yesterday's meetings to their library.*

- [ ] `DigestAgent` scheduled task (06:00 user local time)
- [ ] Granola MCP integration (`src/lib/granola.ts`)
- [ ] `extract_meeting_themes` tool (Haiku — fully anonymised)
- [ ] Parallel RAG search per theme
- [ ] Digest synthesis (Opus) → Lumen voice
- [ ] Cloudflare Email sending (`src/lib/email.ts`)
- [ ] `digest_runs` + `digest_themes` stored after each run
- [ ] Digest settings UI: enable/disable, time, email address
- [ ] Digest history UI: last 7 digests readable in-app
- [ ] Verify: no transcript content appears in DB (only anonymised themes)
- [ ] Verify: digest email matches format in GRANOLA.md

---

## Phase 10 — Bounty System (Physical Library Indexing at Scale)
*Goal: user can invite others to physically scan their library.*

- [ ] Port bounty system from Libris (`bounty.functions.ts`, `index-books.tsx`, `join.$token.tsx`)
- [ ] Adapt to Libris schema (sources/chunks instead of books/chapters)
- [ ] Bounty configuration UI (price per book, currency, payment link)
- [ ] Invite link generation + redemption
- [ ] Indexer flow: cover scan → confirm → submit → earn
- [ ] Leaderboard + payment tracking
- [ ] Verify: indexer cannot access highlights, nudges, or digest data (RLS)

---

## Phase 11 — Connection Engine
*Goal: Lumen proactively surfaces cross-source connections.*

- [ ] `find_connections` tool in OrchestratorAgent
  — given a chunk, find semantically similar chunks from different sources
- [ ] "Three sources agree" detection: cluster chunks that converge on the same idea
- [ ] "Under-referenced source" detection: books never cited in last 90 days
- [ ] Connection highlights in chat UI: "Here's something worth noticing..."
- [ ] Weekly connection digest (separate from daily Granola digest)
- [ ] Verify: connection engine finds non-obvious links across source types

---

## Phase 12 — Open Source Preparation
*Goal: repo is clean, documented, and safe to make public.*

- [ ] Audit for hardcoded values (user IDs, emails, org IDs)
- [ ] Verify `.gitignore` covers all secret files
- [ ] Add demo mode (no API keys required — returns mock data)
- [ ] Write `CONTRIBUTING.md`
- [ ] Write `SECURITY.md` notice (responsible disclosure)
- [ ] Ensure Supabase project is separate from personal instance
- [ ] Add MIT license
- [ ] Tag `v1.0.0`

---

## Development Principles

- **One phase at a time** — never start Phase N+1 until Phase N is live in production
- **Document-first** — if a behaviour isn't in a `.md` file, don't build it yet
- **Test the RLS before the UI** — every new table gets a two-user RLS test
- **Verify the prompt cache** — after any prompt change, confirm cache hits in Anthropic usage dashboard
- **Never log content** — enforce via code review on every PR (see SECURITY.md)
- **Measure tokens per nudge** — track `nudges.tokens_used` from Phase 6 onwards
