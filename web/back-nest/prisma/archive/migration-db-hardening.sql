-- Phase 9 — Database hardening migrations (indexes + unique constraints).
--
-- Apply with:
--   C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-db-hardening.sql
--
-- After applying, run:   cd web/back-nest && npx prisma generate

-- 1) Notifications — covering index for paginated unread list query:
--      WHERE userId = ? AND isRead = 0 ORDER BY createdAt DESC
--    Eliminates filesort on the unread notification feed.
CREATE INDEX IF NOT EXISTS idx_notif_user_read_created ON Notifications (userId, isRead, createdAt DESC);

-- 2) TranscriptSegments — FK lookup index so segment fetches for AI analysis
--    do not full-scan the entire TranscriptSegments table.
CREATE INDEX IF NOT EXISTS idx_segment_transcript ON TranscriptSegments (transcriptId);

-- 3) HourlyRates — unique constraint to prevent duplicate (userId, projectId, validFrom) rows.
--    CAVEAT: MySQL/MariaDB treats NULL as distinct in UNIQUE indexes. Two rows with
--    (userId, NULL, validFrom) are considered different by the DB engine and will both
--    be inserted without a constraint violation. Application code MUST use findFirst + create
--    (never prisma.upsert) when projectId is NULL to prevent duplicate global rates.
ALTER TABLE HourlyRates ADD CONSTRAINT uq_hourly_rate UNIQUE (userId, projectId, validFrom);

