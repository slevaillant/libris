-- match_chunks timed out once most chunks had an embedding (~20k): it computed
-- cosine_distance() for every row, which no vector index can serve.
-- 1. Replace the IVFFlat index (built while the table was nearly empty, so its lists
--    are useless) with HNSW, which needs no training data.
-- 2. Rewrite match_chunks to fetch nearest neighbours through the index first
--    (ORDER BY <=> LIMIT), then apply the authority-tier ranking on that shortlist.
--    Signature and output are unchanged.

-- Small instances have little shared memory: keep the HNSW build serial and modest
set maintenance_work_mem = '64MB';
set max_parallel_maintenance_workers = 0;

do $$
declare r record;
begin
  for r in
    select indexname from pg_indexes
    where schemaname = 'public' and tablename = 'chunks' and indexdef ilike '%ivfflat%'
  loop
    execute format('drop index public.%I', r.indexname);
  end loop;
end $$;

create index if not exists chunks_embedding_hnsw_idx
  on public.chunks using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.match_chunks(
  p_user_id         uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count     int    default 8,
  p_source_types    text[] default null,
  p_min_score       float  default 0.70
)
returns table (
  chunk_id       uuid,
  source_id      uuid,
  source_type    text,
  title          text,
  author         text,
  url            text,
  chapter_title  text,
  content        text,
  chunk_type     text,
  authority_tier int,
  similarity     float
)
language sql stable security definer
set search_path = extensions, public
set hnsw.ef_search = 200
as $$
  with nearest as (
    select c.id, c.source_id, c.chapter_title, c.content, c.chunk_type,
           c.embedding <=> p_query_embedding as distance
    from public.chunks c
    where c.user_id = p_user_id
      and c.embedding is not null
    order by c.embedding <=> p_query_embedding
    limit greatest(p_match_count * 10, 150)
  )
  select
    n.id,
    s.id,
    s.source_type,
    s.title,
    s.author,
    s.url,
    n.chapter_title,
    n.content,
    n.chunk_type,
    s.authority_tier,
    1 - n.distance as similarity
  from nearest n
  join public.sources s on s.id = n.source_id
  where (p_source_types is null or s.source_type = any(p_source_types))
    and 1 - n.distance >= p_min_score
  order by s.authority_tier asc, similarity desc
  limit p_match_count;
$$;
