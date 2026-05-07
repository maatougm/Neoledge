/**
 * @file live-copilot.types.ts — shared types for the real-time meeting copilot.
 */

export type SuggestionUrgency = 'low' | 'medium' | 'high'

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

export type SuggestionStatus = 'pending' | 'dismissed' | 'asked'

export interface SuggestionCard {
  id: string
  question: string
  rationale: string
  urgency: SuggestionUrgency
  section: CahierSection
  status: SuggestionStatus
  createdAt: string
}

/** Result of one copilot fire — one row of cards plus an updated rolling summary. */
export interface LiveCopilotFireResult {
  cards: SuggestionCard[]
  summary: string
  /** True when the fire was skipped (cap reached, cooldown, min-content, ...) */
  skipped?: boolean
  /** When skipped, why. */
  skipReason?: 'cooldown' | 'cap_reached' | 'budget' | 'min_content' | 'no_session' | 'provider'
}

/** Per-session in-memory state held in LiveCopilotService. */
export interface LiveSessionState {
  liveSessionId: string
  projectId: string
  userId: string
  /** Append-only ring buffer of transcript text (capped at 8000 chars). */
  transcriptBuffer: string
  /** Total chars ever appended (used to compute "new since last fire"). */
  totalCharsAppended: number
  /** Last char offset the agent has consumed. */
  lastFiredAtOffset: number
  /** Wall-clock of the last fire (ms epoch). */
  lastFiredAtMs: number
  /** Rolling summary maintained by the agent (its own working memory). */
  summary: string
  /** Per-meeting fire counter (for the 20-fire cap). */
  fireCount: number
  /** Per-meeting card counter (for the 5-card cap). */
  cardCount: number
  /** Cumulative input tokens spent on this session. */
  tokenSpend: number
  /** Created-at (eviction timer). */
  startedAtMs: number
  /** Last-2-chunks hash to dedupe browser SpeechRecognition restarts. */
  lastChunkHash: string
}

/** Hard limits — pinned per the plan. */
export const COPILOT_LIMITS = {
  /** Min chars of NEW transcript before a fire is allowed. */
  MIN_CONTENT_CHARS: 200,
  /** Hard floor between fires. */
  MIN_FIRE_INTERVAL_MS: 30_000,
  /** Per-meeting fire cap. */
  MAX_FIRES_PER_MEETING: 20,
  /** Per-meeting suggestion cap. */
  MAX_CARDS_PER_MEETING: 5,
  /** Per-fire suggestion cap (mirrored in the system prompt). */
  MAX_CARDS_PER_FIRE: 3,
  /** Per-meeting input-token ceiling. */
  MAX_TOKENS_PER_MEETING: 40_000,
  /** Ring-buffer window kept in memory. */
  TRANSCRIPT_BUFFER_MAX_CHARS: 8_000,
  /** Idle timeout — sessions older than this with no append are evicted. */
  SESSION_IDLE_EVICTION_MS: 30 * 60_000,
  /** Hard wall on agent loop wall-clock per fire. */
  AGENT_LOOP_TIMEOUT_MS: 60_000,
} as const
