# Libris — Claude Code Instructions

Personal knowledge intelligence system. Indexes physical books, e-books, Substacks, GitHub repos,
and web articles into a unified semantic knowledge base. Surfaces the right knowledge at the right
moment — proactively via Granola meeting analysis, and on-demand via chat.

## Stack
- **Frontend/SSR**: React 19 + TanStack Start (typed server functions)
- **Agent runtime**: Cloudflare Agents SDK (Durable Objects, Workflows, scheduled tasks)
- **Database**: Supabase (Postgres + pgvector + Auth + RLS)
- **Deployment**: Cloudflare Workers (`nodejs_compat` flag)
- **Orchestration model**: `claude-opus-4-7` (synthesis, connections, complex routing)
- **Specialist model**: `claude-haiku-4-5` (classification, extraction, chunking)
- **RAG model**: `claude-sonnet-4-6` (retrieval, passage selection, chat responses)
- **Embeddings**: `gemini-embedding-001` (1536 dims)
- **Memory layer**: pgvector (`user_memories` table) — semantic cache + episodic + preference + pattern
- **Persona**: Lumen — defined in `docs/PERSONA.md`, injected as cached L2 system prompt
- **Email**: Cloudflare Email Workers

## Project Layout

```
libris/
  src/
    routes/                      ← TanStack Start pages
      index.tsx                  ← Dashboard
      chat.tsx                   ← On-demand nudge interface
      library.tsx                ← Book + source browser
      digest.tsx                 ← Daily digest settings
      import.tsx                 ← Manual import (URL, PDF, book)
      index-books.tsx            ← Bounty indexing flow (from Libris)
      join.$token.tsx            ← Invite redemption (from Libris)
      bounty.tsx                 ← Bounty management
    agents/
      orchestrator.agent.ts      ← Main Durable Object — routes + synthesises
      rag.agent.ts               ← Semantic search + passage selection
      ingestion.agent.ts         ← Document processing pipeline
      digest.agent.ts            ← Daily Granola analysis + email
    lib/
      supabase.ts                ← Supabase client factory
      gemini.ts                  ← Embedding helper
      library.functions.ts       ← Library CRUD (createServerFn)
      profile.functions.ts       ← User profile (createServerFn)
      chat.functions.ts          ← On-demand nudge server functions (createServerFn)
      bounty.functions.ts        ← Bounty system (createServerFn)
      digest.functions.ts        ← Digest preferences + history (createServerFn)
      chunking.ts                ← Source-type-aware chunking
      granola.ts                 ← Granola MCP client wrapper
      sources/
        rss.ts                   ← Substack / RSS ingestion
        github.ts                ← GitHub repo ingestion
        web.ts                   ← URL → article extraction
        pdf.ts                   ← PDF/ePub parsing
  sync/
    index.ts                     ← Local vault sync (if needed)
  supabase/
    migrations/                  ← SQL migrations
  docs/
    ARCHITECTURE.md
    DATA_MODEL.md
    AGENT_CONTRACTS.md
    SKILLS.md                    ← READ THIS before touching agent prompts
    SOURCES.md
    PROMPTS.md
    GRANOLA.md                   ← READ THIS before touching digest pipeline
    TOKEN_BUDGET.md              ← READ THIS before choosing a model or writing a prompt
    SECURITY.md
  PRD.md
  PLAN.md
```

## Critical Reading Before Coding

| File | Read when... |
|---|---|
| `docs/TOKEN_BUDGET.md` | Choosing a model, writing any prompt, structuring context |
| `docs/MEMORY.md` | Touching the memory layer, semantic cache, user model |
| `docs/PERSONA.md` | Writing ANY conversational response, touching system prompts |
| `docs/SKILLS.md` | Writing agent prompts, classification logic, chunking strategy |
| `docs/AGENT_CONTRACTS.md` | Writing any agent, adding tools, changing inputs/outputs |
| `docs/DATA_MODEL.md` | Touching the database, writing migrations, adding columns |
| `docs/GRANOLA.md` | Touching the digest pipeline |
| `docs/PROMPTS.md` | Writing or editing any system prompt |

## Agent Architecture

```
User
 │
 ▼
OrchestratorAgent (Durable Object, opus-4-7)
 │ routes to
 ├─ RAGAgent (haiku → sonnet, stateless)
 ├─ IngestionAgent (haiku, queue-fed Workflow)
 └─ DigestAgent (haiku + opus, scheduled 06:00)
```

## Coding Conventions

- **Server functions**: `createServerFn` + `.middleware([requireSupabaseAuth])` + Zod input validator — always in `src/lib/`, never `src/server/` (TanStack Start blocks client imports from any `**/server/**` path)
- **All Claude calls**: `@anthropic-ai/sdk` — never raw `fetch` to `api.anthropic.com`
- **Prompt caching**: ALWAYS `cache_control: {type: "ephemeral"}` on L1 and L2 context layers
- **Tool use**: ALL structured outputs use `tool_choice: {type: "tool", name: "..."}` — no freeform parsing
- **Gemini embeddings**: raw `fetch` to Generative Language API
- **Anthropic client**: instantiate inside handler — `new Anthropic({ apiKey })` — edge-safe
- **TypeScript strict mode**: never use `any`
- **Logs**: never log meeting content, highlights, financial data, or personal notes
- **Errors**: never swallow — always surface via toast or structured error response
- **Ingestion**: always `.catch(() => undefined)` on embedding — never fail ingestion due to embedding

## Model Selection Rules (from TOKEN_BUDGET.md)

| Task | Model | Rule |
|---|---|---|
| Classification, metadata extraction | `claude-haiku-4-5` | ALWAYS haiku |
| RAG search, chat response | `claude-sonnet-4-6` | ALWAYS sonnet |
| Synthesis, connections, orchestration | `claude-opus-4-7` | ALWAYS opus |

## Environment Variables

```
ANTHROPIC_API_KEY          # Claude (all models)
GEMINI_API_KEY             # gemini-embedding-001
SUPABASE_URL               # Supabase project URL
SUPABASE_PUBLISHABLE_KEY   # Supabase anon key
SUPABASE_SERVICE_KEY       # Local only — sync scripts, never deployed
GITHUB_TOKEN               # GitHub API (repo ingestion)
```

## Development Commands

```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Build for Cloudflare Workers
npx wrangler deploy  # Deploy to production
npm run lint         # ESLint check
npm run test         # Vitest unit tests
```

## Patterns Carried Over from Libris

- **Bounty system**: `bounty.functions.ts` + `index-books.tsx` + `join.$token.tsx` — reuse as-is
- **Embedding pipeline**: non-fatal, always `.catch(() => undefined)`
- **RLS on every table**: all queries scoped to `auth.uid()`
- **`requireSupabaseAuth` middleware**: extract JWT, create scoped client, inject `userId`
- **Gemini embedding**: 1536 dims, `gemini-embedding-001`
