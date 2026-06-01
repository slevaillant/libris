create table public.nudges (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  query_text    text        not null,
  themes        text[]      not null default '{}',
  response_text text,
  cache_hit     boolean     not null default false,
  tokens_used   int,
  latency_ms    int,
  created_at    timestamptz not null default now()
);

alter table public.nudges enable row level security;

create policy "own nudges" on public.nudges
  for all using (user_id = auth.uid());

create index on public.nudges (user_id, created_at desc);

-- Nudge citations
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

create policy "own nudge citations" on public.nudge_citations
  for all using (
    exists (
      select 1 from public.nudges n
      where n.id = nudge_id and n.user_id = auth.uid()
    )
  );
