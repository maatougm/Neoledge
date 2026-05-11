-- Phase 9 — WorkPackage composite indexes for isDeleted filter paths.
--
-- Apply with:
--   C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-wp-indexes.sql
--
-- After applying, run:   cd web/back-nest && npx prisma generate

-- 1) Covers the most common list query: WHERE projectId = ? AND isDeleted = 0 [AND status = ?]
--    Replaces the need to post-filter isDeleted on the existing (projectId, status) index.
CREATE INDEX IF NOT EXISTS idx_wp_project_deleted_status ON WorkPackages (projectId, isDeleted, status);

-- 2) Covers the assignee-scoped query path: WHERE assigneeId = ? AND isDeleted = 0
--    Avoids a full-filter pass over the single-column assigneeId index.
CREATE INDEX IF NOT EXISTS idx_wp_assignee_deleted ON WorkPackages (assigneeId, isDeleted);
