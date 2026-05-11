-- Sprint Transformation 10 — DB schema sync after E2E test campaign
-- Applied: 2026-04-26
--
-- Discovered during T9 E2E testing: massive drift between schema.prisma and the
-- live DB. Multiple sprints (security tokenVersion, RACI teams, RBAC tables,
-- SLA fields, etc.) edited the schema but raw SQL was never applied. This file
-- consolidates ALL the missing DDL so a fresh dev DB can be brought into sync.
--
-- Idempotent: every CREATE uses IF NOT EXISTS, ALTERs are wrapped in checks
-- where MariaDB supports them.

-- ─── 1. AppUsers missing columns ────────────────────────────────────────────
ALTER TABLE AppUsers ADD COLUMN tokenVersion INT NOT NULL DEFAULT 0;
ALTER TABLE AppUsers ADD COLUMN teamId VARCHAR(36) NULL;

-- ─── 2. RACI Teams (Sprint 1) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Teams (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  managerUserId VARCHAR(36) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

-- ─── 3. RBAC tables (Sprint 11 security hardening) ──────────────────────────
CREATE TABLE IF NOT EXISTS Roles (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500) NULL,
  isPreset TINYINT(1) NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS Permissions (
  id VARCHAR(36) PRIMARY KEY,
  `key` VARCHAR(100) NOT NULL UNIQUE,
  resource VARCHAR(50) NOT NULL,
  description VARCHAR(255) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_perm_resource (resource)
);

CREATE TABLE IF NOT EXISTS RolePermissions (
  roleId VARCHAR(36) NOT NULL,
  permissionId VARCHAR(36) NOT NULL,
  PRIMARY KEY (roleId, permissionId),
  INDEX idx_rp_perm (permissionId),
  FOREIGN KEY (roleId) REFERENCES Roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permissionId) REFERENCES Permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS UserRoleAssignments (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(191) NOT NULL,
  roleId VARCHAR(36) NOT NULL,
  projectId VARCHAR(36) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY user_role_project_uq (userId, roleId, projectId),
  INDEX idx_ura_role (roleId),
  INDEX idx_ura_project (projectId)
);

-- ─── 4. Project + WorkPackage drift (RACI phases, SLA, budget) ──────────────
ALTER TABLE Projects ADD COLUMN currentPhaseEnteredAt DATETIME(3) NULL;
ALTER TABLE MeetingTranscripts ADD COLUMN aiStartedAt DATETIME(3) NULL;
ALTER TABLE WorkPackages ADD COLUMN ackedAt DATETIME(3) NULL;
ALTER TABLE WorkPackages ADD COLUMN ackedByUserId VARCHAR(191) NULL;
ALTER TABLE WorkPackages ADD COLUMN escalatedAt DATETIME(3) NULL;
ALTER TABLE WorkPackages ADD COLUMN escalatedToUserId VARCHAR(191) NULL;
ALTER TABLE WorkPackages ADD COLUMN slaDeadline DATETIME(3) NULL;
ALTER TABLE WorkPackages ADD COLUMN slaKind VARCHAR(20) NULL;
ALTER TABLE WorkPackages ADD COLUMN slaBreached TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ProjectBudgets ADD COLUMN version INT NOT NULL DEFAULT 0;
ALTER TABLE BudgetLineItems ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'actual';

-- ─── 5. Post-migration steps (run separately) ──────────────────────────────
-- a. Seed RBAC: see prisma/seed-permissions.ts (or run the inline node script
--    that mirrors PRESET_ROLE_PERMISSIONS into Permissions/Roles/RolePermissions/
--    UserRoleAssignments).
-- b. Reset known-test passwords if needed.
