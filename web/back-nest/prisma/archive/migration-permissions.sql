-- ────────────────────────────────────────────────────────────────────────────
-- Phase 1 migration: OpenProject-style permissions (data-driven roles)
-- Apply with:
--   C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-permissions.sql
-- Then: cd web/back-nest && npx prisma generate && npx tsx prisma/seed-permissions.ts
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Add tokenVersion to AppUsers so role changes invalidate in-flight JWTs.
--    MariaDB supports IF NOT EXISTS on ADD COLUMN.
ALTER TABLE `AppUsers`
  ADD COLUMN IF NOT EXISTS `tokenVersion` INT NOT NULL DEFAULT 0;

-- 2. Permissions — canonical permission key catalog.
CREATE TABLE IF NOT EXISTS `Permissions` (
  `id`          VARCHAR(191) NOT NULL,
  `key`         VARCHAR(100) NOT NULL,
  `resource`    VARCHAR(50)  NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Permissions_key_key` (`key`),
  KEY `Permissions_resource_idx` (`resource`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Roles — named bundles of permissions. `isPreset=true` means system-seeded
--    (cannot be deleted; can be cloned or edited with care).
CREATE TABLE IF NOT EXISTS `Roles` (
  `id`          VARCHAR(191) NOT NULL,
  `name`        VARCHAR(100) NOT NULL,
  `description` VARCHAR(500) NULL,
  `isPreset`    BOOLEAN      NOT NULL DEFAULT FALSE,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Roles_name_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. RolePermissions — which permissions a role grants.
CREATE TABLE IF NOT EXISTS `RolePermissions` (
  `roleId`       VARCHAR(191) NOT NULL,
  `permissionId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`roleId`, `permissionId`),
  KEY `RolePermissions_permissionId_idx` (`permissionId`),
  CONSTRAINT `RolePermissions_roleId_fkey`
    FOREIGN KEY (`roleId`) REFERENCES `Roles`(`id`) ON DELETE CASCADE,
  CONSTRAINT `RolePermissions_permissionId_fkey`
    FOREIGN KEY (`permissionId`) REFERENCES `Permissions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. UserRoleAssignments — projectId NULL = global; otherwise scoped to a project.
CREATE TABLE IF NOT EXISTS `UserRoleAssignments` (
  `id`        VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `roleId`    VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UserRoleAssignments_user_role_project_uq` (`userId`, `roleId`, `projectId`),
  KEY `UserRoleAssignments_roleId_idx` (`roleId`),
  KEY `UserRoleAssignments_projectId_idx` (`projectId`),
  CONSTRAINT `UserRoleAssignments_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `AppUsers`(`id`) ON DELETE CASCADE,
  CONSTRAINT `UserRoleAssignments_roleId_fkey`
    FOREIGN KEY (`roleId`) REFERENCES `Roles`(`id`) ON DELETE CASCADE,
  CONSTRAINT `UserRoleAssignments_projectId_fkey`
    FOREIGN KEY (`projectId`) REFERENCES `Projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
