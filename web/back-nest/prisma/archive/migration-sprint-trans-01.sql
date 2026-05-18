-- Sprint Transformation 01 — Foundations
-- Applied: 2026-04-24
-- Scope:
--   1. Backfill null Projects.projectManagerId with the first active PM.
--   2. Make Projects.projectManagerId NOT NULL.
--   3. Change AppUsers.role DEFAULT from 'Viewer' to 'Member'.
-- Note: Viewer + RealizationTeam → Member backfill already applied earlier in this sprint.

-- 1. Backfill orphan projects (1 row expected)
UPDATE Projects
SET projectManagerId = 'e8cc9e99-486c-4063-800c-9e9fcf365b27'
WHERE projectManagerId IS NULL;

-- 2. Enforce NOT NULL
ALTER TABLE Projects
  MODIFY COLUMN projectManagerId VARCHAR(191) NOT NULL;

-- 3. New default
ALTER TABLE AppUsers
  MODIFY COLUMN role VARCHAR(50) NOT NULL DEFAULT 'Member';

-- Verification (run manually):
-- SELECT COUNT(*) FROM Projects WHERE projectManagerId IS NULL;            -- expect 0
-- SHOW COLUMNS FROM Projects LIKE 'projectManagerId';                      -- expect Null=NO
-- SHOW COLUMNS FROM AppUsers LIKE 'role';                                  -- expect Default=Member
