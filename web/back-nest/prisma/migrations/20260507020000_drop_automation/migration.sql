-- Drop the dynamic automation rules engine.
--
-- The AutomationRule + AutomationLog tables backed an admin-configurable
-- "trigger -> action" engine that was never fully shipped to end-users.
-- All hardcoded notification flows that used to ride on it (cahier
-- generated -> spec team, validation approved -> deploy team, WP
-- assigned -> assignee, etc.) live in their respective services now and
-- continue to work without it.
--
-- Verified prior to migration: 0 rows in either table on the test
-- database, no service-layer references after the code change.

DROP TABLE IF EXISTS "AutomationLog"   CASCADE;
DROP TABLE IF EXISTS "AutomationRules" CASCADE;
