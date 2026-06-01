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
  chapter_title  text,
  content        text,
  chunk_type     text,
  authority_tier int,
  similarity     float
)
language sql stable security definer set search_path = extensions, public as $$
  select
    c.id,
    s.id,
    s.source_type,
    s.title,
    s.author,
    c.chapter_title,
    c.content,
    c.chunk_type,
    s.authority_tier,
    1 - cosine_distance(c.embedding, p_query_embedding) as similarity
  from public.chunks c
  join public.sources s on s.id = c.source_id
  where
    c.user_id = p_user_id
    and c.embedding is not null
    and (p_source_types is null or s.source_type = any(p_source_types))
    and 1 - cosine_distance(c.embedding, p_query_embedding) >= p_min_score
  order by s.authority_tier asc, similarity desc
  limit p_match_count;
$$;
