-- ─── Sprint 3: Deliverables & signed PV (signed artifacts per phase) ─────────
-- Applied via: C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-sprint3-deliverables.sql
-- NEVER run `prisma db push` on an existing database — use this file instead.

CREATE TABLE IF NOT EXISTS `Deliverables` (
  `id`                VARCHAR(36)   NOT NULL,
  `projectId`         VARCHAR(36)   NOT NULL,
  `phase`             VARCHAR(40)   NOT NULL,
  `type`              VARCHAR(40)   NOT NULL COMMENT 'CR_Lancement|FicheTechnique|Spec|PV_Recette|PV_MEP|PV_Cloture|Other',
  `title`             VARCHAR(255)  NOT NULL,
  `description`       TEXT          NULL,
  `fileUrl`           VARCHAR(500)  NULL,
  `mimeType`          VARCHAR(80)   NULL,
  `status`            VARCHAR(20)   NOT NULL DEFAULT 'Draft' COMMENT 'Draft|Submitted|Signed|Rejected',
  `submittedAt`       DATETIME(3)   NULL,
  `submittedByUserId` VARCHAR(36)   NULL,
  `signedAt`          DATETIME(3)   NULL,
  `signedByName`      VARCHAR(255)  NULL,
  `signedByEmail`     VARCHAR(255)  NULL,
  `signatureDataUrl`  MEDIUMTEXT    NULL,
  `rejectionReason`   TEXT          NULL,
  `isDeleted`         TINYINT(1)    NOT NULL DEFAULT 0,
  `deletedAt`         DATETIME(3)   NULL,
  `createdAt`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `Deliverables_projectId_phase_idx` (`projectId`, `phase`),
  INDEX `Deliverables_projectId_idx` (`projectId`),
  INDEX `Deliverables_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
