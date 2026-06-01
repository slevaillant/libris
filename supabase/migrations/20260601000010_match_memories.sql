create or replace function public.match_memories(
  p_user_id         uuid,
  p_query_embedding extensions.vector(1536),
  p_min_score       float default 0.92
)
returns table (
  memory_id        uuid,
  content          text,
  response_summary text,
  citations_used   jsonb,
  similarity       float
)
language sql stable security definer set search_path = extensions, public as $$
  select
    m.id,
    m.content,
    m.response_summary,
    m.citations_used,
    1 - cosine_distance(m.embedding, p_query_embedding) as similarity
  from public.user_memories m
  where
    m.user_id = p_user_id
    and m.memory_type = 'semantic_cache'
    and m.embedding is not null
    and (m.expires_at is null or m.expires_at > now())
    and m.confidence >= 0.3
    and 1 - cosine_distance(m.embedding, p_query_embedding) >= p_min_score
  order by similarity desc
  limit 1;
$$;
