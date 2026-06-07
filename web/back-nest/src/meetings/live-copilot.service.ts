/**
 * @file live-copilot.service.ts — backend orchestrator for the unified
 * real-time meeting copilot. One agent fire produces BOTH a checklist
 * (topics-to-collect with status + evidence) AND optional suggestion cards
 * attached inline to missing/partial items.
 *
 * Per-session state lives in-process; suggestion cards the PM acted on
 * (asked/dismissed) are persisted to LiveMeetingSuggestion for audit so
 * a server restart doesn't lose the history.
 */

import { Injectable, Logger } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service.js'
import { Result } from '../common/result.js'
import { AgentRunnerService } from '../ai/agent/agent-runner.service.js'
import { AgentEmitMissedError } from '../ai/agent/agent-errors.js'
import { buildCopilotTools } from '../ai/agent/tools/copilot-tools.js'
import {
  readProjectSummaryTool,
  readQuestionnaireTool,
  readValidatedCahierTool,
} from '../ai/agent/tools/project-tools.js'
import { readGlossaryTool } from '../ai/agent/tools/glossary-tools.js'
import type { ToolDefinition } from '../ai/agent/agent-types.js'
import { obj, str, arr, bool } from '../ai/agent/json-schema.js'
import { buildLiveCopilotPrompt } from './live-copilot.prompt.js'
import {
  COPILOT_LIMITS,
  DEFAULT_MEETING_TYPE,
  VALID_CAHIER_SECTIONS,
  VALID_CHECKLIST_CATEGORIES,
  VALID_MEETING_TYPES,
  type CahierSection,
  type ChecklistCategory,
  type ChecklistItem,
  type ChecklistStatus,
  type LiveCopilotFireResult,
  type LiveSessionState,
  type MeetingType,
  type SuggestionUrgency,
  type UserItemAction,
} from './live-copilot.types.js'

@Injectable()
export class LiveCopilotService {
  private readonly logger = new Logger(LiveCopilotService.name)
  private readonly sessions = new Map<string, LiveSessionState>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRunner: AgentRunnerService,
  ) {
    setInterval(() => this.sweepIdleSessions(), 5 * 60_000).unref()
  }

  // ─── Session lifecycle ─────────────────────────────────────────────────────

  startSession(
    projectId: string,
    liveSessionId: string,
    userId: string,
    meetingType: MeetingType = DEFAULT_MEETING_TYPE,
  ): Result<LiveSessionState> {
    const existing = this.sessions.get(liveSessionId)
    if (existing) {
      if (VALID_MEETING_TYPES.includes(meetingType)) existing.meetingType = meetingType
      return Result.ok(existing)
    }
    const safeType = VALID_MEETING_TYPES.includes(meetingType) ? meetingType : DEFAULT_MEETING_TYPE
    const state: LiveSessionState = {
      liveSessionId,
      projectId,
      userId,
      meetingType: safeType,
      agentTaggedCoverage: new Set<CahierSection>(),
      transcriptBuffer: '',
      totalCharsAppended: 0,
      lastFiredAtOffset: 0,
      lastFiredAtMs: 0,
      summary: '',
      checklist: [],
      userActions: new Map<string, UserItemAction>(),
      hint: null,
      readyForCahier: false,
      fireCount: 0,
      tokenSpend: 0,
      startedAtMs: Date.now(),
      lastChunkHash: '',
      inFlight: false,
    }
    this.sessions.set(liveSessionId, state)
    this.logger.log(`Copilot session started: ${liveSessionId} (project=${projectId}, type=${safeType})`)
    return Result.ok(state)
  }

  /** Append a transcript chunk; returns whether a fire is now warranted. */
  appendTranscript(liveSessionId: string, chunk: string): Result<{ shouldFire: boolean }> {
    const state = this.sessions.get(liveSessionId)
    if (!state) return Result.fail('Session introuvable.')
    if (!chunk || chunk.length === 0) return Result.ok({ shouldFire: false })

    const tail = chunk.slice(-100)
    const hash = createHash('sha1').update(tail).digest('hex')
    if (hash === state.lastChunkHash) {
      return Result.ok({ shouldFire: false })
    }
    state.lastChunkHash = hash

    state.transcriptBuffer = (state.transcriptBuffer + ' ' + chunk).trim()
    state.totalCharsAppended += chunk.length

    if (state.transcriptBuffer.length > COPILOT_LIMITS.TRANSCRIPT_BUFFER_MAX_CHARS) {
      state.transcriptBuffer = state.transcriptBuffer.slice(-COPILOT_LIMITS.TRANSCRIPT_BUFFER_MAX_CHARS)
    }

    const newSinceLastFire = state.totalCharsAppended - state.lastFiredAtOffset
    const shouldFire =
      newSinceLastFire >= COPILOT_LIMITS.MIN_CONTENT_CHARS &&
      Date.now() - state.lastFiredAtMs >= COPILOT_LIMITS.MIN_FIRE_INTERVAL_MS &&
      state.fireCount < COPILOT_LIMITS.MAX_FIRES_PER_MEETING

    return Result.ok({ shouldFire })
  }

  // ─── Fire the agent loop ────────────────────────────────────────────────────

  /**
   * One unified copilot fire. Returns the full meeting state.
   *
   * @param force when true, bypass cooldown + min-content gates (PM clicked
   *   "Rafraîchir"). Caps (max fires, max tokens) still apply.
   */
  async fire(liveSessionId: string, force = false): Promise<Result<LiveCopilotFireResult>> {
    const state = this.sessions.get(liveSessionId)
    if (!state) {
      return Result.ok(this.skipResult(null, 'no_session'))
    }

    // Concurrency guard — two near-simultaneous fires (PM double-clicks
    // "Rafraîchir", or two browsers in the same room) used to bypass every
    // cap because the check-then-mutate window was 25+ lines wide. Now any
    // second caller short-circuits with a cooldown skip.
    if (state.inFlight) {
      return Result.ok(this.skipResult(state, 'cooldown'))
    }

    // Caps that can't be force-bypassed.
    if (state.fireCount >= COPILOT_LIMITS.MAX_FIRES_PER_MEETING) {
      return Result.ok(this.skipResult(state, 'cap_reached'))
    }
    if (state.tokenSpend >= COPILOT_LIMITS.MAX_TOKENS_PER_MEETING) {
      return Result.ok(this.skipResult(state, 'budget'))
    }

    if (!force) {
      if (Date.now() - state.lastFiredAtMs < COPILOT_LIMITS.MIN_FIRE_INTERVAL_MS) {
        return Result.ok(this.skipResult(state, 'cooldown'))
      }
      const newChars = state.totalCharsAppended - state.lastFiredAtOffset
      // Skip on insufficient new content ONLY when we already have a usable
      // checklist on screen. While the checklist is still empty (cold start
      // or post-failure), every append should be allowed to trigger a fire
      // so the helper actually recovers during the meeting.
      if (newChars < COPILOT_LIMITS.MIN_CONTENT_CHARS && state.checklist.length > 0) {
        return Result.ok(this.skipResult(state, 'min_content'))
      }
    }

    state.inFlight = true
    state.fireCount += 1
    state.lastFiredAtMs = Date.now()
    state.lastFiredAtOffset = state.totalCharsAppended

    // ── Tools ────────────────────────────────────────────────────────────────

    const writeSummary: ToolDefinition<{ summary: string }, { ok: boolean }> = {
      name: 'write_session_summary',
      description: 'Persist a short rolling summary (<=600 chars) of what has been covered so far. Optional but recommended before emit_meeting_state so the next fire has memory.',
      parameters: obj(
        { summary: str({ description: 'Rolling summary, <= 600 chars, French', maxLength: 600 }) },
        { required: ['summary'] },
      ),
      handler: async (args) => {
        this.updateSummary(state.liveSessionId, args.summary)
        return { ok: true }
      },
    }

    const emitMeetingState: ToolDefinition<EmitInput, EmitInput> = {
      name: 'emit_meeting_state',
      description: `Final tool. Emit the FULL meeting state for this fire: the complete checklist (1..${COPILOT_LIMITS.MAX_ITEMS_PER_MEETING} items, stable ids, current status/evidence) and an optional one-line hint. After this call, the loop ends.`,
      parameters: obj(
        {
          checklist: arr(
            obj(
              {
                id: str({
                  description: 'Stable id, 3-16 chars, no spaces. REUSE existing ids when the topic matches.',
                  maxLength: 16,
                }),
                topic: str({ description: 'Short topic label (e.g. "Volume documentaire")', maxLength: 80 }),
                question: str({ description: 'The info to collect, phrased as a question', maxLength: 220 }),
                category: str({ enum: [...VALID_CHECKLIST_CATEGORIES] }),
                section: str({ enum: [...VALID_CAHIER_SECTIONS] }),
                status: str({ enum: ['covered', 'partial', 'missing'] }),
                evidence: str({
                  description: 'Quote from transcript when status=covered. Empty string otherwise.',
                  maxLength: 240,
                }),
                suggestion: obj(
                  {
                    question: str({ description: 'Question to ask now (80-180 chars)', maxLength: 240 }),
                    rationale: str({ description: 'Why this question now (1-2 sentences)', maxLength: 500 }),
                    urgency: str({ enum: ['low', 'medium', 'high'] }),
                  },
                  { required: ['question', 'rationale', 'urgency'] },
                ),
              },
              { required: ['id', 'topic', 'question', 'category', 'section', 'status', 'evidence'] },
            ),
            { maxItems: COPILOT_LIMITS.MAX_ITEMS_PER_MEETING },
          ),
          hint: str({ description: 'Optional one-line nudge for the PM. Empty string if no hint.', maxLength: 200 }),
          readyForCahier: bool('True only when every item is covered/partial AND >=75% covered.'),
        },
        { required: ['checklist', 'hint', 'readyForCahier'] },
      ),
      handler: async () => ({ checklist: [], hint: '', readyForCahier: false }),
    }

    const tools = [
      readProjectSummaryTool,
      readQuestionnaireTool,
      readValidatedCahierTool,
      readGlossaryTool,
      ...buildCopilotTools(state, this),
      writeSummary,
    ]

    // ── Invoke the agent ─────────────────────────────────────────────────────

    try {
      const previousChecklist = state.checklist.length === 0
        ? '(checklist vide — c\'est le premier appel, génère-la initialement)'
        : JSON.stringify(
            state.checklist.map((i) => ({
              id: i.id,
              topic: i.topic,
              question: i.question,
              category: i.category,
              section: i.section,
              status: i.status,
              evidence: i.evidence,
            })),
            null,
            2,
          )

      const result = await this.agentRunner.run<EmitInput>({
        systemPrompt: buildLiveCopilotPrompt(state.meetingType),
        userMessage: [
          'Une nouvelle portion de transcription est disponible.',
          'Lis read_live_transcript_window puis appelle emit_meeting_state.',
          '',
          '## Checklist actuelle (à conserver/mettre à jour, garde les ids stables)',
          previousChecklist,
        ].join('\n'),
        tools,
        emitTools: [emitMeetingState],
        maxIterations: 6,
        loopTimeoutMs: COPILOT_LIMITS.AGENT_LOOP_TIMEOUT_MS,
        feature: 'meeting-analysis',
        projectId: state.projectId,
      })

      const sanitized = sanitizeEmit(result.output)

      // Empty-emit guard. The agent occasionally returns checklist:[] —
      // typically when the LLM was confused by a short opening transcript
      // ("Bonjour, on commence…"). Without this guard the first fire wipes
      // any seeded items, the WebSocket pushes an empty state to the
      // client, and every subsequent fire is blocked by cooldown /
      // min_content gates so the helper never recovers during the meeting.
      // Treat an empty emit as a soft skip — keep the previous checklist
      // (or, on first fire, fall through with a 'provider' skip so the
      // next append-driven fire retries instead of caching a broken state).
      if (sanitized.checklist.length === 0) {
        this.addTokenSpend(liveSessionId, result.iterations * 1_500)
        this.logger.warn(`Copilot empty emit on ${liveSessionId} (fire ${state.fireCount}) — preserving previous checklist`)
        if (state.checklist.length === 0) {
          return Result.ok(this.skipResult(state, 'provider'))
        }
        return Result.ok({
          checklist: cloneChecklist(state.checklist),
          hint: state.hint,
          readyForCahier: state.readyForCahier,
          summary: state.summary,
        })
      }

      const merged = this.applyEmitToState(state, sanitized)

      // Bill on success — actual provider tokens when the agent runner exposes them,
      // else fall back to the iteration estimate.
      this.addTokenSpend(liveSessionId, result.iterations * 1_500)

      return Result.ok({
        checklist: merged.checklist,
        hint: merged.hint,
        readyForCahier: merged.readyForCahier,
        summary: state.summary,
      })
    } catch (e) {
      // Bill failed runs too — the LLM call already happened even when the
      // model failed to emit. Without this, emit-missed sessions can fire
      // forever because tokenSpend stays 0.
      this.addTokenSpend(liveSessionId, 6 * 1_500)
      if (e instanceof AgentEmitMissedError) {
        this.logger.warn(`Copilot agent missed emit on ${liveSessionId}: ${e.message}`)
        return Result.ok(this.skipResult(state, 'provider'))
      }
      this.logger.warn(`Copilot fire failed on ${liveSessionId}: ${e instanceof Error ? e.message : String(e)}`)
      return Result.ok(this.skipResult(state, 'provider'))
    } finally {
      state.inFlight = false
    }
  }

  // ─── PM actions on checklist items ──────────────────────────────────────────

  /**
   * Record a PM action against a checklist item id. Persists a row in
   * LiveMeetingSuggestion for audit so the saved meeting carries the trail.
   * Returns the updated checklist so the caller can re-emit it to the room.
   */
  async recordItemAction(
    liveSessionId: string,
    itemId: string,
    action: UserItemAction,
  ): Promise<Result<{ checklist: ChecklistItem[] } | null>> {
    const state = this.sessions.get(liveSessionId)
    if (!state) {
      // In-memory session was wiped (typically server restart). Treat as a
      // soft no-op so the PM doesn't see a 404 in the console for clicking
      // a stale checklist item. The frontend's optimistic update is harmless.
      this.logger.warn(`recordItemAction: live session ${liveSessionId} not found — soft-noop (server restart wiped state)`)
      return Result.ok(null)
    }
    const item = state.checklist.find((i) => i.id === itemId)
    if (!item) {
      this.logger.warn(`recordItemAction: item ${itemId} not in checklist for session ${liveSessionId} — soft-noop`)
      return Result.ok(null)
    }

    state.userActions.set(itemId, action)
    item.userAction = action

    // Persist to the audit table when the item carries a suggestion (history
    // for the saved meeting's "questions asked / dismissed" trail).
    if (item.suggestion) {
      try {
        await this.prisma.liveMeetingSuggestion.create({
          data: {
            id: randomUUID(),
            projectId: state.projectId,
            liveSessionId: state.liveSessionId,
            meetingTranscriptId: null,
            question: item.suggestion.question,
            rationale: item.suggestion.rationale,
            urgency: item.suggestion.urgency,
            section: item.section,
            status: action,
          },
        })
      } catch (e) {
        this.logger.warn(`recordItemAction: persistence failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return Result.ok({ checklist: cloneChecklist(state.checklist) })
  }

  // ─── End session ────────────────────────────────────────────────────────────

  async endSession(liveSessionId: string, meetingTranscriptId?: string | null): Promise<Result<void>> {
    const state = this.sessions.get(liveSessionId)
    if (!state) return Result.ok()
    if (meetingTranscriptId) {
      try {
        await this.prisma.liveMeetingSuggestion.updateMany({
          where: { liveSessionId, meetingTranscriptId: null },
          data: { meetingTranscriptId },
        })
      } catch (e) {
        this.logger.warn(`endSession meeting-link failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    this.sessions.delete(liveSessionId)
    this.logger.log(`Copilot session ended: ${liveSessionId} (fires=${state.fireCount}, items=${state.checklist.length})`)
    return Result.ok()
  }

  // ─── Reads for the agent tool factory ──────────────────────────────────────

  /**
   * What questions has the agent already proposed via inline suggestions on
   * this session, plus their server-recorded user-action status. Filters by
   * itemId-collected dedupe so the agent doesn't re-suggest the same thing
   * after the PM dismissed it.
   */
  async fetchEmittedSuggestions(liveSessionId: string): Promise<Array<{ question: string; section: string; status: string }>> {
    const rows = await this.prisma.liveMeetingSuggestion.findMany({
      where: { liveSessionId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { question: true, section: true, status: true },
    })
    return rows.map((r) => ({ question: r.question, section: r.section, status: r.status }))
  }

  getState(liveSessionId: string): LiveSessionState | undefined {
    return this.sessions.get(liveSessionId)
  }

  addTokenSpend(liveSessionId: string, tokens: number): void {
    const state = this.sessions.get(liveSessionId)
    if (state) state.tokenSpend += tokens
  }

  updateSummary(liveSessionId: string, summary: string): void {
    const state = this.sessions.get(liveSessionId)
    if (state) state.summary = summary.slice(0, 600)
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Merge the agent-emitted state into the session, preserving:
   *   - covered status (sticky — the agent should not regress, but if it does
   *     we override back to covered);
   *   - per-item user actions (asked/dismissed clicks survive rewrites).
   */
  private applyEmitToState(state: LiveSessionState, emit: SanitizedEmit): {
    checklist: ChecklistItem[]
    hint: string | null
    readyForCahier: boolean
  } {
    const previousById = new Map<string, ChecklistItem>(state.checklist.map((i) => [i.id, i]))

    const next: ChecklistItem[] = emit.checklist.map((row) => {
      const prev = previousById.get(row.id)
      // Sticky covered: don't let the agent regress a covered item.
      let status: ChecklistStatus = row.status
      if (prev?.status === 'covered' && row.status !== 'covered') {
        status = 'covered'
      }
      // If now covered, drop any active suggestion (no point asking the question).
      const suggestion = status === 'covered' ? null : row.suggestion
      const userAction = state.userActions.get(row.id) ?? null
      // Rebuild evidence: prefer the new emit's evidence when covered;
      // fall back to the previous one if the agent forgot.
      const evidence = status === 'covered'
        ? (row.evidence || prev?.evidence || null)
        : null

      return {
        id: row.id,
        topic: row.topic,
        question: row.question,
        category: row.category,
        section: row.section,
        status,
        evidence,
        suggestion,
        userAction,
      }
    })

    // Update the agent-tagged coverage signal from the emit (covered + partial sections).
    for (const i of next) {
      if (i.status === 'covered' || i.status === 'partial') {
        state.agentTaggedCoverage.add(i.section)
      }
    }

    state.checklist = next
    state.hint = emit.hint
    state.readyForCahier = emit.readyForCahier

    return {
      checklist: cloneChecklist(next),
      hint: emit.hint,
      readyForCahier: emit.readyForCahier,
    }
  }

  private skipResult(state: LiveSessionState | null, reason: NonNullable<LiveCopilotFireResult['skipReason']>): LiveCopilotFireResult {
    return {
      checklist: state ? cloneChecklist(state.checklist) : [],
      hint: state?.hint ?? null,
      readyForCahier: state?.readyForCahier ?? false,
      summary: state?.summary ?? '',
      skipped: true,
      skipReason: reason,
    }
  }

  private sweepIdleSessions(): void {
    const now = Date.now()
    const idle = COPILOT_LIMITS.SESSION_IDLE_EVICTION_MS
    let evicted = 0
    for (const [id, state] of this.sessions) {
      const lastActivity = Math.max(state.lastFiredAtMs, state.startedAtMs)
      if (now - lastActivity > idle) {
        this.sessions.delete(id)
        evicted += 1
      }
    }
    if (evicted > 0) this.logger.log(`Evicted ${evicted} idle copilot session(s)`)
  }
}

// ─── Internal types ─────────────────────────────────────────────────────────

interface EmitInput {
  checklist: Array<{
    id: string
    topic: string
    question: string
    category: string
    section: string
    status: string
    evidence: string
    suggestion?: { question: string; rationale: string; urgency: string }
  }>
  hint: string
  readyForCahier: boolean
}

interface SanitizedEmit {
  checklist: Array<{
    id: string
    topic: string
    question: string
    category: ChecklistCategory
    section: CahierSection
    status: ChecklistStatus
    evidence: string
    suggestion: { question: string; rationale: string; urgency: SuggestionUrgency } | null
  }>
  hint: string | null
  readyForCahier: boolean
}

const VALID_STATUSES: ChecklistStatus[] = ['covered', 'partial', 'missing']
const VALID_URGENCIES: SuggestionUrgency[] = ['low', 'medium', 'high']

function sanitizeEmit(raw: EmitInput): SanitizedEmit {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.checklist)) {
    return { checklist: [], hint: null, readyForCahier: false }
  }

  const seenIds = new Set<string>()
  let activeSuggestionCount = 0
  const MAX_ACTIVE_SUGGESTIONS = 4

  const checklist: SanitizedEmit['checklist'] = []
  for (const item of raw.checklist.slice(0, COPILOT_LIMITS.MAX_ITEMS_PER_MEETING)) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim().slice(0, 16) : ''
    if (!id || seenIds.has(id)) continue
    const topic = typeof item.topic === 'string' ? item.topic.trim().slice(0, 200) : ''
    const question = typeof item.question === 'string' ? item.question.trim().slice(0, 300) : ''
    if (!topic || !question) continue
    const category = (VALID_CHECKLIST_CATEGORIES as readonly string[]).includes(item.category)
      ? (item.category as ChecklistCategory)
      : 'other'
    const section = (VALID_CAHIER_SECTIONS as readonly string[]).includes(item.section)
      ? (item.section as CahierSection)
      : 'contexte'
    const status = (VALID_STATUSES as readonly string[]).includes(item.status)
      ? (item.status as ChecklistStatus)
      : 'missing'
    const evidence = typeof item.evidence === 'string' ? item.evidence.trim().slice(0, 240) : ''

    let suggestion: SanitizedEmit['checklist'][number]['suggestion'] = null
    if (item.suggestion && typeof item.suggestion === 'object' && status !== 'covered' && activeSuggestionCount < MAX_ACTIVE_SUGGESTIONS) {
      const sQ = typeof item.suggestion.question === 'string' ? item.suggestion.question.trim().slice(0, 240) : ''
      const sR = typeof item.suggestion.rationale === 'string' ? item.suggestion.rationale.trim().slice(0, 500) : ''
      const sU = (VALID_URGENCIES as readonly string[]).includes(item.suggestion.urgency)
        ? (item.suggestion.urgency as SuggestionUrgency)
        : 'medium'
      if (sQ && sR) {
        suggestion = { question: sQ, rationale: sR, urgency: sU }
        activeSuggestionCount += 1
      }
    }

    seenIds.add(id)
    checklist.push({ id, topic, question, category, section, status, evidence, suggestion })
  }

  const hint = typeof raw.hint === 'string' && raw.hint.trim().length > 0 ? raw.hint.trim().slice(0, 200) : null
  const readyForCahier = typeof raw.readyForCahier === 'boolean' ? raw.readyForCahier : false

  return { checklist, hint, readyForCahier }
}

function cloneChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return items.map((i) => ({
    ...i,
    suggestion: i.suggestion ? { ...i.suggestion } : null,
  }))
}
