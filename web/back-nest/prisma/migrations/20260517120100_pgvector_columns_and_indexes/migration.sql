-- prisma:no-transaction
-- Phase 4 / Stage 1.3 — vector columns + HNSW indexes.
-- See docs/agent-orchestra/PHASE_4_PGVECTOR_PLAN.md §1.2-§1.4.
--
-- Vector columns are deliberately NOT in schema.prisma (Prisma 7 doesn't
-- type `vector` natively; we manage them via $queryRawUnsafe through a
-- thin VectorRepository). Documented in docs/DATABASE_SCHEMA.md §17.
--
-- HNSW indexes are built CONCURRENTLY so this migration does NOT block
-- readers. CONCURRENTLY is illegal inside a transaction, which is why
-- the top-level `-- prisma:no-transaction` directive is required.
--
-- Columns are nullable on purpose: the backfill command (Stage 1.5)
-- populates them; agent tools (Stage 1.6) filter `WHERE embedding IS NOT NULL`
-- so the system degrades gracefully while backfill is in flight.

ALTER TABLE "TranscriptSegments"  ADD COLUMN IF NOT EXISTS embedding vector(384);
ALTER TABLE "ProjectFieldValues"  ADD COLUMN IF NOT EXISTS embedding vector(384);
ALTER TABLE "MeetingTranscripts"  ADD COLUMN IF NOT EXISTS "summaryEmbedding" vector(384);

-- HNSW with cosine distance. Parameters tuned for the 10k–100k row scale
-- expected on this instance. m=16 gives a good speed/recall tradeoff up to
-- ~1M rows; ef_construction=64 is the default — higher = better recall but
-- longer build. We index on EMPTY tables (columns just added → all NULL),
-- so build is microseconds; subsequent INSERT/UPDATEs join the graph
-- incrementally at ~1-5 ms per row.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transcript_segment_embedding
  ON "TranscriptSegments" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_field_value_embedding
  ON "ProjectFieldValues" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_transcript_summary_embedding
  ON "MeetingTranscripts" USING hnsw ("summaryEmbedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
