-- Bounty system: lets owners invite indexers to physically scan their library

create table public.indexing_bounties (
  id               uuid        primary key default gen_random_uuid(),
  organization_id  uuid        not null references auth.users(id) on delete cascade,
  price_per_book   numeric(10,2) not null default 0.50,
  currency         text        not null default 'EUR',
  active           boolean     not null default true,
  payment_link     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id)
);

alter table public.indexing_bounties enable row level security;

create policy "own bounty" on public.indexing_bounties
  for all using (organization_id = auth.uid());

create table public.indexing_sessions (
  id               uuid        primary key default gen_random_uuid(),
  owner_user_id    uuid        not null references auth.users(id) on delete cascade,
  indexer_user_id  uuid        not null references auth.users(id) on delete cascade,
  price_per_book   numeric(10,2) not null,
  currency         text        not null,
  book_count       int         not null default 0,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  paid             boolean     not null default false,
  paid_at          timestamptz
);

alter table public.indexing_sessions enable row level security;

create policy "sessions visible to owner and indexer" on public.indexing_sessions
  for select using (owner_user_id = auth.uid() or indexer_user_id = auth.uid());

create policy "indexer can insert own session" on public.indexing_sessions
  for insert with check (indexer_user_id = auth.uid());

create policy "sessions update" on public.indexing_sessions
  for update using (owner_user_id = auth.uid() or indexer_user_id = auth.uid());

create table public.invite_tokens (
  id               uuid        primary key,
  owner_user_id    uuid        not null references auth.users(id) on delete cascade,
  role             text        not null default 'indexer',
  expires_at       timestamptz not null default (now() + interval '7 days'),
  used_at          timestamptz,
  used_by          uuid        references auth.users(id)
);

alter table public.invite_tokens enable row level security;

create policy "invite tokens readable by authenticated" on public.invite_tokens
  for select using (auth.uid() is not null);

-- RPCs

create or replace function public.upsert_bounty_config(
  p_user_id      uuid,
  p_price        numeric,
  p_currency     text,
  p_payment_link text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.indexing_bounties (organization_id, price_per_book, currency, payment_link, active)
  values (p_user_id, p_price, p_currency, p_payment_link, true)
  on conflict (organization_id) do update
    set price_per_book = excluded.price_per_book,
        currency       = excluded.currency,
        payment_link   = excluded.payment_link,
        active         = true,
        updated_at     = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_invite_token(
  p_token_id    uuid,
  p_owner_id    uuid
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_owner_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  insert into public.invite_tokens (id, owner_user_id, role)
  values (p_token_id, p_owner_id, 'indexer');
end;
$$;

create or replace function public.redeem_invite(
  p_token   uuid,
  p_user_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_token public.invite_tokens%rowtype;
begin
  select * into v_token from public.invite_tokens where id = p_token for update;
  if v_token is null then raise exception 'Invalid invite link'; end if;
  if v_token.used_at is not null then raise exception 'Invite already used'; end if;
  if v_token.expires_at < now() then raise exception 'Invite expired'; end if;
  update public.invite_tokens set used_at = now(), used_by = p_user_id where id = p_token;
  return jsonb_build_object('owner_user_id', v_token.owner_user_id, 'role', v_token.role);
end;
$$;

create or replace function public.increment_session_book_count(
  p_session_id uuid,
  p_user_id    uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update public.indexing_sessions
  set book_count = book_count + 1
  where id = p_session_id and indexer_user_id = p_user_id and ended_at is null
  returning book_count into v_count;
  if v_count is null then raise exception 'Session not found or already ended'; end if;
  return jsonb_build_object('book_count', v_count);
end;
$$;
