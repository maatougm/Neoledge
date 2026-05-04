-- Sprint Transformation 05 — AI Backlog Generation
-- Applied: 2026-04-24
-- Scope: additive columns, all nullable / default false — backwards compatible.
--
-- 1. ProjectField.isBacklogDriver — when true, this question's answer feeds
--    the AI backlog-generation prompt.
-- 2. ProjectField.backlogHint — optional text hint shown to the IA and the PM
--    describing how the answer should shape the backlog.
-- 3. WorkPackage.aiGeneratedFrom — short tag identifying the source of an
--    AI-generated WP (e.g. 'questionnaire+cahier+meeting'). NULL for
--    manually created WPs.

ALTER TABLE ProjectFields
  ADD COLUMN isBacklogDriver TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN backlogHint     VARCHAR(500) NULL;

ALTER TABLE WorkPackages
  ADD COLUMN aiGeneratedFrom VARCHAR(100) NULL;

-- Verification (run manually):
-- SHOW COLUMNS FROM ProjectFields LIKE 'isBacklogDriver';   -- expect TINYINT(1)
-- SHOW COLUMNS FROM ProjectFields LIKE 'backlogHint';       -- expect VARCHAR(500)
-- SHOW COLUMNS FROM WorkPackages LIKE 'aiGeneratedFrom';    -- expect VARCHAR(100)
