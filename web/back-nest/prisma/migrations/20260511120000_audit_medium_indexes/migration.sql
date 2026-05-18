-- Audit follow-up — May 2026 (MEDIUM tier)
-- CahierFeedback (projectId, status) composite — the rejection-count and
-- approval-check queries filter on both columns; without the composite they
-- post-filter after the projectId range scan.

CREATE INDEX IF NOT EXISTS "CahierFeedback_projectId_status_idx"
  ON "CahierFeedback"("projectId", "status");
