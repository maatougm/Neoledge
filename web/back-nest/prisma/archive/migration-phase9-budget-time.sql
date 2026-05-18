-- ────────────────────────────────────────────────────────────────────────────
-- Phase 9 migration: budgeting & time-tracking hardening.
-- Apply with:
--   C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-phase9-budget-time.sql
-- Then: cd web/back-nest && npx prisma generate
-- ────────────────────────────────────────────────────────────────────────────

-- 1. ProjectBudgets.version — optimistic concurrency token.
--    Clients must send the last-seen version with PUT; a mismatch yields 409.
ALTER TABLE `ProjectBudgets`
  ADD COLUMN IF NOT EXISTS `version` INT NOT NULL DEFAULT 0;

-- 2. BudgetLineItems.kind — distinguish planned from actual spend so the
--    burn report stops double-counting planned line items as material spent.
--    Existing rows default to 'actual' to preserve prior behaviour for
--    already-created line items (safe default: they were previously counted
--    toward materialSpent regardless).
ALTER TABLE `BudgetLineItems`
  ADD COLUMN IF NOT EXISTS `kind` VARCHAR(16) NOT NULL DEFAULT 'actual';

CREATE INDEX IF NOT EXISTS `idx_bli_budget_kind` ON `BudgetLineItems` (`budgetId`, `kind`);
