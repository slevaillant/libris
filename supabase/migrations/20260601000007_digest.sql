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

create policy "own digest runs" on public.digest_runs
  for all using (user_id = auth.uid());

create table public.digest_themes (
  id            uuid        primary key default gen_random_uuid(),
  digest_run_id uuid        not null references public.digest_runs(id) on delete cascade,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  theme_text    text        not null,
  theme_type    text        not null check (theme_type in (
                              'problem', 'decision', 'open_question', 'topic'
                            )),
  synthesis     text,
  created_at    timestamptz not null default now()
);

alter table public.digest_themes enable row level security;

create policy "own digest themes" on public.digest_themes
  for all using (user_id = auth.uid());

create index on public.digest_themes (digest_run_id);
