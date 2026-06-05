# Libris — Implementation Plan

Phases are ordered by dependency. Each phase produces a working, deployable slice.
Never start a phase until the previous one is fully working in production.

---

## Phase 0 — Project Scaffold ✓
*Goal: empty app boots locally and deploys to Cloudflare Workers.*

- [x] Init TanStack Start project (`npm create tsrouter-app`)
- [x] Configure Cloudflare Workers (`wrangler.jsonc`, `nodejs_compat` flag)
- [x] Configure Cloudflare Vite plugin
- [x] Set up Supabase project (new project, separate from Libris/finance-advisor)
- [x] Set up Supabase Auth (magic link / email OTP)
- [x] Configure `requireSupabaseAuth` middleware (carry over from Libris)
- [x] Set up all Cloudflare secrets (`wrangler secret put`)
- [x] Verify: `npm run dev` works locally, `npx wrangler deploy` deploys successfully
- [x] Set up CI: push to `main` → auto-deploy via GitHub Actions

---

## Phase 1 — Database Foundation ✓
*Goal: schema live in Supabase, all RLS verified.*

- [x] Migration 001: pgvector extension
- [x] Migration 002: `user_profiles` + auto-create trigger on signup
- [x] Migration 003: `sources` + `chunks`
- [x] Migration 004: `highlights`
- [x] Migration 005: `user_memories` (partial ivfflat index on `semantic_cache` only)
- [x] Migration 006: `nudges` + `nudge_citations`
- [x] Migration 007: `digest_runs` + `digest_themes`
- [x] Migration 008: Bounty system (copy from Libris migration)
- [x] Migration 009: `match_chunks` RPC
- [x] Migration 010: `match_memories` RPC (semantic_cache only)
- [x] Migration 011: All RLS policies
- [x] Verify RLS: test with two users — no cross-contamination
- [x] Verify: `match_chunks` returns correct ranked results for a test query

---

## Phase 2 — Auth & User Onboarding ✓
*Goal: user can sign up, land on dashboard, see empty state.*

- [x] Login page (magic link email form)
- [x] Auth callback handler
- [x] `user_profiles` auto-created on first login
- [x] Onboarding flow: set display name, librarian name, timezone, digest email
- [x] Dashboard page (empty state — no sources yet)
- [x] Library page (empty state)
- [x] Basic app shell: sidebar, mobile nav, focus routes

---

## Phase 3 — Book Ingestion (Physical) ✓
*Goal: user can add a physical book via cover scan and get chapter summaries.*

- [x] Cover photo upload → `extractBookFromCover` (Haiku vision)
- [x] Google Books API lookup → confirm metadata
- [x] Manual entry fallback (title + author form)
- [x] TOC extraction / manual chapter entry
- [x] `generateChapterSummaries` via `addPhysicalBook` server function (Haiku, prompt-cached)
- [x] Ingestion: create source → Haiku summaries → Gemini batch embed → store chunks (synchronous for Phase 3)
- [x] Gemini embedding helper (`src/lib/gemini.ts`)
- [x] Library page: shows books with cover, author, status indicator
- [x] Book detail page: shows chapters (collapsible) + status
- [ ] Verify: chapter summaries are embedded and retrievable via `match_chunks`

---

## Phase 4 — Book Ingestion (Digital)
*Goal: user can upload a PDF or ePub and have it fully indexed; or scan a Kindle library screenshot to bulk-add ebooks.*

- [ ] PDF upload → `pdfjs-dist` (client-side) → chunk by paragraph
- [ ] ePub upload → JSZip parse (client-side) → chunk by section
- [ ] Scanned PDF detection → fall back to physical book flow
- [ ] Deduplication check (ISBN / title+author match before re-ingesting)
- [ ] Import page: mode selector (Physical / Digital / Kindle) + drag-and-drop + progress
- [ ] Kindle library screenshot import: upload 1+ screenshots → Haiku vision extracts book list → user reviews → bulk ingest via Google Books + AI chapter summaries
- [ ] Verify: uploaded PDF chunks retrievable with correct page numbers

---

## Phase 5 — Highlights
*Goal: user can add personal highlights to any source.*

- [ ] Highlight input UI (book detail page + floating highlight button)
- [ ] `createHighlight` server function → inserts into `highlights`, creates chunk
- [ ] Highlight chunk embedded immediately (not via Workflow — fast path)
- [ ] Verify: highlight outranks AI chapter summary in `match_chunks` (authority_tier = 1)

### Highlight import paths (for future sprints)
Manual entry (paste a quote) is the Phase 5 baseline. These richer import paths should be added once manual highlights are working:

**Kindle — `My Clippings.txt` (recommended first)**
- Connect Kindle via USB → parse the plain-text `My Clippings.txt` file on the device
- Format is well-documented and consistent; an afternoon of work to build a parser
- Matches highlights to existing sources by title/author, creates highlight records in bulk
- No third-party dependency, works offline

**Readwise API (most powerful)**
- Readwise aggregates Kindle, iBooks, Instapaper, Pocket, and more into one API
- If user already uses Readwise, one integration covers all sources at once
- Requires a Readwise account and API key
- Best long-term option if the user is already in the Readwise ecosystem

**`read.amazon.com` scraping (avoid)**
- Amazon's website shows Kindle highlights but scraping is fragile and against ToS

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
- [ ] Indexer flow — redesign for speed (see note below)
- [ ] Leaderboard + payment tracking
- [ ] Verify: indexer cannot access highlights, nudges, or digest data (RLS)

### Indexer flow design note
The bounty indexer scans many books quickly — optimise for speed and accuracy over tokens.
Recommended flow: **barcode scan → Google Books lookup → confirm metadata → enter chapters → submit**

**Barcode scan** (primary path):
- Use `BarcodeDetector` Web API (Chrome/Edge); fall back to `@zxing/library` for Safari
- Extract ISBN from barcode → call existing `lookupBook()` → pre-fills title/author/cover
- Zero Haiku tokens — pure Google Books API call
- Faster and more accurate than cover vision for intact barcodes

**Cover scan** (fallback for worn/missing barcodes):
- Keep existing `extractBookFromCover` (Haiku vision) as the fallback path
- Triggered automatically if barcode scan fails or user skips it

**Why not barcode in the personal import flow:**
- The Search tab already handles ISBN lookup (type ISBN → exact Google Books match)
- Personal imports are infrequent and deliberate — speed is not the priority
- Barcode scanning earns its place at volume (50+ books per session)

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

---

## Testing Strategy

### Layer 1 — Unit tests (Vitest) — `npm run test`
Run on every commit. Test pure logic with no external dependencies.

What to cover per phase:
- **Phase 1**: RLS policy logic (simulate two users, verify isolation)
- **Phase 2**: Auth flow helpers, user profile defaults
- **Phase 3–4**: Chunking algorithms, deduplication logic, chapter summary prompts
- **Phase 5**: Highlight authority ranking
- **Phase 6**: Memory decay calculations, relevance scoring, prompt assembly, cache threshold logic
- **Phase 7**: RSS parsing, GitHub content extraction, Readability stripping
- **Phase 9**: `extract_meeting_themes` anonymisation (no proper nouns in output)

### Layer 2 — Integration tests (Vitest + real Supabase)
Run before every deploy. Use the service key against the real DB.

```bash
# Add to package.json scripts:
"test:integration": "vitest run --project integration"
```

What to cover:
- Every new RPC: call it, verify output shape
- RLS: create two test users, verify neither sees the other's data
- `match_chunks`: insert a test chunk, embed it, verify it's retrievable
- `match_memories`: insert a semantic_cache entry, verify similarity search returns it

### Layer 3 — E2E tests (Playwright) — `npm run test:e2e`
Run weekly or before major releases. Test critical user flows in a real browser.

Critical flows to cover:
- Sign in → redirect to library (Phase 2)
- Add a book → appears in library with correct status (Phase 3)
- Type a nudge → response contains at least one citation (Phase 6)
- Digest settings save → reflected on next digest run (Phase 9)

### Regression prevention rules
1. Never merge a change that breaks `npm run test`
2. After every migration: regenerate types → `npx supabase gen types typescript --project-id orzkyfdixfckawtmoyvm > src/integrations/supabase/types.ts`
3. After every prompt change: update `docs/PROMPTS.md` to match
4. After every agent change: update `docs/AGENT_CONTRACTS.md` to match

---

## Maintenance Checklist

### After every migration
```bash
npx supabase gen types typescript --project-id orzkyfdixfckawtmoyvm > src/integrations/supabase/types.ts
git add src/integrations/supabase/types.ts && git commit -m "chore: regenerate supabase types"
```

### Weekly (from Phase 6 onwards)
- Check `nudges.tokens_used` average — spike = something changed in the pipeline
- Check `sources.ingest_status = 'failed'` count — any failures need investigation
- Check digest email delivery rate

### Monthly
```bash
npm outdated          # review available updates
npm update            # apply patch versions safely
```
Review: Anthropic SDK, Cloudflare Workers plugin, TanStack Start — these move fast.

### Before every production deploy
```bash
npm run test          # unit tests must pass
npm run build         # build must be clean
npm run lint          # no lint errors
```
