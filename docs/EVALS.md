# Libris — Evaluation Framework

Libris's citation-first design makes evaluation concrete: every answer must trace to a specific indexed chunk, so there is always a ground truth to check against. Evaluations run at three layers — **Ingestion → Retrieval → Generation** — and must be checked in that order when something degrades.

---

## Evaluation Layers

```
Ingestion quality
  └─ Retrieval quality (match_chunks)
       └─ Generation quality (Lumen response)
```

Fix the foundation before optimising the floors. A hallucinated answer is usually a retrieval failure, not a generation failure.

---

## Metrics

### 1. Hallucination Rate
**Layer**: Generation  
**Target**: < 5%

Every factual claim in a response must be supported by a retrieved passage. Measure using Claude Sonnet as a judge:

> *"Given the retrieved passages and the generated response, does the response contain any factual claim not supported by those passages? Answer yes/no and quote the unsupported claim."*

```
Hallucination Rate = responses with ≥1 unsupported claim / total responses evaluated
```

Run against the golden set (`evals/golden_set.json`) on every PR that touches a prompt file.

**Failure signal**: Lumen citing general knowledge instead of library content; generation prompt not constraining the model tightly enough.

---

### 2. Precision@5 and MRR
**Layer**: Retrieval  
**Targets**: Precision@5 > 0.70 · MRR > 0.70

For each golden set question, manually label the expected chunks. Run `match_chunks` and compare:

```
Precision@5 = expected chunks in top 5 / 5
MRR         = average of (1 / rank of first expected chunk)
```

**Failure signal**: Wrong embedding model or chunk size; `p_min_score` threshold miscalibrated; authority tier weighting not boosting highlights over summaries.

---

### 3. Citation Rate and Coverage Quality
**Layer**: Retrieval → Generation  
**Targets**: Citation rate > 80% · `thin` coverage < 20% · avg citations per nudge > 1.5

Tracked automatically from `nudges` and `nudge_citations`:

```sql
-- Citation rate
SELECT
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM nudge_citations nc WHERE nc.nudge_id = n.id
  ))::float / COUNT(*) AS citation_rate
FROM nudges n
WHERE created_at > now() - interval '7 days';

-- Coverage quality breakdown
SELECT coverage_quality, COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () AS pct
FROM nudges
WHERE created_at > now() - interval '7 days'
GROUP BY coverage_quality;
```

**Failure signal**: Systematic library gap on a topic (→ prompt user to add sources); retrieval threshold too strict; ingestion failures leaving sources without embeddings.

---

### 4. Response Latency
**Layer**: System  
**Targets**: p50 < 2.5s · p95 < 5s · p99 < 8s

Tracked in `nudges.latency_ms`:

```sql
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99
FROM nudges
WHERE created_at > now() - interval '7 days';
```

**Failure signal**: Model latency regression after SDK update; embedding step slowing down; cache not warming up (check cache hit rate below).

---

### 5. Semantic Cache Hit Rate
**Layer**: System  
**Target**: > 20% after 30 days of use

```sql
SELECT
  COUNT(*) FILTER (WHERE cache_hit) * 100.0 / COUNT(*) AS cache_hit_rate
FROM nudges
WHERE created_at > now() - interval '30 days';
```

**Failure signal**: Similarity threshold too strict (`p_min_score = 0.92` in `match_memories`); cache entries expiring too quickly (30-day TTL).

---

### 6. Ingestion Success Rate
**Layer**: Ingestion  
**Target**: > 95%

```sql
SELECT
  ingest_status,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () AS pct
FROM sources
WHERE created_at > now() - interval '7 days'
GROUP BY ingest_status;
```

**Failure signal**: Source type parser breaking (RSS, YouTube, PDF); embedding API errors silently failing; network timeouts on external fetches.

---

### 7. Instruction Following Rate
**Layer**: Generation  
**Target**: < 2% non-compliant responses

Lumen's voice rules are checkable automatically. Banned openers: "Certainly", "Great question", "Of course", "Absolutely", "Sure". Check `nudges.response_text` with a regex scan weekly.

**Failure signal**: System prompt regression; prompt caching serving stale L1/L2 layers after an update.

---

### 8. Source Diversity Index (Herfindahl)
**Layer**: Retrieval  
**Target**: < 0.3 after 30+ sources indexed

A score near 1.0 means one source dominates all citations — the system is not synthesising across the library.

```sql
WITH citation_counts AS (
  SELECT source_id, COUNT(*) AS c
  FROM nudge_citations
  WHERE created_at > now() - interval '30 days'
  GROUP BY source_id
),
total AS (SELECT SUM(c) AS t FROM citation_counts)
SELECT ROUND(SUM((c::float / t)^2)::numeric, 3) AS herfindahl
FROM citation_counts, total;
```

**Failure signal**: One high-authority source (e.g. a heavily highlighted book) crowding out newer or lower-tier sources; chunking producing very large chunks that match everything.

---

### 9. Substack Feed Freshness
**Layer**: Ingestion  
**Target**: < 24h lag between publish and indexed

```sql
SELECT
  regexp_replace(url, '/p/.*$', '') AS newsletter,
  MAX(publication_date) AS latest_article,
  MAX(last_ingested::date) AS last_sync,
  MAX(last_ingested::date) - MAX(publication_date::date) AS lag_days
FROM sources
WHERE source_type = 'substack'
GROUP BY newsletter
ORDER BY lag_days DESC;
```

**Failure signal**: Cloudflare cron not firing; `SUPABASE_SERVICE_KEY` secret missing or rotated; RSS feed returning 429 rate-limit.

---

### 10. User Feedback Rate
**Layer**: Generation + Retrieval  
**Target**: helpful rate > 70% · unhelpful rate < 10%

Users rate each Lumen response via thumbs up/down in the chat UI. Stored in `nudges.helpful` (true/false/null). Especially valuable for physical books where chapter summaries are AI-recalled rather than extracted from real text.

```sql
SELECT
  COUNT(*) FILTER (WHERE helpful IS NOT NULL) AS rated,
  ROUND(COUNT(*) FILTER (WHERE helpful = true) * 100.0 /
    NULLIF(COUNT(*) FILTER (WHERE helpful IS NOT NULL), 0), 1) AS helpful_pct,
  ROUND(COUNT(*) FILTER (WHERE helpful = false) * 100.0 /
    NULLIF(COUNT(*) FILTER (WHERE helpful IS NOT NULL), 0), 1) AS unhelpful_pct,
  ROUND(COUNT(*) FILTER (WHERE helpful IS NOT NULL) * 100.0 / COUNT(*), 1) AS feedback_rate_pct
FROM nudges
WHERE created_at > now() - interval '30 days';
```

**Failure signal**: Unhelpful rate spiking on physical book queries → chapter summaries are hallucinated (fix: TOC photo scanning for accurate chapter extraction). Consistent thumbs-down on a specific source type → ingestion quality issue for that type.

**Physical book quality drill-down** — identify which books get the most negative feedback:
```sql
SELECT s.title, s.author, s.source_type,
  COUNT(*) FILTER (WHERE n.helpful = false) AS thumbs_down,
  COUNT(*) FILTER (WHERE n.helpful = true) AS thumbs_up
FROM nudges n
JOIN nudge_citations nc ON nc.nudge_id = n.id
JOIN sources s ON s.id = nc.source_id
WHERE n.helpful IS NOT NULL
GROUP BY s.title, s.author, s.source_type
ORDER BY thumbs_down DESC
LIMIT 20;
```

---

## Golden Dataset

Location: `evals/golden_set.json`  
Minimum size: 20 questions covering your most-used topics.

```json
[
  {
    "question": "What does Andy Grove say about one-on-ones?",
    "expected_source": "high output management",
    "expected_topics": ["one-on-one", "manager", "subordinate"],
    "should_not_contain": ["example of hallucinated claim"]
  }
]
```

Build the golden set before writing any eval code. Run it against the live system weekly. A regression on hallucination rate or Precision@5 blocks a deploy.

---

## Diagnostic Path (when something goes wrong)

```
User flags a response
  → check coverage_quality on the nudge
      → "thin": run match_chunks manually — were the right passages retrieved?
          → retrieval wrong: check source embedding status (ingest_status = 'complete'?)
          → retrieval correct but answer wrong: generation prompt needs tightening
      → "strong" but hallucinated: LLM ignoring context — tighten L1 constraint prompt
```

---

## Weekly SQL Dashboard

Run this in the Supabase SQL editor every week from Phase 6 onwards:

```sql
SELECT
  DATE_TRUNC('week', created_at) AS week,
  COUNT(*) AS nudges,
  ROUND(AVG(latency_ms)) AS avg_latency_ms,
  ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)) AS p95_latency_ms,
  ROUND(COUNT(*) FILTER (WHERE cache_hit) * 100.0 / COUNT(*), 1) AS cache_hit_pct,
  ROUND(COUNT(*) FILTER (WHERE coverage_quality = 'thin') * 100.0 / COUNT(*), 1) AS thin_pct
FROM nudges
WHERE created_at > now() - interval '8 weeks'
GROUP BY week
ORDER BY week DESC;
```

---

## Implementation Checklist (Phase 13)

- [ ] Add `coverage_quality` column to `nudges` table (migration)
- [ ] Add `flagged` column to `nudges` (user-triggered from chat UI)
- [ ] Build `evals/golden_set.json` — 20 questions, manual work
- [ ] Write `evals/run_evals.ts` — runs golden set, outputs precision / hallucination / latency
- [ ] Add golden set eval as required CI check on prompt-file PRs
- [ ] Weekly SQL dashboard saved as a named query in Supabase
- [ ] Set up spend alerts on Anthropic + Gemini dashboards
