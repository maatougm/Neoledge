-- Phase 9 — Gantt / Agile / Wiki hardening migrations.
--
-- Apply with:
--   C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-gantt-baseline-unique.sql
--
-- After applying, run:   cd web/back-nest && npx prisma generate

-- 1) GanttBaseline — guarantee at most one snapshot row per (project, snapshotName, workPackage).
--    Re-capturing the same snapshotName now fails fast with P2002 instead of duplicating every row.
ALTER TABLE `GanttBaselines`
  ADD CONSTRAINT `uq_gantt_baseline_project_snapshot_wp`
  UNIQUE (`projectId`, `snapshotName`, `workPackageId`);

-- 2) Boards — guarantee unique name per project so the listBoards auto-create
--    falls back to a clean P2002 on a concurrent cold-start race.
ALTER TABLE `Boards`
  ADD CONSTRAINT `uq_board_project_name`
  UNIQUE (`projectId`, `name`);

-- 3) WikiPages — add a supporting index on (projectId, title) for search workloads
--    that currently scan LONGTEXT content. Title queries now hit an index.
CREATE INDEX `ix_wiki_page_project_title`
  ON `WikiPages` (`projectId`, `title`);
