alter table public.user_profiles
  add column if not exists topics_md         text,
  add column if not exists topics_updated_at timestamptz;
