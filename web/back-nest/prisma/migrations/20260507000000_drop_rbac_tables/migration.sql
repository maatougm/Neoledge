-- Drop the dynamic RBAC stack. The four tables below served the per-role/
-- per-permission system that has been retired in favour of the simpler
-- AppUser.role + ProjectMember authorization model.
--
-- Pre-flight (Phase 0) backfilled every UserRoleAssignment(projectId IS NOT NULL)
-- and CahierFeedback validator into ProjectMember rows. Verified: no service
-- code references prisma.role / .permission / .userRoleAssignment.
--
-- Drop order: children first, then parents — the FK chain is
--   UserRoleAssignments -> { Roles, Permissions, AppUsers, Projects }
--   RolePermissions     -> { Roles, Permissions }
--   Roles, Permissions  (parents)

DROP TABLE IF EXISTS "UserRoleAssignments" CASCADE;
DROP TABLE IF EXISTS "RolePermissions"     CASCADE;
DROP TABLE IF EXISTS "Roles"               CASCADE;
DROP TABLE IF EXISTS "Permissions"         CASCADE;
