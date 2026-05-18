-- Migration: ProjectMembers table
-- Per-project team membership with a free-form label (e.g. "Lead Frontend", "QA")
-- Applied via: mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-project-members.sql

CREATE TABLE IF NOT EXISTS `ProjectMembers` (
  `id`        VARCHAR(36)  NOT NULL,
  `projectId` VARCHAR(36)  NOT NULL,
  `userId`    VARCHAR(36)  NOT NULL,
  `label`     VARCHAR(150) NOT NULL DEFAULT '',
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `project_member_uq` (`projectId`, `userId`),
  INDEX `idx_project_members_project` (`projectId`),
  INDEX `idx_project_members_user`    (`userId`),
  CONSTRAINT `fk_pm_project` FOREIGN KEY (`projectId`) REFERENCES `Projects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_pm_user`    FOREIGN KEY (`userId`)    REFERENCES `AppUsers`  (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
