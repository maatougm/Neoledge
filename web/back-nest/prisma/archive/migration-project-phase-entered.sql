-- ────────────────────────────────────────────────────────────────────────────
-- Phase 9 migration: add Projects.currentPhaseEnteredAt to prevent validation
-- replay across phase re-entry cycles. `hasRequiredApprovals` must filter on
-- `validatedAt >= currentPhaseEnteredAt` so stale approvals from a previous
-- traversal of the same phase can no longer satisfy the gate.
--
-- Apply with:
--   C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-project-phase-entered.sql
-- Then: cd web/back-nest && npx prisma generate
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE `Projects`
  ADD COLUMN IF NOT EXISTS `currentPhaseEnteredAt` DATETIME(3) NULL;

-- Back-fill existing rows so the replay guard does not retroactively invalidate
-- validations that are already considered authoritative. Using `createdAt`
-- preserves the original meaning of "approvals submitted while the project has
-- been in its current phase".
UPDATE `Projects`
   SET `currentPhaseEnteredAt` = `createdAt`
 WHERE `currentPhaseEnteredAt` IS NULL;
