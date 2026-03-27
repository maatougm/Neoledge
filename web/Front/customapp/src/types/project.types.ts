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
  | 'InProgress'
  | 'SpecificationValidation'
  | 'Realization'
  | 'DeploymentValidation'
  | 'Completed'
  | 'Archived'

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  Draft: 'Brouillon',
  InProgress: 'En cours',
  SpecificationValidation: 'Validation spécification',
  Realization: 'Réalisation',
  DeploymentValidation: 'Validation déploiement',
  Completed: 'Terminé',
  Archived: 'Archivé',
}

export const PROJECT_STATUS_SEVERITY: Record<ProjectStatus, string> = {
  Draft: 'secondary',
  InProgress: 'info',
  SpecificationValidation: 'warn',
  Realization: 'info',
  DeploymentValidation: 'warn',
  Completed: 'success',
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
}

export interface ProjectDetail {
  id: string
  name: string
  clientName: string
  status: ProjectStatus
  allowManagerCustomFields: boolean
  aiOutput?: string | null
  startDate: string
  endDate: string
  createdAt: string
  updatedAt: string
  projectManager: UserResponse | null
  fields: ProjectField[]
  fieldValues: ProjectFieldValue[]
}

export interface AddFieldPayload {
  label: string
  fieldType: FieldType
  isRequired: boolean
  options: string | null
}

// ─── Requests ─────────────────────────────────────────────────────────────────

export interface CreateProjectPayload {
  name: string
  clientName: string
  startDate: string
  endDate: string
  projectManagerId?: string
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
  action: string
  detail: string | null
  createdAt: string
}

export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  ProjectCreated: 'Projet créé',
  StatusChanged: 'Statut modifié',
  ManagerAssigned: 'Chef de projet assigné',
  FieldUpdated: 'Champ mis à jour',
  ValidationSubmitted: 'Validation soumise',
}

// ─── Field Labels ──────────────────────────────────────────────────────────────

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  Text: 'Texte',
  Number: 'Nombre',
  Date: 'Date',
  Select: 'Liste',
  Checkbox: 'Case à cocher',
}

export const FIELD_CATEGORY_LABELS: Record<FieldCategory, string> = {
  Static: 'Statique',
  Dynamic: 'Dynamique',
  Custom: 'Personnalisé',
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
