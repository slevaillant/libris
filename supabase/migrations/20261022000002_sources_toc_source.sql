-- Where a book's chapter list came from, so AI-reconstructed tables of contents can be
-- flagged as approximate and replaced by the real one.
--   screenshot   — read from a photo/screenshot of the book's contents page
--   open_library — Open Library edition data
--   web          — publisher or reliable listing, found via web search (toc_source_url)
--   ai_memory    — recalled by the model; may be inaccurate
-- null = unknown (books indexed before this column existed, or full-text books)
alter table public.sources
  add column if not exists toc_source     text check (toc_source in ('screenshot', 'open_library', 'web', 'ai_memory')),
  add column if not exists toc_source_url text;
