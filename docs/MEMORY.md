# Memory Layer Architecture

The memory layer is what separates a search engine from a librarian who knows you.
It serves two purposes: reducing token usage through semantic caching, and giving the
system the continuity that makes it feel like a relationship rather than a transaction.

---

## Four Memory Types

### M1 — Semantic Cache (token efficiency)

When a nudge arrives, its embedding is compared against past nudge embeddings before
any RAG pipeline is triggered. If similarity > 0.92, the cached response is returned
and enriched rather than regenerated from scratch.

**Flow:**
```
New nudge → embed → search past_nudges (similarity > 0.92?)
                          │
              YES          │           NO
               │           │            │
    Return cached response │     Full RAG pipeline
    + "Since last time,    │            │
       here's what's new"  │     Store result in cache
    (Haiku call only)      │     (async, non-blocking)
```

**Token cost comparison:**
| Path | Models called | Approx tokens |
|---|---|---|
| Cache miss (full pipeline) | Haiku + Sonnet + Opus | ~8,000 |
| Cache hit | Haiku only (enrich cached) | ~800 |

Cache similarity threshold is 0.92 by default. User can lower it to 0.85 for looser matching
(more cache hits, slightly less precision) via their profile settings.

---

### M2 — Episodic Memory (continuity)

After every completed nudge interaction, Haiku extracts and stores a memory:
*"When asked about X, sources Y and Z were most relevant. The user found Z particularly useful."*

This is retrieved at the start of every new session and injected into L3 context:

```typescript
// L3 context includes:
const sessionContext = `
Recent memory:
- 3 days ago you explored how to scale teams without losing speed. 
  Andy Grove and Lenny's Linear article were the most cited.
- Last week you asked twice about managing upward. 
  You may want to index more sources on this — coverage is thin.
- You're currently reading High Output Management (Chapter 6).
`
```

This is what makes the librarian say *"this connects to what you were wrestling with last week"*
without being asked.

**Storage**: `user_memories` table, `memory_type = 'episodic'`
**Retention**: 90 days, then summarised into a longer-term profile fact
**Size**: ~100–200 tokens per memory entry

---

### M3 — User Preference Memory (personalisation)

Preferences are extracted from interaction patterns and explicit feedback:

| Signal | Preference extracted |
|---|---|
| User clicks "Tell me more" on Grove quote 5 times | "Prefers Grove-style management frameworks" |
| User never follows up on theoretical/academic sources | "Prefers practitioner sources over academic" |
| User always asks for "the key chapter to read" | "Wants reading suggestions, not just passages" |
| User says "shorter please" once | "Prefers concise responses" |

These are stored as natural-language facts and injected into the **L2 system prompt** (cached).
They shape every response without costing extra tokens per call.

```typescript
const userPreferenceFacts = `
About this user:
- Strongly prefers practitioner sources (Grove, Horowitz, Lenny) over academic papers
- Wants a specific chapter recommendation with every response
- Prefers responses under 300 words unless they ask to go deeper
- Has a physical library of ~200 books, currently active in management and trading
- Checks the system in the morning (digest) and during/after important meetings (nudge)
`
// This block is cached — costs zero extra tokens after first call
```

**Storage**: `user_memories` table, `memory_type = 'preference'`
**Updated**: after every 10 interactions (Haiku re-analyses patterns)
**Size**: ~300 tokens total, cached

---

### M4 — Behavioural Pattern Memory (proactive intelligence)

Over time, the digest agent learns when and about what the user tends to ask:

| Pattern detected | System action |
|---|---|
| User asks leadership questions every Thursday | Pre-compute leadership digest Thursday evening |
| User asks trading questions on Monday mornings | Surface trading sources in Monday digest |
| User hasn't referenced a book in 60 days | "You haven't touched [Title] in 2 months — Chapter X might be relevant today" |
| User asks same question in different words | "You've explored this territory before. Want me to go deeper or try a new angle?" |

**Storage**: `user_memories` table, `memory_type = 'pattern'`
**Updated**: weekly (Haiku analyses last 30 days of interactions)

---

## Retrieval Strategy — Karpathy Principle Applied

The memory layer uses **two different retrieval strategies** depending on the memory type.
This is the key architectural decision: don't use the same tool for every problem.

### In-context loading (episodic, preference, pattern)

These memory types are small — 50–100 entries maximum, ~3,000–5,000 tokens total.
Rather than embedding-searching them (which introduces approximation), load them ALL
directly into L3 context and let the model's attention mechanism do the work.

This is Karpathy's "lean" principle: the model reading actual text is strictly better
than retrieving by embedding similarity. Only use a vector database when you have a
scale problem that forces you to.

```typescript
// Load all non-expired memories directly into context — no embedding needed
const memories = await supabase
  .from("user_memories")
  .select("memory_type, content, created_at, times_referenced")
  .eq("user_id", userId)
  .neq("memory_type", "semantic_cache")      // semantic_cache handled separately
  .gt("confidence", 0.3)
  .order("last_referenced", { ascending: false })
  .limit(60);                                 // ~4,000 tokens — fits in L3

// Inject as structured text into L3 context
const memoryBlock = formatMemoriesForContext(memories);
```

### pgvector search (semantic_cache only)

The semantic cache (M1) is the one memory type where embedding similarity is the
right tool — because the question IS "is this new query similar to a past query?"
That is genuinely a nearest-neighbour problem.

```typescript
// Semantic cache check — the only memory that uses pgvector
const cacheHit = await supabase.rpc("match_memories", {
  p_user_id: userId,
  p_query_embedding: queryEmbedding,
  p_min_score: 0.92
});
```

---

## Database Schema

```sql
create table public.user_memories (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  memory_type       text        not null check (
                                  memory_type in ('semantic_cache', 'episodic', 'preference', 'pattern')
                                ),
  content           text        not null,   -- natural language description of the memory
  -- embedding only populated for semantic_cache entries
  embedding         vector(1536),
  source_query      text,                    -- original nudge (semantic_cache only)
  response_summary  text,                    -- cached response (semantic_cache only)
  citations_used    jsonb,                   -- [{source_id, title, chapter}] (semantic_cache only)
  times_referenced  int         not null default 0,
  last_referenced   timestamptz,
  confidence        float       not null default 1.0,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- pgvector index only needed for semantic_cache entries
create index on public.user_memories using ivfflat (embedding vector_cosine_ops)
  with (lists = 50)
  where memory_type = 'semantic_cache';     -- partial index — only where needed

create index on public.user_memories (user_id, memory_type);
create index on public.user_memories (user_id, last_referenced desc);

alter table public.user_memories enable row level security;
create policy "own memories" on public.user_memories
  for all using (user_id = auth.uid());
```

---

## Memory Retrieval — Per-Call Protocol

```
1. Load preference + pattern memories → inject into L2 (cached block)
   Method: direct SQL load, no embedding
   Cost: ~500 tokens, cached after first call in session → effectively free

2. Load episodic memories → inject into L3
   Method: direct SQL load, top 20 by recency, no embedding
   Cost: ~1,000 tokens per session

3. Check semantic cache (M1) → embedding similarity search
   Method: pgvector match_memories RPC
   Cost: 1 Gemini embedding call + 1 pgvector query

4a. CACHE HIT  → Haiku enrichment → return (~800 tokens total)
4b. CACHE MISS → full RAG pipeline (~8,000 tokens total)

5. Store memories async (non-blocking — never delays response)
```

---

## Memory Decay

Not all memories stay equally relevant:

| Type | Decay rule |
|---|---|
| Semantic cache | Full confidence for 30 days, then re-verify against new chunks |
| Episodic | Summarised after 90 days ("In early 2026, you frequently explored team scaling") |
| Preference | Recalculated monthly from recent interactions |
| Pattern | Recalculated weekly |

Decay is implemented as a confidence score reduction. Below 0.3, memory is archived
(kept in DB for history, not loaded into context).

---

## Privacy

- `semantic_cache` entries contain the original query and response — encrypted at rest
- `episodic` entries are anonymised (no meeting participant names)
- All memory entries are scoped to `user_id` via RLS — never shared
- User can purge all memories from settings: `DELETE FROM user_memories WHERE user_id = auth.uid()`
