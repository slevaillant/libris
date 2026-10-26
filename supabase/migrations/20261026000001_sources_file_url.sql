-- Link to the original file of an ebook (e.g. its Google Drive viewer URL), so the
-- reader can open the book at the cited passage's page.
alter table public.sources
  add column if not exists file_url text;
