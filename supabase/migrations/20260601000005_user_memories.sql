create table public.user_memories (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  memory_type       text        not null check (memory_type in (
                                  'semantic_cache', 'episodic', 'preference', 'pattern'
                                )),
  content           text        not null,
  -- embedding only populated for semantic_cache — others loaded in-context (see docs/MEMORY.md)
  embedding         extensions.vector(1536),
  source_query      text,
  response_summary  text,
  citations_used    jsonb,
  times_referenced  int         not null default 0,
  last_referenced   timestamptz,
  confidence        float       not null default 1.0,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.user_memories enable row level security;

create policy "own memories" on public.user_memories
  for all using (user_id = auth.uid());

-- Partial index: pgvector only on semantic_cache rows
create index on public.user_memories using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 50) where memory_type = 'semantic_cache';

create index on public.user_memories (user_id, memory_type);
create index on public.user_memories (user_id, last_referenced desc);
