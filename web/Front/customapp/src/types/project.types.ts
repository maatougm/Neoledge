/**
 * @file     project.types.ts
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     TypeScript types mirroring the backend Project DTOs
 */

import type { UserResponse } from './user.types'

export type ProjectStatus =
  | 'Draft'
  | 'Kickoff'
  | 'CadrageTechnique'
  | 'Environnement'
  | 'Parametrage'
  | 'Integration'
  | 'Recette'
  | 'MEP'
  | 'Cloture'
  | 'Archived'

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  Draft: 'Brouillon',
  Kickoff: 'Lancement',
  CadrageTechnique: 'Cadrage technique',
  Environnement: 'Environnement',
  Parametrage: 'Paramétrage',
  Integration: 'Intégration',
  Recette: 'Recette',
  MEP: 'Mise en production',
  Cloture: 'Clôture',
  Archived: 'Archivé',
}

export const PROJECT_STATUS_SEVERITY: Record<ProjectStatus, string> = {
  Draft: 'secondary',
  Kickoff: 'info',
  CadrageTechnique: 'info',
  Environnement: 'info',
  Parametrage: 'warning',
  Integration: 'warning',
  Recette: 'warning',
  MEP: 'success',
  Cloture: 'success',
  Archived: 'secondary',
}

export type FieldType = 'Text' | 'Number' | 'Date' | 'Select' | 'Checkbox'
export type FieldCategory = 'Static' | 'Dynamic' | 'Custom'

export interface ProjectField {
  id: string
  label: string
  fieldType: FieldType
  isRequired: boolean
  defaultValue: string | null
  orderIndex: number
  fieldCategory: FieldCategory
  options: string | null
}

export interface ProjectFieldValue {
  projectFieldId: string
  label: string
  value: string | null
}

// ─── Responses ────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string
  name: string
  clientName: string
  projectManagerName: string | null
  projectManagerEmail: string | null
  status: ProjectStatus
  startDate: string
  endDate: string
  createdAt: string
  /** Backend-computed: % of WPs in a terminal status (Resolved + Closed). */
  progressPct?: number
  wpClosed?: number
  wpTotal?: number
}

export interface ProjectDetail {
  id: string
  name: string
  clientName: string
  status: ProjectStatus
  aiOutput?: string | null
  startDate: string
  endDate: string
  createdAt: string
  updatedAt: string
  manualProgressPct?: number | null
  projectManager: UserResponse | null
  fields: ProjectField[]
  fieldValues: ProjectFieldValue[]
}

export interface AddFieldPayload {
  label: string
  fieldType: FieldType
  isRequired: boolean
  options: string | null
  isBacklogDriver?: boolean
  backlogHint?: string | null
}

// ─── Requests ─────────────────────────────────────────────────────────────────

export interface CreateProjectPayload {
  name: string
  clientName: string
  startDate: string
  endDate: string
  projectManagerId: string
}

export interface UpdateProjectPayload {
  name?: string
  clientName?: string
  startDate?: string
  endDate?: string
}

export interface AssignManagerPayload {
  projectManagerId: string
}

// ─── Activity Feed ─────────────────────────────────────────────────────────────

export interface ProjectActivity {
  id: string
  userName: string | null
  userId: string | null
  userRole: string | null
  action: string
  detail: string | null
  timestamp: string
  projectId: string | null
  projectName: string | null
  projectClientName: string | null
}

export interface ActivityStats {
  totalToday: number
  totalThisWeek: number
  mostActiveProject: { id: string; name: string; count: number } | null
}

export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  ProjectCreated: 'Projet créé',
  StatusChanged: 'Statut modifié',
  ManagerAssigned: 'Chef de projet assigné',
  FieldUpdated: 'Champ mis à jour',
  ValidationSubmitted: 'Validation soumise',
}

// ─── Trash ────────────────────────────────────────────────────────────────────

export interface DeletedProjectSummary {
  id: string
  name: string
  clientName: string
  projectManagerName: string | null
  status: ProjectStatus
  deletedAt: string
  deletedByName: string | null
}

// ─── Project Templates ─────────────────────────────────────────────────────────

export interface ProjectTemplateSummary {
  id: string
  name: string
  description: string | null
  fieldCount: number
  createdAt: string
}

export interface CreateTemplatePayload {
  name: string
  description: string | null
  fields: Array<{
    label: string
    fieldType: string
    category: string
    isRequired: boolean
    displayOrder: number
    options: string | null
  }>
}

export interface TemplateField {
  id: string
  label: string
  type: string
  category: string
  isRequired: boolean
  displayOrder: number
  options: string | null
}

export interface ProjectTemplate {
  id: string
  name: string
  description: string | null
  createdAt: string
  fields: TemplateField[]
}

export interface CreateFromProjectPayload {
  name: string
  description?: string
}
