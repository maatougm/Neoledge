-- Phase 4 / Stage 1.0 — enable pgvector extension.
-- Must precede any ADD COLUMN of `vector(N)` type. Idempotent.
-- See docs/agent-orchestra/PHASE_4_PGVECTOR_PLAN.md §1.4 for sequencing.

CREATE EXTENSION IF NOT EXISTS vector;
