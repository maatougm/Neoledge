-- Drop the legacy admin-controlled gate flag for PM custom fields.
--
-- Authorization is now driven server-side: POST /pm/projects/:id/fields
-- requires the caller to be the project's PM (or Admin) — the
-- `allowManagerCustomFields` boolean became dead state. The associated
-- admin endpoint (PATCH /admin/project/:id/toggle-manager-fields) is
-- removed in the same change.

ALTER TABLE "Projects" DROP COLUMN IF EXISTS "allowManagerCustomFields";
