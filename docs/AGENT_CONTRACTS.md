# Agent Contracts

Each agent has a single responsibility, a defined set of tools, and a strict
input/output contract. Agents communicate only through tool results — never prose.
The Orchestrator is the only agent with full context.

---

## Agent Stack Overview

```
OrchestratorAgent   (claude-opus-4-7)    — routes, synthesises, holds session state
      │
      ├── RAGAgent         (claude-sonnet-4-6)  — retrieval + passage selection
      ├── IngestionAgent   (claude-haiku-4-5)   — document processing pipeline
      ├── ClassifierAgent  (claude-haiku-4-5)   — document type + metadata extraction
      ├── MemoryAgent      (claude-haiku-4-5)   — memory read/write/summarisation
      └── DigestAgent      (claude-opus-4-7)    — Granola analysis + daily synthesis
```

---

## 1. OrchestratorAgent

**File**: `src/agents/orchestrator.agent.ts`
**Runtime**: Cloudflare Durable Object (stateful, one per user session)
**Model**: `claude-opus-4-7`
**Responsibility**: Receives user nudges, coordinates specialist agents in parallel,
synthesises results into a Lumen response with citations.

### State (Durable Object)
```typescript
type OrchestratorState = {
  userId: string;
  sessionStarted: string;           // ISO timestamp
  turnCount: number;
  conversationSummary: string;      // summarised after 10 turns
  recentNudgeIds: string[];         // last 5 nudge IDs for context
  userModel: UserModel;             // loaded once per session, cached
}
```

### Input
```typescript
type NudgeInput = {
  query: string;                    // user's raw nudge text
  sessionId: string;
}
```

### Tools available to Orchestrator
```typescript
extract_nudge_themes      // Haiku: extract topics from query text
check_memory_cache        // pgvector: semantic_cache similarity search only
load_session_memories     // SQL: direct in-context load of episodic/preference/pattern
search_knowledge_base     // RAG: parallel search across source types
synthesise_response       // Opus: build Lumen response from retrieved chunks
store_nudge_memory        // async: write new memory after response
summarise_conversation    // Haiku: compress turn history after turn 10
```

### Output
```typescript
type NudgeResponse = {
  response_text: string;            // Lumen's prose response
  citations: Citation[];            // [{source_id, title, author, chapter, chunk_id}]
  reading_suggestion: {
    source_id: string;
    title: string;
    chapter: string;
  } | null;
  cache_hit: boolean;
  tokens_used: number;
}
```

### Orchestration Flow
```
1. extract_nudge_themes (Haiku, parallel with step 2)
2. check_memory_cache   (pgvector M1 check)
   │
   ├── CACHE HIT  → synthesise_response (Haiku enrich) → return
   │
   └── CACHE MISS → search_knowledge_base (Sonnet, parallel by source type)
                        → synthesise_response (Opus)
                        → store_nudge_memory (async, non-blocking)
                        → return
```

### Failure modes
- Memory check fails → proceed to full RAG (log error, don't surface to user)
- RAG returns no results → Lumen responds honestly: "I don't have sources for this"
- Synthesis fails → return best single chunk with minimal framing
- All agents fail → return error: "Something went wrong — please try again"

---

## 2. RAGAgent

**File**: `src/agents/rag.agent.ts`
**Runtime**: Cloudflare Worker (stateless, called per nudge)
**Model**: `claude-sonnet-4-6`
**Responsibility**: Receives a query + extracted themes, searches pgvector,
selects the most relevant passages, returns structured chunk results.

### Input
```typescript
type RAGInput = {
  userId: string;
  queryEmbedding: number[];         // pre-computed by Orchestrator
  themes: string[];
  sourceTypeFilter?: string[];      // optional: restrict to book, substack, etc.
  maxResults?: number;              // default: 8
}
```

### Tools
```typescript
search_chunks          // calls match_chunks RPC
rank_passages          // re-ranks by authority_tier + recency + relevance
select_top_passages    // picks best 3–5 passages with justification
```

### Output
```typescript
type RAGResult = {
  passages: {
    chunk_id: string;
    source_id: string;
    source_type: string;
    title: string;
    author: string;
    chapter_title: string;
    content: string;
    relevance_score: float;
    authority_tier: number;
    selection_reason: string;       // why this chunk was selected
  }[];
  coverage_quality: 'strong' | 'partial' | 'thin';
}
```

### Ranking Logic
Passages are scored as: `relevance × authority_weight × recency_weight`

| authority_tier | weight |
|---|---|
| 1 (user highlight) | 1.5 |
| 2 (user read book) | 1.2 |
| 3 (auto-indexed) | 1.0 |
| 4 (auto-discovered) | 0.85 |
| 5 (AI summary only) | 0.70 |

Recency weight: 1.0 for books (timeless). For newsletters/articles: 1.2 if < 30 days, 0.9 if > 180 days.

---

## 3. IngestionAgent

**File**: `src/agents/ingestion.agent.ts`
**Runtime**: Cloudflare Workflow (durable, retry-safe)
**Model**: `claude-haiku-4-5`
**Responsibility**: Processes a single source document through the full ingestion pipeline.
One Workflow instance per source. Never fails the caller — errors are stored on the source row.

### Input
```typescript
type IngestionInput = {
  sourceId: string;
  sourceType: string;
  content?: string;                 // for text sources (ebook, article)
  url?: string;                     // for web sources (fetch inside Workflow)
  metadata: {
    title: string;
    author?: string;
    isbn?: string;
    publicationDate?: string;
  };
}
```

### Steps (Cloudflare Workflow steps — each retried independently)
```
Step 1: fetch_content
  → For URL sources: fetch + Readability parse
  → For file sources: receive content from caller
  Output: { raw_text: string, word_count: number }

Step 2: classify_and_chunk
  → ClassifierAgent: determine chunk strategy for this source type
  → Apply chunking (paragraph / section / chapter boundary)
  Output: { chunks: { content, chapter_title, section_title, chunk_index }[] }

Step 3: extract_key_ideas (articles/newsletters only)
  → Haiku: identify 3–5 standalone claims per article
  → Add as 'key_idea' chunk_type entries
  Output: { key_ideas: string[] }

Step 4: embed_chunks
  → Gemini embedding API, batched (20 chunks per request)
  → Non-fatal: if embedding fails, store chunk without embedding
  Output: { embedded_count: number, failed_count: number }

Step 5: store_chunks
  → Bulk insert into chunks table
  → Update source.ingest_status = 'complete', source.last_ingested = now()
  Output: { stored_count: number }
```

### Failure handling
- Step failures retry 3× with exponential backoff
- After 3 failures: `source.ingest_status = 'failed'`, `source.ingest_error = message`
- Embedding failure is non-fatal — chunk stored without vector (will be embedded on next run)
- Never throws to caller — all errors written to DB

---

## 4. ClassifierAgent

**File**: Inline within `src/agents/ingestion.agent.ts` (not a separate Durable Object)
**Model**: `claude-haiku-4-5`
**Responsibility**: Given a source type and first 500 chars of content,
determine the correct chunking strategy and extract structured metadata.

### Input
```typescript
type ClassifierInput = {
  source_type: string;
  title: string;
  author?: string;
  content_preview: string;          // first 500 characters
  has_toc: boolean;                 // for books
}
```

### Tool: `classify_source`
```typescript
{
  name: "classify_source",
  input_schema: {
    chunk_strategy: "paragraph" | "section" | "chapter" | "toc_based" | "key_ideas_only",
    content_type: "analysis" | "interview" | "listicle" | "news" | "reference" | "narrative",
    estimated_shelf_life: "permanent" | "long" | "medium" | "short",
    extraction_priority: "full_text" | "key_passages" | "summary_only",
    metadata: {
      detected_language: string,
      is_primary_source: boolean,    // original author vs aggregator
      domain_tags: string[]          // ["management", "AI", "trading", etc.]
    }
  }
}
```

---

## 5. MemoryAgent

**File**: `src/agents/memory.agent.ts`
**Runtime**: Cloudflare Worker (stateless)
**Model**: `claude-haiku-4-5`
**Responsibility**: Reads and writes the four memory types. Called by Orchestrator
before and after each nudge, and by the weekly pattern analysis cron.

### Operations

**read_session_memories** — called at session start
```typescript
Input:  { userId: string }
Output: {
  episodic: string;        // natural language block of last 20 episodes (in-context, no embedding)
  preferences: string;     // user preference facts block (~300 tokens, in-context)
  patterns: string;        // detected patterns relevant to time of day (in-context)
}
// Retrieval method: direct SQL load (no pgvector) — all three types fit in ~4,000 tokens
// See MEMORY.md — Karpathy in-context principle applies here
```

**write_episodic_memory** — called after each nudge (async)
```typescript
Input: {
  userId: string;
  nudgeId: string;
  queryText: string;
  themes: string[];
  citationsUsed: Citation[];
  responseQuality: 'strong' | 'partial' | 'thin';
}
// Haiku generates: "When asked about [topic], [sources] were most relevant."
// Stores in user_memories with embedding
```

**write_semantic_cache** — called after full RAG pipeline (async)
```typescript
Input: {
  userId: string;
  queryText: string;
  queryEmbedding: number[];
  responseSummary: string;
  citationsUsed: Citation[];
}
// Stores in user_memories, memory_type = 'semantic_cache'
```

**update_preferences** — called every 10 nudges (async)
```typescript
Input: { userId: string; recentNudgeIds: string[] }
// Haiku analyses patterns across recent nudges
// Updates preference memories
```

**analyse_patterns** — called weekly by cron
```typescript
Input: { userId: string }
// Haiku analyses 30 days of nudges + digest themes
// Updates pattern memories
// Generates: "coverage gap" flags for thin topic areas
```

---

## 6. DigestAgent

**File**: `src/agents/digest.agent.ts`
**Runtime**: Cloudflare Agents SDK scheduled task (runs at 06:00 user local time)
**Model**: `claude-haiku-4-5` (theme extraction) + `claude-opus-4-7` (synthesis)
**Responsibility**: Pulls yesterday's Granola meetings, extracts themes, searches
knowledge base, synthesises a morning digest email.

### Scheduled trigger
```typescript
// In digest.agent.ts
async onSchedule(scheduledTime: Date) {
  // Runs for all users with digest_enabled = true
  // Parallelise across users (one Workflow instance per user)
}
```

### Input (from Granola MCP)
```typescript
// No explicit input — agent fetches its own data from Granola MCP
// Uses: list_meetings(date = yesterday), get_meeting_transcript(id)
```

### Tools
```typescript
list_granola_meetings     // MCP: get yesterday's meetings
get_meeting_transcript    // MCP: full transcript for one meeting
extract_meeting_themes    // Haiku: anonymised theme extraction (see GRANOLA.md)
search_knowledge_base     // RAG: parallel search per theme
synthesise_digest         // Opus: build full digest from themes + chunks
send_digest_email         // Cloudflare Email: send to user.digest_email
store_digest_run          // DB: record digest_run + digest_themes
```

### Output
```typescript
type DigestOutput = {
  digest_run_id: string;
  sections: {
    theme: string;
    synthesis: string;
    citations: Citation[];
    reading_suggestion: { title: string; chapter: string } | null;
  }[];
  email_sent: boolean;
}
```

### Failure handling
- Granola API unavailable → skip digest, log, try next day
- No meetings yesterday → send brief: "No meetings captured yesterday. Here's something from your library worth revisiting: [serendipitous suggestion]"
- No knowledge base matches → honest digest: "Your library doesn't cover [theme] well yet. Consider adding [suggested source]."

---

## Inter-Agent Communication Rules

1. **All outputs are typed tool results** — never prose strings
2. **Orchestrator owns context** — specialists receive only what they need, extracted by Orchestrator
3. **All specialist calls are async-compatible** — Orchestrator calls RAGAgent and MemoryAgent in parallel where possible
4. **Errors are typed** — all agents return `{ ok: true, data: ... } | { ok: false, error: string }` — never throw to caller
5. **Memory writes are always async and non-blocking** — they never delay the user's response
6. **Embedding calls are always non-fatal** — store chunk/memory without vector if Gemini fails, retry on next ingestion pass
