-- Audit fixes — May 2026
-- Source: cross-audit report (security + database + code-quality).
-- Reduces full-table scans on hot tables, replaces Float on monetary columns,
-- adds missing FK constraints, and switches comment.updatedAt to @updatedAt.

-- ─── C5: ProjectActivity missing index on userId + composite index ────────────
CREATE INDEX IF NOT EXISTS "ProjectActivities_userId_idx"
  ON "ProjectActivities"("userId");
CREATE INDEX IF NOT EXISTS "ProjectActivities_projectId_createdAt_idx"
  ON "ProjectActivities"("projectId", "createdAt");

-- ProjectActivity.userId FK NoAction → SetNull so a user delete doesn't fail
-- on every audit row they ever touched.
ALTER TABLE "ProjectActivities"
  DROP CONSTRAINT IF EXISTS "ProjectActivities_userId_fkey";
ALTER TABLE "ProjectActivities"
  ADD  CONSTRAINT "ProjectActivities_userId_fkey"
       FOREIGN KEY ("userId") REFERENCES "AppUsers"("id")
       ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── C6: AiUsage.costEstimateUsd Float (DOUBLE PRECISION) → DECIMAL(12,6) ─────
-- IEEE 754 drift on SUM aggregates was reporting incorrect daily spend.
ALTER TABLE "AiUsages"
  ALTER COLUMN "costEstimateUsd" TYPE DECIMAL(12, 6)
  USING "costEstimateUsd"::DECIMAL(12, 6);

-- AiUsage.userId index — per-user cost grouping currently does a full scan.
CREATE INDEX IF NOT EXISTS "AiUsages_userId_idx"
  ON "AiUsages"("userId");

-- ─── H7: Team.managerUserId FK + index ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Teams_managerUserId_idx"
  ON "Teams"("managerUserId");

ALTER TABLE "Teams"
  ADD  CONSTRAINT "Teams_managerUserId_fkey"
       FOREIGN KEY ("managerUserId") REFERENCES "AppUsers"("id")
       ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── H8: WorkPackage SLA FK columns (ackedByUserId, escalatedToUserId) ───────
CREATE INDEX IF NOT EXISTS "WorkPackages_ackedByUserId_idx"
  ON "WorkPackages"("ackedByUserId");
CREATE INDEX IF NOT EXISTS "WorkPackages_escalatedToUserId_idx"
  ON "WorkPackages"("escalatedToUserId");

ALTER TABLE "WorkPackages"
  ADD  CONSTRAINT "WorkPackages_ackedByUserId_fkey"
       FOREIGN KEY ("ackedByUserId") REFERENCES "AppUsers"("id")
       ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "WorkPackages"
  ADD  CONSTRAINT "WorkPackages_escalatedToUserId_fkey"
       FOREIGN KEY ("escalatedToUserId") REFERENCES "AppUsers"("id")
       ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── H9: ProjectComment.updatedAt + WorkPackageComment.updatedAt → @updatedAt ─
-- Prisma's @updatedAt on the schema side handles auto-stamping on UPDATE; no
-- DB column type change is needed (TIMESTAMP(3) NULL is correct for both).
-- Backfill existing rows: anywhere updatedAt is currently NULL but the row
-- has been edited (createdAt < now()) we leave it NULL — only future writes
-- will get the auto-stamp. This is a forward-compatible change.
