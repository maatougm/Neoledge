# pgvector Semantic Retrieval — Production Implementation Plan

**Status:** approved plan, awaiting execution (Phase 4 in the agent-orchestra roadmap).
**Author:** architect agent fork, 2026-05-16.
**Top consumer:** `web/back-nest/src/cahier-des-charges/cahier-agent.ts`.
**Effort:** ~8 days focused, then 48 h monitor window before flipping the flag in prod.

---

## 0. TL;DR — decisions up front

| Question | Decision | Rationale |
|---|---|---|
| Embedding model | `intfloat/multilingual-e5-small`, 384-dim, self-hosted in the existing FastAPI service | French-native + bilingual FR/EN/AR matches meeting languages; CPU-only fits the 3 GB transcription container; zero ongoing cost; we already control the service. |
| Vector column type | `vector(384)` | Matches `multilingual-e5-small` output. Re-pick if we move to `bge-base` (768) or OpenAI ada-2 (1536). |
| Index | `HNSW` with `m=16, ef_construction=64`, build with `SET maintenance_work_mem='256MB'` | HNSW gives ~10x better recall than IVFFlat at 10k–100k rows; build is in-memory but NOT lock-blocking with `CREATE INDEX CONCURRENTLY`. |
| Distance op | Cosine (`<=>`) | Embedding models are L2-normalised by convention; cosine is the standard. |
| Postgres image | Switch from `postgres:16-alpine` to `pgvector/pgvector:pg16` | The alpine image does NOT ship pgvector. The official `pgvector/pgvector:pg16` is a thin layer on the canonical Postgres 16 image — same data directory layout, no migration needed. |
| Feature flag | `CAHIER_USE_SEMANTIC_RETRIEVAL` (default `off` until backfill done in prod) | One-line rollback. |
| Tools added | `read_relevant_meeting_excerpts`, `read_relevant_questionnaire` | Replace today's `read_meeting_segments` dump and supersede full `read_questionnaire` on sparse projects. |

---

## 1. Schema migration

### 1.1 Tables that gain a vector column

| Table | Column | Justification |
|---|---|---|
| `TranscriptSegments` | `embedding vector(384)` | Top consumer — used by cahier agent and (later) backlog generator. Granularity is a single speaker turn (`startTime`/`endTime`), which is the right "chunk" already. |
| `ProjectFieldValues` | `embedding vector(384)` | Questionnaire answers. Granularity = one `(projectId, projectFieldId)` answer. |
| `MeetingTranscripts` | `summaryEmbedding vector(384)` | Cheap meeting-level retrieval for "find the right meeting" before drilling into segments. `aiSummary` is already populated by `AiService.analyzeTranscript`. |

**Out of scope for Phase 1** (defer to Phase 2 / 3): `ProjectComment.content`, `WorkPackageComment.content`, `CahierFeedback.comment`, `WorkPackage.title`/`description`.

### 1.2 Index choice — HNSW

```sql
CREATE INDEX CONCURRENTLY idx_transcript_segment_embedding
  ON "TranscriptSegments" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

`CONCURRENTLY` is required so the migration does not block readers during backfill. Prisma's migration engine runs each migration in a transaction by default, and `CREATE INDEX CONCURRENTLY` is illegal inside a transaction — put `-- prisma:no-transaction` as the first line of the migration file (Prisma 5+ feature; verify 7 still supports it — if not, split the indexes into a third migration applied manually).

### 1.3 Cascade behavior

The embedding columns are added to existing tables, so cascade rules are inherited:
- `TranscriptSegments.transcript → MeetingTranscripts` already cascades. Deleting a meeting deletes its segments and their embeddings.
- `ProjectFieldValues.project → Projects` cascades.
- `MeetingTranscripts.project → Projects` cascades.

No additional FK plumbing needed.

### 1.4 Migration files (two)

1. **`prisma/migrations/<ts>_pgvector_extension/migration.sql`** — `CREATE EXTENSION IF NOT EXISTS vector;`. Must be its own migration so the cluster has the type definition before any `ADD COLUMN embedding vector(384)` lands.
2. **`prisma/migrations/<ts>_pgvector_columns_and_indexes/migration.sql`** — ALTER TABLEs + three `CREATE INDEX CONCURRENTLY`.

### 1.5 Prisma schema integration

Do NOT add the vector columns to `schema.prisma`. Mark the migration as out-of-band; all reads/writes go through `prisma.$queryRawUnsafe` or `prisma.$executeRawUnsafe` in a `VectorRepository`. Document the columns in `docs/DATABASE_SCHEMA.md` §17 under a new "Vector columns" subsection. Refuse `prisma migrate reset` in CI.

### 1.6 Container & image switch

Edit `deploy/neoleadge/docker-compose.prod.yml`:

```yaml
image: pgvector/pgvector:pg16   # was: postgres:16-alpine
```

Bump `mem_limit` `384m` → `1g`, `mem_reservation` `128m` → `256m`. The HNSW graph wants RAM. Data volume `neoleadge_db` is binary-compatible.

### 1.7 Zero-downtime sequence

1. Deploy image change first. Postgres restart picks up pgvector.
2. Apply migration 1 (CREATE EXTENSION). Idempotent.
3. Apply migration 2 (columns + indexes). `CONCURRENTLY` — no table lock.
4. Backfill runs (§3).
5. Deploy code that registers the new tools — feature-flagged off.
6. Flip `CAHIER_USE_SEMANTIC_RETRIEVAL=on`, kill+rm+up server.

---

## 2. Embedding provider choice

**Decision: self-hosted `intfloat/multilingual-e5-small` via the existing FastAPI transcription service.**

Why not the alternatives:
- **Z.AI text-embedding** — no documented OpenAI-compatible `/v1/embeddings` endpoint at the time of writing. 30-min spike to confirm before fully ruling out (§7.7).
- **OpenAI text-embedding-3-small** — clean but billing isn't set up, and we'd burn a separate API key with its own spend cap.
- **`bge-small-en-v1.5`** — English-only. Disqualifying.
- **`multilingual-e5-small`** — Native French + 99 other languages, 384-dim, ~110 MB model. The transcription container has 3 GB; this fits. Latency on CPU at int8: ~30 ms / 200-token segment.

Integration: add `POST /embed` to `web/Transcription/app.py`. Headers: `X-Transcription-Secret`. Body: `{texts: string[], input_type: "passage" | "query"}`. Returns `{embeddings: [[float, ...], ...], model: "multilingual-e5-small", dim: 384}`. Use `sentence-transformers`. Batch up to 64 per request. Separate `_embed_lock` so transcription and embedding run in parallel.

NestJS client: `web/back-nest/src/ai/embeddings/embeddings.service.ts`. Public API: `embed(texts: string[], inputType: 'passage' | 'query'): Promise<number[][]>`. `AbortSignal.timeout(30_000)`. Returns `Result.fail('embedding_unavailable')` when service is down. Logs an `AiUsage` row with `provider='local-e5'`, `feature='embed'`, `costEstimateUsd=0`.

---

## 3. Indexing pipeline

### 3.1 Real-time ingestion hooks

**Transcript segments.** After whisper finishes and segments are persisted:
1. Read just-inserted segments by `transcriptId`.
2. Group into batches of 64.
3. `EmbeddingsService.embed(texts, 'passage')`.
4. `UPDATE "TranscriptSegments" SET embedding = $1::vector WHERE id = $2`.
5. After all segments succeed, embed `meeting.aiSummary` once `AiService.analyzeTranscript` has populated it.

Both hooks fire-and-forget per project convention (`.catch((e) => logger.error(...))`).

**Questionnaire field values.** Hook the embedding update in the field-values service's `upsert` path. Single-flight pattern keyed by `${projectId}:${projectFieldId}`. Debounce 2 s.

Text to embed = `"${field.label}: ${value}"` (label gives semantic grounding; "oui" alone is meaningless).

### 3.2 Backfill command runner

`web/back-nest/src/commands/backfill-embeddings.ts` using `nest-commander`. Behavior:
- Idempotent (`WHERE embedding IS NULL`).
- Resumable — the filter IS the resume cursor.
- Batched (`--batch-size=64`, `--max-rows=10000`).
- Targeted (`--table=segments|field-values|summaries|all`, `--project-id=<uuid>`).
- Rate-limited (sleep 100 ms between batches).
- Progress reporting every 500 embeddings.
- `--dry-run`.

Invoke in prod:
```
docker exec -it neoleadge_server node dist/commands/backfill-embeddings.js \
  --table=all --batch-size=64
```

### 3.3 HNSW index build timing

Risk: building HNSW indexes on a populated 100k × 384-dim table takes ~5 min and is memory-hungry.

Mitigation: create indexes **before backfill** while columns are empty. HNSW supports incremental inserts (every row added through INSERT/UPDATE joins the graph immediately). Per-row insert cost ~1–5 ms — absorbed by the backfill rate limit.

---

## 4. New agent tools

### 4.1 `read_relevant_meeting_excerpts`

`web/back-nest/src/ai/agent/tools/semantic-meeting-tools.ts`.

Parameters:
- `query: string` (≥3 chars)
- `limit: int` (default 8, max 20)
- `minSimilarity: float` (default 0.35)

SQL:
```sql
SELECT s.id, s.text, s.speaker, s."startTime", s."endTime",
       m.id AS "meetingId", m.title AS "meetingTitle", m."createdAt",
       1 - (s.embedding <=> $1::vector) AS similarity
FROM "TranscriptSegments" s
JOIN "MeetingTranscripts" m ON m.id = s."transcriptId"
WHERE m."projectId" = $2
  AND s.embedding IS NOT NULL
  AND (1 - (s.embedding <=> $1::vector)) >= $3
ORDER BY s.embedding <=> $1::vector ASC
LIMIT $4
```

Redact PII before returning. Include meeting title + date + speaker so the model can cite.

### 4.2 `read_relevant_questionnaire`

`web/back-nest/src/ai/agent/tools/semantic-questionnaire-tools.ts`. Parameters: `query: string`, `limit: int` (default 6, max 15). Same shape as `read_questionnaire` plus a `similarity` float.

### 4.3 Registration

Both tools registered in `runCahierAgent` before the existing keyword fallbacks. Keep the old tools available so the model can fall back when semantic recall is poor.

---

## 5. Cahier prompt migration

Update the `Méthode` section in `cahier-agent.ts`:

```
4. POUR CHAQUE SECTION (Objectif, Contexte, Périmètre, Exigences, Architecture…) :
   a. Formule 1–3 questions ciblées sur la section.
   b. read_relevant_questionnaire (limit=4) — réponses pertinentes.
   c. read_relevant_meeting_excerpts (limit=6) — citations utiles.
   d. Si la recherche sémantique renvoie peu de hits (< 2 résultats par requête
      ou similarity < 0.35), retombe sur read_questionnaire(driverOnly=false)
      ou read_meeting_summaries pour ratisser plus large.
5. read_meeting_segments uniquement pour une citation exacte qu'aucune des
   étapes 4 n'a renvoyée.
```

Estimated context reduction: **~40% on sparse projects, 55–60% on dense ones** (15.5k → 9.4k tokens typical round-trip).

---

## 6. Verification plan

### 6.1 Retrieval correctness — golden eval

`scripts/eval-retrieval.mjs` + `scripts/fixtures/retrieval-golden.json` (~30 queries split across FR/AR/EN). Compute recall = `|expected ∩ topK| / |expected|`. Fail if mean recall < 0.7. Run weekly + after any embedding model change.

### 6.2 Production observability

- Latency histogram in `EmbeddingsService.embed`.
- Empty-result detection: each tool logs at warn when it returns zero hits despite a populated DB. Alert threshold: > 5% empty-hit rate / hour.
- `AiUsage` rows tagged `feature='embed'`.
- Nightly orphan check: `count(*) FROM "TranscriptSegments" WHERE embedding IS NULL AND "createdAt" < now() - interval '1 hour'`.

### 6.3 Rollback

Two-line rollback:
1. `CAHIER_USE_SEMANTIC_RETRIEVAL=off` in `.env.prod`.
2. `runCahierAgent` reverts to the pre-Phase-4 tool array.

Schema and indexes stay in place — free to keep, re-enable without re-backfilling.

If pgvector itself misbehaves: keep a backup of `neoleadge_db` from right before the migration; restore-and-revert-image in one shot.

---

## 7. Risks & open questions

1. **pgvector availability** — confirmed: alpine doesn't ship it; switch to `pgvector/pgvector:pg16`.
2. **HNSW build time** — mitigated by building empty, then backfilling.
3. **Embedding drift** — track per-row `embeddingModel`; if we switch models, add a `embedding_v2` column, backfill, swap, drop old.
4. **PII in transcripts** — embed POST-redaction (slight recall loss, cleanly compliant). Confirm with security reviewer.
5. **Multi-tenancy enforcement** — every tool handler's SQL MUST filter by `m."projectId" = $X`. Code review must flag this.
6. **Live-meeting copilot reuse** — deferred. Reuse after Phase 4 is stable.
7. **Z.AI embedding endpoint** — 30-min spike to check before ruling out (could simplify operations).
8. **Prisma drift** — vector columns are out-of-band; document in `prisma/README.md`, refuse `migrate reset` in CI.
9. **Container memory pressure** — stress-test concurrent transcribe + embed before flipping the flag.
10. **Cold-start latency** — pre-warm the embedding model in `lifespan` startup. Adds ~15 s boot.

---

## 8. Phase plan & sequencing

| # | Work | Estimate | Gate |
|---|---|---|---|
| 1.0 | Image swap + compose memory bump. `CREATE EXTENSION`. | 0.5 d | Postgres healthcheck green. |
| 1.1 | `/embed` endpoint in FastAPI + Dockerfile + warmup. | 1 d | `curl /embed` returns 384-dim vector. |
| 1.2 | NestJS `EmbeddingsService` + unit tests. | 0.5 d | ≥ 80% coverage. |
| 1.3 | Migration 2: columns + HNSW indexes on empty tables. Update `DATABASE_SCHEMA.md`. | 0.5 d | `\d "TranscriptSegments"` shows column + index. |
| 1.4 | Real-time hooks (post-transcribe, post-AI-analyze, post-field-value-save). | 1 d | New ingestion writes embeddings within 5 s of source insert. |
| 1.5 | Backfill command. | 1 d | Dev DB fully backfilled. |
| 1.6 | New agent tools + tests. | 1 d | Unit tests over raw SQL with seeded fixture. |
| 1.7 | Prompt update + integration test. | 0.5 d | End-to-end cahier produces 9 valid keys. |
| 1.8 | `eval-retrieval.mjs` + 30-query golden set + CI nightly. | 1 d | Mean recall ≥ 0.7. |
| 1.9 | Prod deployment: image, migrations, backfill, code-with-flag-off. | 0.5 d | All embeddings populated, flag still off. |
| 1.10 | Flip flag, monitor 48 h. | 0.5 d | No empty-hit alerts, latency stable, no spec-team regression. |

**Total: ~8 days focused work** plus monitor window.

---

## 9. Files touched (summary)

**New:**
- Two Prisma migrations under `web/back-nest/prisma/migrations/`.
- `web/back-nest/src/ai/embeddings/embeddings.{service,module}.ts`.
- `web/back-nest/src/ai/agent/tools/semantic-{meeting,questionnaire}-tools.ts`.
- `web/back-nest/src/commands/backfill-embeddings.ts` + `commands.module.ts`.
- `scripts/eval-retrieval.mjs` + `scripts/fixtures/retrieval-golden.json`.
- `web/back-nest/prisma/README.md`.

**Modified:**
- `deploy/neoleadge/docker-compose.prod.yml` — image swap, memory bump.
- `web/Transcription/app.py`, `requirements.txt`, `Dockerfile` — `/embed` endpoint + warmup.
- `web/back-nest/src/cahier-des-charges/cahier-agent.ts` — register new tools, update prompt, read flag.
- `web/back-nest/src/transcription/transcription.service.ts` — post-segment-insert hook.
- `web/back-nest/src/ai/ai.service.ts` — post-`aiSummary` hook.
- `web/back-nest/src/field-values/field-values.service.ts` — post-upsert hook.
- `web/back-nest/src/app.module.ts` — register new modules.
- `docs/DATABASE_SCHEMA.md` — new "Vector columns" subsection under §17.
