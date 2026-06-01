create table public.user_profiles (
  user_id              uuid        primary key references auth.users(id) on delete cascade,
  display_name         text        not null default '',
  librarian_name       text        not null default 'Lumen',
  professional_context text,
  reading_preferences  text,
  communication_style  text,
  current_books        text,
  timezone             text        not null default 'Europe/Paris',
  digest_time          time        not null default '06:00',
  digest_enabled       boolean     not null default true,
  digest_email         text,
  semantic_cache_threshold float   not null default 0.92,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

create policy "own profile" on public.user_profiles
  for all using (user_id = auth.uid());

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (user_id, display_name, digest_email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
