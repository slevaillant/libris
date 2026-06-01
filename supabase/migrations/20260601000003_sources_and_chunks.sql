create table public.sources (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  source_type     text        not null check (source_type in (
                                'physical_book', 'ebook', 'pdf',
                                'substack', 'github_repo', 'web_article', 'highlight_only'
                              )),
  title           text        not null,
  author          text,
  isbn            text,
  url             text,
  publication_date date,
  shelf_location  text,
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
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.sources enable row level security;

create policy "own sources" on public.sources
  for all using (user_id = auth.uid());

create index on public.sources (user_id, source_type);
create index on public.sources (user_id, ingest_status);
create index on public.sources (user_id, last_ingested desc);

-- Chunks
create table public.chunks (
  id              uuid        primary key default gen_random_uuid(),
  source_id       uuid        not null references public.sources(id) on delete cascade,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  chunk_index     int         not null,
  content         text        not null,
  chapter_title   text,
  section_title   text,
  page_number     int,
  chunk_type      text        not null default 'passage' check (chunk_type in (
                                'chapter_summary', 'passage', 'highlight', 'key_idea'
                              )),
  embedding       extensions.vector(1536),
  indexed_at      timestamptz,
  token_count     int,
  created_at      timestamptz not null default now(),
  unique (source_id, chunk_index)
);

alter table public.chunks enable row level security;

create policy "own chunks" on public.chunks
  for all using (user_id = auth.uid());

create index on public.chunks using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);
create index on public.chunks (source_id);
create index on public.chunks (user_id, chunk_type);
