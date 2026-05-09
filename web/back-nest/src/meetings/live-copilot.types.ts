/**
 * @file live-copilot.types.ts — shared types for the real-time meeting copilot.
 *
 * The copilot is now a UNIFIED feature: each fire returns BOTH a project
 * checklist (topics to collect with status) AND active suggestion cards
 * (questions to ask now). The frontend renders a single panel where missing
 * checklist items can carry an inline suggested question with Ask/Ignore.
 */

export type SuggestionUrgency = 'low' | 'medium' | 'high'

/** Meeting-type presets — drive the copilot prompt + transcript-analysis tone. */
export type MeetingType =
  | 'kickoff'
  | 'cadrage'
  | 'validation'
  | 'standup'
  | 'retrospective'
  | 'other'

export const VALID_MEETING_TYPES: ReadonlyArray<MeetingType> = [
  'kickoff',
  'cadrage',
  'validation',
  'standup',
  'retrospective',
  'other',
]

export const DEFAULT_MEETING_TYPE: MeetingType = 'cadrage'

/** Cahier section keys (matches CahierAiResult) + 'backlog_driver' for
 *  questions targeting questionnaire fields marked isBacklogDriver=true. */
export type CahierSection =
  | 'objectifDocument'
  | 'contexte'
  | 'objectifProjet'
  | 'perimetreInclus'
  | 'perimetreExclus'
  | 'exigencesFonctionnelles'
  | 'architectureTechnique'
  | 'livrables'
  | 'conclusion'
  | 'backlog_driver'

export const VALID_CAHIER_SECTIONS: ReadonlyArray<CahierSection> = [
  'objectifDocument',
  'contexte',
  'objectifProjet',
  'perimetreInclus',
  'perimetreExclus',
  'exigencesFonctionnelles',
  'architectureTechnique',
  'livrables',
  'conclusion',
  'backlog_driver',
]

/** Coverage status for a checklist topic. */
export type ChecklistStatus = 'covered' | 'partial' | 'missing'

/** Free-form category to group checklist items in the UI. */
export type ChecklistCategory =
  | 'context'
  | 'users'
  | 'features'
  | 'constraints'
  | 'integrations'
  | 'security'
  | 'timeline'
  | 'other'

export const VALID_CHECKLIST_CATEGORIES: ReadonlyArray<ChecklistCategory> = [
  'context',
  'users',
  'features',
  'constraints',
  'integrations',
  'security',
  'timeline',
  'other',
]

/** PM action against a checklist item — sticky across fires. */
export type UserItemAction = 'asked' | 'dismissed'

/** A single topic the PM should collect during the meeting. The agent rewrites
 *  this list every fire but MUST reuse the same `id` for a topic that already
 *  exists (semantic match by `topic`). The user-action layer is preserved on
 *  the server so a rewrite cannot wipe the PM's clicks. */
export interface ChecklistItem {
  id: string
  topic: string
  question: string
  category: ChecklistCategory
  section: CahierSection
  status: ChecklistStatus
  evidence: string | null
  /** When status !== 'covered' the agent may attach a question card — that's
   *  the actionable suggestion the PM can Ask / Ignore. Card lives on the
   *  same checklist row in the UI. */
  suggestion: ChecklistSuggestion | null
  /** PM action recorded by the server. The agent does not see this — it's
   *  applied in the response builder so a rewrite cannot clobber it. */
  userAction: UserItemAction | null
}

export interface ChecklistSuggestion {
  question: string
  rationale: string
  urgency: SuggestionUrgency
}

/** Result of one copilot fire — the full meeting state. */
export interface LiveCopilotFireResult {
  checklist: ChecklistItem[]
  /** Optional one-line nudge for the PM (top of panel). */
  hint: string | null
  /** True when every item is covered/partial AND ≥75% are covered. */
  readyForCahier: boolean
  summary: string
  /** When skipped, why. */
  skipped?: boolean
  skipReason?: 'cooldown' | 'cap_reached' | 'budget' | 'min_content' | 'no_session' | 'provider'
}

/** Per-session in-memory state held in LiveCopilotService. */
export interface LiveSessionState {
  liveSessionId: string
  projectId: string
  userId: string
  meetingType: MeetingType
  /** Cahier sections the agent flagged as substantively discussed. Used by
   *  the frontend coverage gauge. Derived also from per-item status. */
  agentTaggedCoverage: Set<CahierSection>
  /** Append-only ring buffer of transcript text (capped). */
  transcriptBuffer: string
  totalCharsAppended: number
  lastFiredAtOffset: number
  lastFiredAtMs: number
  /** Rolling summary maintained by the agent (its own working memory). */
  summary: string
  /** The latest checklist the agent emitted. Stable ids — survives between fires. */
  checklist: ChecklistItem[]
  /** PM actions per checklist item id. Sticky across rewrites. */
  userActions: Map<string, UserItemAction>
  /** Latest one-line hint from the agent. */
  hint: string | null
  readyForCahier: boolean
  fireCount: number
  /** Cumulative input tokens spent on this session. */
  tokenSpend: number
  startedAtMs: number
  /** Last-100-chars hash to dedupe browser SpeechRecognition restarts. */
  lastChunkHash: string
}

/**
 * Limits — tuned for "more frequent firing, even if it costs more". The PM
 * explicitly traded cost for responsiveness, so caps are 3-4x looser than the
 * original conservative defaults.
 */
export const COPILOT_LIMITS = {
  /** Min chars of NEW transcript before a fire is allowed. Loosened for snappier UX. */
  MIN_CONTENT_CHARS: 80,
  /** Hard floor between fires. 10s — meaningful pause but not chatty. */
  MIN_FIRE_INTERVAL_MS: 10_000,
  /** Per-meeting fire cap. 4× original. */
  MAX_FIRES_PER_MEETING: 80,
  /** Per-meeting checklist-item cap (the unified ceiling on output rows). */
  MAX_ITEMS_PER_MEETING: 32,
  /** Per-fire NEW item cap — prevents the agent inventing 20 items per fire. */
  MAX_NEW_ITEMS_PER_FIRE: 6,
  /** Per-meeting input-token ceiling. 3× original. */
  MAX_TOKENS_PER_MEETING: 120_000,
  /** Ring-buffer window kept in memory. */
  TRANSCRIPT_BUFFER_MAX_CHARS: 12_000,
  /** Idle timeout — sessions older than this with no append are evicted. */
  SESSION_IDLE_EVICTION_MS: 30 * 60_000,
  /** Hard wall on agent loop wall-clock per fire. */
  AGENT_LOOP_TIMEOUT_MS: 60_000,
} as const
