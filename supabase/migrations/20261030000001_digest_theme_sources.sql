-- Store each digest theme's cited sources (title, author, chapter, url) so the
-- quiz can show where a question comes from. Written by the weekly digest.
alter table public.digest_themes add column if not exists sources jsonb;
