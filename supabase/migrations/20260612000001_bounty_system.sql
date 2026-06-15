-- ── Bounty system ────────────────────────────────────────────────────
-- Single-user design: the library owner sets a bounty, shares invite
-- links to indexers, and tracks sessions + payments.

-- Bounty configuration (one per owner)
create table public.bounty_configs (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  price_per_book numeric     not null default 0.50,
  currency       text        not null default 'EUR',
  active         boolean     not null default true,
  payment_link   text,
  updated_at     timestamptz not null default now(),
  unique (user_id)
);

alter table public.bounty_configs enable row level security;
create policy "own bounty config" on public.bounty_configs
  for all using (user_id = auth.uid());

-- Single-use invite tokens (owner creates, indexer redeems)
create table public.indexer_invites (
  id            uuid        primary key default gen_random_uuid(),
  owner_user_id uuid        not null references auth.users(id) on delete cascade,
  expires_at    timestamptz not null default now() + interval '7 days',
  redeemed_by   uuid        references auth.users(id),
  redeemed_at   timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.indexer_invites enable row level security;
-- Owner can read/create their invites; redemption goes through RPC
create policy "owner manages invites" on public.indexer_invites
  for all using (owner_user_id = auth.uid());

-- Tracks which indexers have access to which library
create table public.indexer_memberships (
  id              uuid        primary key default gen_random_uuid(),
  owner_user_id   uuid        not null references auth.users(id) on delete cascade,
  indexer_user_id uuid        not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (owner_user_id, indexer_user_id)
);

alter table public.indexer_memberships enable row level security;
create policy "owner sees memberships"  on public.indexer_memberships
  for select using (owner_user_id = auth.uid());
create policy "indexer sees own memberships" on public.indexer_memberships
  for select using (indexer_user_id = auth.uid());

-- Indexing sessions (one per visit to the library)
create table public.indexing_sessions (
  id              uuid        primary key default gen_random_uuid(),
  owner_user_id   uuid        not null references auth.users(id) on delete cascade,
  indexer_user_id uuid        not null references auth.users(id) on delete cascade,
  price_per_book  numeric     not null,
  currency        text        not null,
  book_count      int         not null default 0,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  paid            boolean     not null default false,
  paid_at         timestamptz
);

alter table public.indexing_sessions enable row level security;
create policy "owner sees all sessions"  on public.indexing_sessions
  for select using (owner_user_id = auth.uid());
create policy "owner updates sessions"   on public.indexing_sessions
  for update using (owner_user_id = auth.uid());
create policy "indexer manages own sessions" on public.indexing_sessions
  for all using (indexer_user_id = auth.uid());

create index on public.indexing_sessions (owner_user_id);
create index on public.indexing_sessions (indexer_user_id);

-- ── RPCs (SECURITY DEFINER — bypass RLS for cross-user writes) ────────

-- Redeem an invite: validate token, create membership, return owner_user_id
create or replace function public.redeem_indexer_invite(p_token uuid, p_user_id uuid)
returns uuid language plpgsql security definer as $$
declare
  v_invite record;
begin
  select * into v_invite from public.indexer_invites
  where id = p_token
    and redeemed_by is null
    and expires_at > now();

  if not found then
    raise exception 'Invite not found or already used';
  end if;

  update public.indexer_invites
  set redeemed_by = p_user_id, redeemed_at = now()
  where id = p_token;

  insert into public.indexer_memberships (owner_user_id, indexer_user_id)
  values (v_invite.owner_user_id, p_user_id)
  on conflict (owner_user_id, indexer_user_id) do nothing;

  return v_invite.owner_user_id;
end;
$$;

-- Atomically increment a session's book_count (indexer-owned session only)
create or replace function public.increment_session_book_count(p_session_id uuid, p_user_id uuid)
returns int language plpgsql security definer as $$
declare
  v_count int;
begin
  update public.indexing_sessions
  set book_count = book_count + 1
  where id = p_session_id and indexer_user_id = p_user_id
  returning book_count into v_count;

  if not found then
    raise exception 'Session not found or not owned by this indexer';
  end if;

  return v_count;
end;
$$;

-- Create a source (physical_book) as the library owner
create or replace function public.indexer_create_source(
  p_session_id    uuid,
  p_indexer_id    uuid,
  p_title         text,
  p_author        text,
  p_isbn          text,
  p_cover_url     text,
  p_shelf_location text
) returns uuid language plpgsql security definer as $$
declare
  v_owner uuid;
  v_source_id uuid;
begin
  select owner_user_id into v_owner from public.indexing_sessions
  where id = p_session_id and indexer_user_id = p_indexer_id and ended_at is null;

  if not found then
    raise exception 'Invalid or already-ended session';
  end if;

  insert into public.sources (
    user_id, source_type, title, author, isbn,
    cover_url, shelf_location, ingest_status, authority_tier
  ) values (
    v_owner, 'physical_book', p_title, p_author, p_isbn,
    p_cover_url, p_shelf_location, 'processing', 3
  )
  returning id into v_source_id;

  return v_source_id;
end;
$$;

-- Bulk-insert chapter summary chunks as the library owner
create or replace function public.indexer_create_chunks(
  p_session_id uuid,
  p_indexer_id uuid,
  p_source_id  uuid,
  p_chunks     jsonb
) returns void language plpgsql security definer as $$
declare
  v_owner uuid;
  v_item  jsonb;
begin
  select owner_user_id into v_owner from public.indexing_sessions
  where id = p_session_id and indexer_user_id = p_indexer_id;

  if not found then
    raise exception 'Invalid session';
  end if;

  for v_item in select * from jsonb_array_elements(p_chunks) loop
    insert into public.chunks (
      source_id, user_id, chunk_index, content,
      chapter_title, chunk_type, embedding, indexed_at, token_count
    ) values (
      p_source_id,
      v_owner,
      (v_item->>'chunk_index')::int,
      v_item->>'content',
      v_item->>'chapter_title',
      'chapter_summary',
      case when v_item->>'embedding' is not null
           then (v_item->>'embedding')::vector(1536)
           else null end,
      now(),
      (v_item->>'token_count')::int
    );
  end loop;

  update public.sources
  set ingest_status  = 'complete',
      total_chunks   = jsonb_array_length(p_chunks),
      last_ingested  = now()
  where id = p_source_id;
end;
$$;
