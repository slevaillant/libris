# Libris

> *Surface what you know, when you need it.*

Libris is a personal knowledge intelligence system that indexes your physical books,
e-books, Substack subscriptions, GitHub repos, and web articles into a unified
semantic knowledge base — then surfaces the right knowledge at the right moment,
proactively and on demand.

---

## The Problem

You have accumulated high-signal, curated knowledge across three dark sources:

- **Physical books** — content locked in atoms, unsearchable
- **E-books & PDFs** — locked behind platforms or file systems  
- **Substacks, GitHub, web** — scattered, not personal, not structured

At the moment a conversation, idea, or decision demands it, you cannot access the
knowledge you already trust.

## The Solution

A multi-agent RAG system powered by Claude that:

1. **Indexes** all source types with AI-generated structure
2. **Listens** to your daily professional life via [Granola](https://granola.so) meeting transcripts
3. **Surfaces** the right knowledge at the right moment — proactively each morning, on demand via chat
4. **Cites** every answer back to a specific source, chapter, or passage — no hallucination by design

---

## Architecture

```
                    OrchestratorAgent (claude-opus-4-7)
                           │
          ┌────────────────┼────────────────┐
          │                │                │
      RAGAgent         MemoryAgent      DigestAgent
   (sonnet-4-6)       (haiku-4-5)     (haiku + opus)
          │                │                │
          └────────────────┴────────────────┘
                           │
                    Supabase pgvector
          (sources · chunks · memories · digests)
```

**Stack**: React 19 + TanStack Start · Cloudflare Workers + Agents SDK · Supabase (Postgres + pgvector) · Anthropic Claude · Gemini Embeddings

**Memory layer**: Karpathy-lean in-context loading for episodic/preference/pattern memory.
pgvector only for semantic cache and knowledge base retrieval.

---

## Key Features

- **Universal ingestion**: physical books (bounty indexing), e-books, PDFs, Substack RSS, GitHub repos, web articles
- **On-demand chat**: type a thought → Lumen (your personal librarian) searches your library and responds with citations
- **Daily digest**: morning email connecting yesterday's Granola meeting themes to your library
- **Memory layer**: Lumen remembers past conversations, adapts to your preferences, finds patterns
- **Bounty system**: invite others to physically scan your library, earn per book indexed
- **Connection engine**: surfaces non-obvious links across sources

---

## Documentation

| File | Contents |
|---|---|
| [`PRD.md`](PRD.md) | Product requirements, features, success metrics |
| [`PLAN.md`](PLAN.md) | Phased implementation roadmap |
| [`CLAUDE.md`](CLAUDE.md) | Developer guide — stack, conventions, model rules |
| [`docs/SKILLS.md`](docs/SKILLS.md) | Domain knowledge for AI agents |
| [`docs/TOKEN_BUDGET.md`](docs/TOKEN_BUDGET.md) | Model selection and token efficiency rules |
| [`docs/MEMORY.md`](docs/MEMORY.md) | Memory layer architecture |
| [`docs/PERSONA.md`](docs/PERSONA.md) | Lumen's character, voice, response templates |
| [`docs/AGENT_CONTRACTS.md`](docs/AGENT_CONTRACTS.md) | Agent inputs, outputs, tools, failure modes |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Full schema and pgvector RPC definitions |
| [`docs/SOURCES.md`](docs/SOURCES.md) | Per-source ingestion strategy |
| [`docs/GRANOLA.md`](docs/GRANOLA.md) | Granola integration and daily digest pipeline |
| [`docs/PROMPTS.md`](docs/PROMPTS.md) | Prompt templates with caching strategy |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Auth, RLS, secrets, logging rules |

---

## Status

Currently in pre-development — documentation and architecture phase complete.
See [`PLAN.md`](PLAN.md) for the implementation roadmap.

---

## License

MIT — designed to be open-sourced once stable. See [`PLAN.md`](PLAN.md) Phase 12.
