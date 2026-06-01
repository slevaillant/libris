create table public.highlights (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  source_id   uuid        not null references public.sources(id) on delete cascade,
  chunk_id    uuid        references public.chunks(id) on delete set null,
  content     text        not null,
  note        text,
  chapter     text,
  page        int,
  created_at  timestamptz not null default now()
);

alter table public.highlights enable row level security;

create policy "own highlights" on public.highlights
  for all using (user_id = auth.uid());

create index on public.highlights (source_id);
create index on public.highlights (user_id, created_at desc);
