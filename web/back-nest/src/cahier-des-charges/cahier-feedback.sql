-- Migration: Add CahierFeedback table for AI learning from rejected documents
-- Run this SQL against your MySQL/MariaDB database

CREATE TABLE IF NOT EXISTS `CahierFeedback` (
  `id`          VARCHAR(36) NOT NULL,
  `projectId`   VARCHAR(36) NOT NULL,
  `userId`      VARCHAR(36) NULL,
  `status`      VARCHAR(20) NOT NULL DEFAULT 'rejected',  -- 'approved' | 'rejected'
  `comment`     TEXT        NOT NULL,                       -- User explanation of what was wrong
  `section`     VARCHAR(100) NULL,                          -- Which section was problematic (optional)
  `aiModel`     VARCHAR(50) NULL,                           -- Model that generated the rejected doc
  `createdAt`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_cahier_feedback_project` (`projectId`),
  INDEX `idx_cahier_feedback_created` (`createdAt`),
  CONSTRAINT `fk_cahier_feedback_project` FOREIGN KEY (`projectId`) REFERENCES `Projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cahier_feedback_user`    FOREIGN KEY (`userId`)    REFERENCES `AppUsers`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
