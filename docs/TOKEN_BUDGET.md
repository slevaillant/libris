# Token Budget — Model Selection & Context Discipline

This document defines which model to use when, how to structure context across the agent stack,
and the rules that prevent token waste at runtime and during development.

---

## Model Selection Matrix

| Task | Model | Reason |
|---|---|---|
| Orchestration, synthesis, connection engine | `claude-opus-4-7` | Complex cross-source reasoning, multi-step planning |
| RAG retrieval, passage selection, chat response | `claude-sonnet-4-6` | Balance of quality and cost for frequent calls |
| Classification, chunk extraction, metadata tagging | `claude-haiku-4-5` | Fast, cheap, structurally constrained via tool use |
| Embeddings | `gemini-embedding-001` (1536d) | Consistent with existing Libris knowledge base |

**Hard rule**: Haiku does all classification. Never use Sonnet or Opus to decide a document type,
extract a title, or tag a chunk. These are deterministic enough for Haiku with a tight tool schema.

---

## Context Layer Architecture

Every agent call must be structured into four layers. Layers 1 and 2 are cached.
Layers 3 and 4 are fresh per call.

```
┌─────────────────────────────────────────────────────┐
│ L1 — PROJECT INVARIANTS                             │  CACHED
│ Never changes. Loaded once per Worker cold start.   │  cache_control: ephemeral
│                                                     │
│ • What Libris is and isn't                          │
│ • Citation format rules                             │
│ • Hallucination prohibition                         │
│ • Source type taxonomy                              │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ L2 — AGENT ROLE                                     │  CACHED
│ Changes only when the agent's job changes.          │  cache_control: ephemeral
│                                                     │
│ • "You are the RAG agent. Your only job is..."      │
│ • Available tools + schemas                         │
│ • Output format contract                            │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ L3 — SESSION CONTEXT                                │  DYNAMIC
│ Summarised conversation history.                    │  No caching
│ Max 10 turns before summarisation.                  │
│                                                     │
│ • Summarised prior exchanges (not raw)              │
│ • Current session metadata                          │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ L4 — CURRENT INPUT                                  │  FRESH
│ The actual user nudge + retrieved chunks only.      │  No caching
│                                                     │
│ • User's current message                            │
│ • Top-k retrieved chunks (chunk_id + content)       │
│ • Nothing else                                      │
└─────────────────────────────────────────────────────┘
```

---

## Specialist Isolation Rules

Specialists (Haiku agents) must never see:

- Full conversation history
- Other specialists' outputs
- Raw document content beyond their assigned chunks
- User profile or preferences

The Orchestrator is the only agent with full context. It extracts what each specialist needs
and passes only that — as structured tool inputs, never as prose.

**Example — wrong:**
```
// Don't do this
await haikuAgent({ context: fullConversationHistory, task: "classify this document" })
```

**Example — right:**
```
// Correct
await haikuAgent({ document_text: first500chars, task_schema: classifyDocumentTool })
```

---

## Prompt Caching Implementation

Every stable system prompt must use two cache breakpoints:

```typescript
const messages = [
  {
    role: "user",
    content: [
      {
        type: "text",
        text: PROJECT_INVARIANTS,           // L1 — always first
        cache_control: { type: "ephemeral" }
      },
      {
        type: "text",
        text: agentRolePrompt,              // L2 — agent-specific
        cache_control: { type: "ephemeral" }
      },
      {
        type: "text",
        text: sessionContext,               // L3 — summarised history
      },
      {
        type: "text",
        text: currentInput,                // L4 — fresh
      }
    ]
  }
]
```

Cache hits reduce input token cost by ~90%. A 2,000-token system prompt cached across 100 daily
nudges saves ~180,000 input tokens per day.

---

## Conversation Summarisation

Never pass raw conversation history beyond 10 turns. After turn 10:

1. Call Haiku with `summarise_conversation` tool
2. Input: last 10 turns
3. Output: structured summary (topics, decisions, unresolved questions)
4. Replace the raw turns with the summary in L3
5. Start fresh turn counter

The summary is ~200 tokens. 10 raw turns are ~2,000 tokens. 90% reduction.

---

## Ingestion Token Budget

Ingestion happens offline (queue/workflow) — cost matters less than quality.
But follow these rules to avoid runaway costs on large libraries:

| Operation | Model | Max input tokens |
|---|---|---|
| Document classification | haiku-4-5 | 500 (first 500 chars) |
| Chapter summary generation | haiku-4-5 | 2,000 (TOC + context) |
| Key passage extraction | haiku-4-5 | 4,000 (one section) |
| Cross-source connection | sonnet-4-6 | 8,000 (multiple chunks) |

Never pass a full book or full article to any model. Chunk first, then process chunk by chunk.

---

## Development Token Discipline

Rules for Claude Code sessions working on this codebase:

1. **CLAUDE.md is the single source of truth** — do not re-explain the architecture in prompts
2. **SKILLS.md + AGENT_CONTRACTS.md** answer most "what should this agent do?" questions without a model call
3. **Never ask Claude to generate schema** — DATA_MODEL.md is pre-written
4. **Commit working code in small increments** — shorter diffs = cheaper reviews
5. **Use `claude-haiku-4-5` for code generation of boilerplate** — reserve Opus/Sonnet for architecture decisions
