-- 'tech_radar' rows store the weekly reading pick ("Beyond this week"):
-- theme_text = source title (used to avoid repeats), synthesis = why it matters.
alter table public.digest_themes drop constraint if exists digest_themes_theme_type_check;
alter table public.digest_themes
  add constraint digest_themes_theme_type_check
  check (theme_type in ('problem', 'decision', 'open_question', 'topic', 'tech_radar'));
