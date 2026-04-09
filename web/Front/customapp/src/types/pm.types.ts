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

// ─── Meeting Transcription ────────────────────────────────────────────────────

export interface TranscriptSegment {
  id: string
  speaker: string
  text: string
  startTime: number
  endTime: number
  language: string
  confidence: number
}

export interface MeetingTranscriptSummary {
  id: string
  title: string
  durationSeconds: number
  detectedLanguages: string
  segmentCount: number
  recordedAt: string
  createdAt: string
}

export interface MeetingTranscriptDetail {
  id: string
  projectId: string
  title: string
  durationSeconds: number
  detectedLanguages: string
  recordedAt: string
  createdAt: string
  segments: TranscriptSegment[]
}

export interface SpeakerRange {
  start: number
  end: number
  speaker: string
}
