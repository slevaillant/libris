# Security

Libris handles personal reading habits, meeting transcripts, financial interests,
and private highlights. Security is not an afterthought — it is a first-class constraint
that shapes the data model, the agent design, and every API call.

---

## Threat Model

| Threat | Mitigation |
|---|---|
| Another user reads your library | RLS on every table — all queries scoped to `auth.uid()` |
| Meeting content leaked | Granola transcripts never stored — processed in memory only |
| API keys exposed | Cloudflare secrets only — never in code, never in git |
| Service key deployed | Service key stays local — never in Workers environment |
| LLM hallucinates private data | Citation-first architecture — model only sees indexed chunks |
| Bounty indexer accesses wrong org | SECURITY DEFINER RPCs validate ownership before any write |

---

## Authentication

Supabase Auth with magic link (email OTP). No passwords.

The `requireSupabaseAuth` middleware on every server function:
1. Extracts `Authorization: Bearer <token>` from request headers
2. Creates a scoped Supabase client with that token
3. Validates token via `supabase.auth.getClaims(token)`
4. Injects `{ supabase, userId }` into handler context
5. Rejects with 401 if token missing, invalid, or expired

**Never bypass this middleware.** Every server function that touches user data must use it.

---

## Row Level Security

RLS is enabled on every table. No exceptions.
Every policy resolves to `auth.uid()` — never a hardcoded user ID.

```sql
-- Template for all user-owned tables
create policy "own [table]" on public.[table]
  for all using ([user_id_column] = auth.uid());
```

**Test RLS before every migration**: after creating a new table, verify that:
- A query with user A's JWT returns only user A's rows
- A query with no JWT returns zero rows
- A service-role query bypasses RLS (expected — service key is local-only)

---

## API Keys & Secrets

| Secret | Where it lives | Never in |
|---|---|---|
| `ANTHROPIC_API_KEY` | Cloudflare Workers secret | Code, git, `.env` committed |
| `GEMINI_API_KEY` | Cloudflare Workers secret | Code, git |
| `SUPABASE_URL` | Cloudflare Workers secret | — (not sensitive, but keep consistent) |
| `SUPABASE_PUBLISHABLE_KEY` | Cloudflare Workers secret | — (anon key, safe to expose) |
| `SUPABASE_SERVICE_KEY` | Local `.env.local` only | Workers, git, anywhere deployed |
| `GITHUB_TOKEN` | Cloudflare Workers secret | Code, git |

**`.env.local` is gitignored.** Verify this on project init:
```
echo ".env.local" >> .gitignore
```

The service key (`SUPABASE_SERVICE_KEY`) bypasses RLS entirely. It is used only by
local sync scripts that run on the user's machine, never by any deployed Worker.

---

## Granola / Meeting Data

This is the highest-sensitivity data in the system. Rules are absolute:

1. **Never store transcript text** — process in memory, discard immediately
2. **Never log transcript text** — no `console.log`, no error serialization of transcript content
3. **Anonymise before any DB write** — only extracted `topics` arrays, no names
4. **No verbatim quotes in digest** — synthesis only, never direct transcript excerpts
5. **User can purge digest themes** — `DELETE FROM digest_themes WHERE user_id = auth.uid()`

If Granola MCP returns an error, log the error code only — never the error message
(which may contain meeting content).

---

## Financial Data

If the user's library contains financial documents (trading journals, investment theses):

1. **Never log amounts, account numbers, or position sizes**
2. **Highlights containing numbers** are stored encrypted at the application level
   (future: Supabase Vault for column-level encryption)
3. **RAG responses** citing financial content include: "This is personal notes —
   not financial advice."

---

## Bounty Indexer Access

Bounty indexers are invited via single-use tokens and get `role = 'indexer'` membership.

What indexers CAN do:
- View books in the org's library
- Add new books (physical scan flow)
- See their own indexing session progress

What indexers CANNOT do:
- Read user highlights or notes
- Access Granola data or digest history
- Read chunks or embeddings
- Access user_memories or nudge history
- Change bounty configuration

RLS enforces this — the `highlights`, `user_memories`, `nudges`, `digest_*` tables
have no SELECT policy for `indexer` role members. Only `auth.uid() = user_id` policies.

---

## Open Source Considerations

Libris is designed to be open-sourced. Before any public release:

1. Audit for hardcoded values (user IDs, org IDs, email addresses)
2. Verify `.gitignore` covers all secret files
3. Add `SECURITY.md` notice to repo (responsible disclosure)
4. Ensure demo mode works without real API keys
5. Supabase project must be separate from personal project before open-sourcing

---

## Logging Rules (enforced in code review)

```typescript
// ❌ NEVER log these
console.log(transcript)
console.log(highlight.content)
console.log(chunk.content)
console.log(nudge.query_text)
console.log(amount, accountNumber)

// ✅ LOG these safely
console.log(`Ingested source ${sourceId}: ${chunkCount} chunks`)
console.log(`Digest run ${runId}: ${themeCount} themes, email_sent=${sent}`)
console.log(`Nudge ${nudgeId}: cache_hit=${cacheHit}, latency=${ms}ms`)
console.error(`Granola API error: ${error.code}`) // code only, not message
```
