-- Drop orphan tables: their owning modules were removed from the codebase but
-- the schema definitions persisted. Verified there are no remaining service
-- references via grep before this migration.
--
--   ProjectBudgets   + BudgetLineItems    — budgeting module deleted
--   Handovers        + HandoverCriteria   — handover module never shipped a controller
--   ActivityRacis                         — RACI matrix never shipped a controller
--   HourlyRates                           — only consumed by the deleted budget module

-- Drop in dependency order (children first), then parents.
DROP TABLE IF EXISTS "BudgetLineItems"  CASCADE;
DROP TABLE IF EXISTS "ProjectBudgets"   CASCADE;
DROP TABLE IF EXISTS "HandoverCriteria" CASCADE;
DROP TABLE IF EXISTS "Handovers"        CASCADE;
DROP TABLE IF EXISTS "ActivityRacis"    CASCADE;
DROP TABLE IF EXISTS "HourlyRates"      CASCADE;
