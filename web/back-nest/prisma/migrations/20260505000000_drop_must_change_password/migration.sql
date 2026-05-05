-- Drop the mustChangePassword column from AppUsers.
-- The force-change-password flow has been removed; admin password resets
-- now generate a temp password without forcing a separate change step.
ALTER TABLE "AppUsers" DROP COLUMN IF EXISTS "mustChangePassword";
