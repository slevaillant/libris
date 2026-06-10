# Data Model — Full Schema & RPC Definitions

All tables live in the `public` schema on Supabase (Postgres 15 + pgvector).
Every table has RLS enabled. Every query is scoped to `auth.uid()`.

---

## Entity Relationship Overview

```
auth.users
    │
    ├─── user_profiles          (1:1 — user settings, librarian name, preferences)
    ├─── user_memories          (1:N — semantic cache, episodic, preference, pattern)
    │
    ├─── sources                (1:N — books, substacks, github repos, web articles)
    │         │
    │         └─── chunks       (1:N — indexed, embedded passages from each source)
    │
    ├─── highlights             (1:N — user-added passages, linked to source)
    │
    ├─── nudges                 (1:N — on-demand queries, stored for memory layer)
    │         │
    │         └─── nudge_citations (1:N — which chunks were returned for each nudge)
    │
    ├─── digest_runs            (1:N — daily digest history)
    │         │
    │         └─── digest_themes  (1:N — extracted themes per digest)
    │
    └─── [bounty system]        (from Libris — see below)
         ├─── indexing_bounties
         ├─── indexing_sessions
         └─── invite_tokens
```

---

## Core Tables

### `user_profiles`
One row per user. Extended profile used to build the user model for Lumen.

```sql
create table public.user_profiles (
  user_id              uuid        primary key references auth.users(id) on delete cascade,
  display_name         text        not null,
  librarian_name       text        not null default 'Lumen',
  professional_context text,       -- "Building AI products, background in trading"
  reading_preferences  text,       -- "Prefer practitioner sources, want chapter refs"
  communication_style  text,       -- "Direct, concise, no fluff"
  current_books        text,       -- "High Output Management Ch.6, started 2 weeks ago"
  timezone             text        not null default 'Europe/Paris',
  digest_time          time        not null default '06:00',
  digest_enabled       boolean     not null default true,
  digest_email         text,
  semantic_cache_threshold float   not null default 0.92, -- lower = more cache hits
  topics_md            text,       -- raw TOPICS.md content synced via sync/push-topics.ts
  topics_updated_at    timestamptz,-- when topics_md was last pushed
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
create policy "own profile" on public.user_profiles for all using (user_id = auth.uid());
```

---

### `sources`
Every indexed source — physical book, e-book, Substack post, GitHub repo, web article.

```sql
create table public.sources (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  source_type     text        not null check (source_type in (
                                'physical_book',
                                'ebook',
                                'pdf',
                                'substack',
                                'github_repo',
                                'web_article',
                                'highlight_only'  -- physical book with no text, highlights only
                              )),
  title           text        not null,
  author          text,
  isbn            text,
  url             text,                           -- for web sources
  publication_date date,
  shelf_location  text,                           -- physical books only
  cover_url       text,
  description     text,
  total_chunks    int         not null default 0,
  last_ingested   timestamptz,
  ingest_status   text        not null default 'pending' check (ingest_status in (
                                'pending', 'processing', 'complete', 'failed', 'skipped'
                              )),
  ingest_error    text,
  is_read         boolean     not null default false,
  read_at         timestamptz,
  user_rating     int         check (user_rating between 1 and 5),
  tags            text[]      not null default '{}',
  authority_tier  int         not null default 3 check (authority_tier between 1 and 5),
                              -- 1 = user highlight, 2 = user read, 3 = auto-indexed
                              -- 4 = auto-discovered, 5 = AI-generated summary only
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.sources enable row level security;
create policy "own sources" on public.sources for all using (user_id = auth.uid());
create index on public.sources (user_id, source_type);
create index on public.sources (user_id, ingest_status);
create index on public.sources (user_id, last_ingested desc);
```

---

### `chunks`
The atomic unit of retrieval. One chunk = one embeddable, citable passage.

```sql
create table public.chunks (
  id              uuid        primary key default gen_random_uuid(),
  source_id       uuid        not null references public.sources(id) on delete cascade,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  chunk_index     int         not null,
  content         text        not null,
  chapter_title   text,
  section_title   text,
  page_number     int,                            -- PDFs only
  chunk_type      text        not null default 'passage' check (chunk_type in (
                                'chapter_summary',  -- AI-generated from TOC
                                'passage',          -- extracted from text
                                'highlight',        -- user-added
                                'key_idea'          -- AI-extracted from article
                              )),
  embedding       vector(1536),
  indexed_at      timestamptz,
  token_count     int,
  created_at      timestamptz not null default now(),
  unique (source_id, chunk_index)
);
alter table public.chunks enable row level security;
create policy "own chunks" on public.chunks for all using (user_id = auth.uid());
create index on public.chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index on public.chunks (source_id);
create index on public.chunks (user_id, chunk_type);
```

---

### `highlights`
User-added passages — the highest-authority content in the system.

```sql
create table public.highlights (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  source_id   uuid        not null references public.sources(id) on delete cascade,
  chunk_id    uuid        references public.chunks(id) on delete set null,
  content     text        not null,
  note        text,                               -- user's own annotation
  chapter     text,
  page        int,
  created_at  timestamptz not null default now()
);
alter table public.highlights enable row level security;
create policy "own highlights" on public.highlights for all using (user_id = auth.uid());
create index on public.highlights (source_id);
```

---

### `user_memories`
The memory layer — semantic cache, episodic, preference, and pattern memories.
See `docs/MEMORY.md` for full design rationale.

```sql
create table public.user_memories (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  memory_type       text        not null check (memory_type in (
                                  'semantic_cache', 'episodic', 'preference', 'pattern'
                                )),
  content           text        not null,         -- natural language summary of the memory
  -- embedding only populated for semantic_cache — other types loaded in-context (see MEMORY.md)
  embedding         vector(1536),
  source_query      text,                         -- original nudge (semantic_cache only)
  response_summary  text,                         -- cached response (semantic_cache only)
  citations_used    jsonb,                         -- [{source_id, title, chapter, chunk_id}]
  times_referenced  int         not null default 0,
  last_referenced   timestamptz,
  confidence        float       not null default 1.0,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.user_memories enable row level security;
create policy "own memories" on public.user_memories for all using (user_id = auth.uid());
-- Partial index: pgvector only on semantic_cache rows — episodic/preference/pattern use in-context loading
create index on public.user_memories using ivfflat (embedding vector_cosine_ops)
  with (lists = 50) where memory_type = 'semantic_cache';
create index on public.user_memories (user_id, memory_type);
create index on public.user_memories (user_id, last_referenced desc);
```

---

### `nudges`
Every on-demand query the user makes. Stored to feed the memory layer.

```sql
create table public.nudges (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  query_text    text        not null,
  themes        text[]      not null default '{}',      -- extracted by Haiku
  response_text text,                                    -- Lumen's synthesised response
  cache_hit     boolean     not null default false,      -- was memory M1 used?
  tokens_used   int,                                     -- total tokens for this nudge
  latency_ms    int,                                     -- end-to-end response time
  created_at    timestamptz not null default now()
);
alter table public.nudges enable row level security;
create policy "own nudges" on public.nudges for all using (user_id = auth.uid());
create index on public.nudges (user_id, created_at desc);
```

---

### `nudge_citations`
Which chunks were returned for each nudge. Used for relevance tracking.

```sql
create table public.nudge_citations (
  id          uuid        primary key default gen_random_uuid(),
  nudge_id    uuid        not null references public.nudges(id) on delete cascade,
  chunk_id    uuid        not null references public.chunks(id) on delete cascade,
  source_id   uuid        not null references public.sources(id) on delete cascade,
  relevance   float       not null,
  rank        int         not null,
  created_at  timestamptz not null default now()
);
alter table public.nudge_citations enable row level security;
create policy "own citations" on public.nudge_citations
  for all using (
    exists (select 1 from public.nudges n where n.id = nudge_id and n.user_id = auth.uid())
  );
```

---

### `digest_runs`
One row per daily digest generated.

```sql
create table public.digest_runs (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  run_date        date        not null,
  meetings_found  int         not null default 0,
  themes_found    int         not null default 0,
  citations_found int         not null default 0,
  email_sent      boolean     not null default false,
  email_sent_at   timestamptz,
  created_at      timestamptz not null default now(),
  unique (user_id, run_date)
);
alter table public.digest_runs enable row level security;
create policy "own digests" on public.digest_runs for all using (user_id = auth.uid());
```

---

### `digest_themes`
Extracted themes per digest (anonymised — no meeting names or participants).

```sql
create table public.digest_themes (
  id            uuid        primary key default gen_random_uuid(),
  digest_run_id uuid        not null references public.digest_runs(id) on delete cascade,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  theme_text    text        not null,             -- anonymised topic
  theme_type    text        not null check (theme_type in (
                              'problem', 'decision', 'open_question', 'topic'
                            )),
  synthesis     text,                             -- Lumen's synthesised response for this theme
  created_at    timestamptz not null default now()
);
alter table public.digest_themes enable row level security;
create policy "own digest themes" on public.digest_themes
  for all using (user_id = auth.uid());
```

---

### Bounty System (carried over from Libris)

```sql
-- Already documented in Libris — replicate as-is:
-- indexing_bounties, indexing_sessions, invite_tokens
-- + RPCs: upsert_bounty_config, create_invite_token_with_id,
--         redeem_invite, increment_session_book_count
-- See bookmarked-space/supabase/migrations/20260531000000_bounty_system.sql
```

---

## pgvector RPC Definitions

### `match_chunks` — Primary RAG search

```sql
create or replace function public.match_chunks(
  p_user_id        uuid,
  p_query_embedding vector(1536),
  p_match_count    int     default 8,
  p_source_types   text[]  default null,   -- null = all types
  p_min_score      float   default 0.70
)
returns table (
  chunk_id      uuid,
  source_id     uuid,
  source_type   text,
  title         text,
  author        text,
  chapter_title text,
  content       text,
  chunk_type    text,
  authority_tier int,
  similarity    float
)
language sql stable security definer set search_path = public
as $$
  select
    c.id                    as chunk_id,
    s.id                    as source_id,
    s.source_type,
    s.title,
    s.author,
    c.chapter_title,
    c.content,
    c.chunk_type,
    s.authority_tier,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from public.chunks c
  join public.sources s on s.id = c.source_id
  where
    c.user_id = p_user_id
    and c.embedding is not null
    and (p_source_types is null or s.source_type = any(p_source_types))
    and 1 - (c.embedding <=> p_query_embedding) >= p_min_score
  order by
    s.authority_tier asc,                          -- lower tier = higher priority
    1 - (c.embedding <=> p_query_embedding) desc
  limit p_match_count;
$$;
```

### `match_memories` — Semantic cache lookup

```sql
create or replace function public.match_memories(
  p_user_id        uuid,
  p_query_embedding vector(1536),
  p_memory_type    text    default 'semantic_cache',
  p_min_score      float   default 0.92
)
returns table (
  memory_id        uuid,
  content          text,
  response_summary text,
  citations_used   jsonb,
  similarity       float
)
language sql stable security definer set search_path = public
as $$
  select
    m.id,
    m.content,
    m.response_summary,
    m.citations_used,
    1 - (m.embedding <=> p_query_embedding) as similarity
  from public.user_memories m
  where
    m.user_id = p_user_id
    and m.memory_type = p_memory_type
    and (m.expires_at is null or m.expires_at > now())
    and m.confidence >= 0.3
    and 1 - (m.embedding <=> p_query_embedding) >= p_min_score
  order by similarity desc
  limit 1;
$$;
```

---

## Migration Order

```
001 — extensions (pgvector)
002 — user_profiles + trigger (auto-create on signup)
003 — sources + chunks
004 — highlights
005 — user_memories + indexes
006 — nudges + nudge_citations
007 — digest_runs + digest_themes
008 — bounty system (copy from Libris migration)
009 — match_chunks RPC
010 — match_memories RPC
011 — RLS policies (all tables)
```
