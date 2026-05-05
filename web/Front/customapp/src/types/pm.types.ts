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
  aiStatus: 'none' | 'processing' | 'completed' | 'failed'
}

export interface MeetingTranscriptDetail {
  id: string
  projectId: string
  title: string
  durationSeconds: number
  detectedLanguages: string
  recordedAt: string
  createdAt: string
  hasAudio?: boolean
  segments: TranscriptSegment[]
}

export interface SpeakerRange {
  start: number
  end: number
  speaker: string
}

// ─── AI Meeting Analysis ──────────────────────────────────────────────────────

export interface AiActionItem {
  id: string
  description: string
  assigneeName: string | null
  dueDate: string | null
  isCompleted: boolean
}

export interface AiDecision {
  id: string
  description: string
  category: 'decision' | 'risk'
}

export interface AiResults {
  aiStatus: 'none' | 'processing' | 'completed' | 'failed'
  aiSummary: string | null
  aiError: string | null
  aiModel: string | null
  aiProcessedAt: string | null
  actionItems: AiActionItem[]
  decisions: AiDecision[]
}

// ─── Automation ───────────────────────────────────────────────────────────────

export interface AutomationRule {
  id: string
  projectId: string
  name: string
  triggerEvent: string
  triggerCondition: Record<string, unknown> | null
  actionType: string
  actionConfig: Record<string, unknown>
  isActive: boolean
  executionCount: number
  lastExecutedAt: string | null
  createdAt: string
}

export interface AutomationLog {
  id: string
  ruleId: string
  projectId: string
  status: 'success' | 'failed' | 'skipped'
  detail: string | null
  executedAt: string
}
