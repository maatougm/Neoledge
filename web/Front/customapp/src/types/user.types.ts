/**
 * @file     user.types.ts
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     TypeScript types mirroring the backend AppUser DTOs
 */

// Known built-in roles. The backend may also return custom role names —
// always use `getUserRoleLabel()` for display instead of indexing directly.
export type KnownUserRole =
  | 'Admin'
  | 'ProjectManager'
  | 'SpecificationTeam'
  | 'Member'

// Widened to accept custom roles returned by /auth/me without casting.
export type UserRole = KnownUserRole | (string & {})

const BUILT_IN_ROLE_LABELS: Record<KnownUserRole, string> = {
  Admin: 'Administrateur',
  ProjectManager: 'Chef de projet',
  SpecificationTeam: 'Équipe spécification',
  Member: 'Membre',
}

/** @deprecated Use `getUserRoleLabel(role)` instead of indexing `USER_ROLE_LABELS` directly — custom roles are not in this map. */
export const USER_ROLE_LABELS: Record<string, string | undefined> = BUILT_IN_ROLE_LABELS

/** Returns a human-readable label for a role, falling back to the raw value for custom roles. */
export function getUserRoleLabel(role: string): string {
  return BUILT_IN_ROLE_LABELS[role as KnownUserRole] ?? role
}

export const USER_ROLE_OPTIONS = (Object.entries(BUILT_IN_ROLE_LABELS) as [KnownUserRole, string][]).map(
  ([value, label]) => ({ value, label }),
)

// ─── Response ─────────────────────────────────────────────────────────────────

export interface UserResponse {
  id: string
  firstName: string
  lastName: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: string
  lastLoginAt: string | null
}

// ─── Requests ─────────────────────────────────────────────────────────────────

export interface CreateUserPayload {
  firstName: string
  lastName: string
  email: string
  password: string
  role: UserRole
}

export interface UpdateUserPayload {
  firstName?: string
  lastName?: string
  email?: string
  role?: UserRole
}
