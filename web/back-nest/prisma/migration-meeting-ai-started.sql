-- Migration: add aiStartedAt column to MeetingTranscripts
-- Purpose: enables startup sweep to detect rows stuck in 'processing' state
-- Apply via:
--   C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-meeting-ai-started.sql

ALTER TABLE `MeetingTranscripts`
  ADD COLUMN `aiStartedAt` DATETIME(3) NULL AFTER `aiStatus`;
