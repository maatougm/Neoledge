import type { ProjectStatus } from './project.types'

export interface ProjectValidation {
  id: string
  projectId: string
  validatedByRole: string
  validatedByName: string
  phase: ProjectStatus
  isApproved: boolean
  comment: string | null
  validatedAt: string
}

export interface SaveFieldValueItem {
  projectFieldId: string
  value: string | null
}

export interface SaveQuestionnairePayload {
  fieldValues: SaveFieldValueItem[]
}

export interface SubmitValidationPayload {
  isApproved: boolean
  comment: string | null
}
