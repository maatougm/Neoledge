/**
 * @file     user.types.ts
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     TypeScript types mirroring the backend AppUser DTOs
 */

export type UserRole =
  | 'Admin'
  | 'ProjectManager'
  | 'SpecificationTeam'
  | 'RealizationTeam'
  | 'DeploymentTeam'
  | 'Viewer'

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  Admin: 'Administrateur',
  ProjectManager: 'Chef de projet',
  SpecificationTeam: 'Équipe spécification',
  RealizationTeam: 'Équipe réalisation',
  DeploymentTeam: 'Équipe déploiement',
  Viewer: 'Lecteur',
}

export const USER_ROLE_OPTIONS = (Object.entries(USER_ROLE_LABELS) as [UserRole, string][]).map(
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
