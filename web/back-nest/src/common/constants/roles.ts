/**
 * The four canonical user roles. Single source of truth for AppUser.role
 * validation now that the dynamic RBAC stack has been removed.
 */
export const VALID_ROLES = [
  'Admin',
  'ProjectManager',
  'SpecificationTeam',
  'Member',
] as const

type UserRole = (typeof VALID_ROLES)[number]
