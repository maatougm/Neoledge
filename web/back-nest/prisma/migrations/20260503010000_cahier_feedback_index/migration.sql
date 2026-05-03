-- Replace single-column indexes on CahierFeedback with one composite index
-- that matches the actual query shape: WHERE projectId = ? AND createdAt >= ?
-- (used by getCahierStatus to fetch feedback newer than the latest cahier save).

DROP INDEX IF EXISTS "CahierFeedback_projectId_idx";
DROP INDEX IF EXISTS "CahierFeedback_createdAt_idx";

CREATE INDEX "CahierFeedback_projectId_createdAt_idx"
  ON "CahierFeedback" ("projectId", "createdAt");
