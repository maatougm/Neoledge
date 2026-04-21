-- ─── Sprint 1: RACI methodology alignment ─────────────────────────────────────
-- Applied via: C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-sprint1-raci-phases.sql
-- NEVER run `prisma db push` on an existing database — use this file instead.

-- 1. Create Teams table
CREATE TABLE IF NOT EXISTS `Teams` (
  `id`            VARCHAR(36)  NOT NULL,
  `code`          VARCHAR(50)  NOT NULL,
  `name`          VARCHAR(200) NOT NULL,
  `managerUserId` VARCHAR(36)  NULL,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Teams_code_key` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Add teamId column to AppUsers (nullable, with FK)
ALTER TABLE `AppUsers`
  ADD COLUMN IF NOT EXISTS `teamId` VARCHAR(36) NULL AFTER `tokenVersion`;

-- 3. Add FK constraint (only if not already present)
SET @fk_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'AppUsers'
    AND CONSTRAINT_NAME = 'AppUsers_teamId_fkey'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE `AppUsers` ADD CONSTRAINT `AppUsers_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Teams`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Seed the 4 canonical RACI teams (idempotent)
INSERT IGNORE INTO `Teams` (`id`, `code`, `name`, `createdAt`) VALUES
  (UUID(), 'Cloud',       'Équipe Cloud',       NOW()),
  (UUID(), 'PS',          'Équipe PS',          NOW()),
  (UUID(), 'Integration', 'Équipe Intégration', NOW()),
  (UUID(), 'Delivery',    'Équipe Delivery',    NOW());

-- 5. Backfill teamId from legacy role values
-- DeploymentTeam → Cloud
UPDATE `AppUsers` u
JOIN   `Teams`    t ON t.code = 'Cloud'
SET    u.`teamId` = t.`id`
WHERE  u.`role` = 'DeploymentTeam' AND u.`teamId` IS NULL;

-- SpecificationTeam → PS
UPDATE `AppUsers` u
JOIN   `Teams`    t ON t.code = 'PS'
SET    u.`teamId` = t.`id`
WHERE  u.`role` = 'SpecificationTeam' AND u.`teamId` IS NULL;

-- RealizationTeam → Integration
UPDATE `AppUsers` u
JOIN   `Teams`    t ON t.code = 'Integration'
SET    u.`teamId` = t.`id`
WHERE  u.`role` = 'RealizationTeam' AND u.`teamId` IS NULL;

-- ProjectManager → Delivery
UPDATE `AppUsers` u
JOIN   `Teams`    t ON t.code = 'Delivery'
SET    u.`teamId` = t.`id`
WHERE  u.`role` = 'ProjectManager' AND u.`teamId` IS NULL;

-- 6. Remap Project.status from old values to new 8-phase canonical values
UPDATE `Projects` SET `status` = 'CadrageTechnique'  WHERE `status` = 'InProgress';
UPDATE `Projects` SET `status` = 'Parametrage'       WHERE `status` = 'SpecificationValidation';
UPDATE `Projects` SET `status` = 'Integration'       WHERE `status` = 'Realization';
UPDATE `Projects` SET `status` = 'MEP'               WHERE `status` = 'DeploymentValidation';
UPDATE `Projects` SET `status` = 'Cloture'           WHERE `status` = 'Completed';

-- 7. Remap ProjectValidation.phase similarly
UPDATE `ProjectValidations` SET `phase` = 'CadrageTechnique'  WHERE `phase` = 'InProgress';
UPDATE `ProjectValidations` SET `phase` = 'Parametrage'       WHERE `phase` = 'SpecificationValidation';
UPDATE `ProjectValidations` SET `phase` = 'Integration'       WHERE `phase` = 'Realization';
UPDATE `ProjectValidations` SET `phase` = 'MEP'               WHERE `phase` = 'DeploymentValidation';
UPDATE `ProjectValidations` SET `phase` = 'Cloture'           WHERE `phase` = 'Completed';
