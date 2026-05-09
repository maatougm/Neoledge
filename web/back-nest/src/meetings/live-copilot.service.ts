/**
 * @file live-copilot.service.ts — backend orchestrator for the real-time
 * meeting copilot. Holds per-session in-memory state (ring buffer, fire
 * counters, rolling summary) and persists suggestion cards to the
 * `LiveMeetingSuggestion` table so they survive a restart.
 *
 * Phase 1 scope: plumbing only. The `fire()` method is a stub that
 * returns `{ cards: [], summary }` until Phase 2 wires it to the agent.
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
import { obj, str, arr } from '../ai/agent/json-schema.js'
import { buildLiveCopilotPrompt } from './live-copilot.prompt.js'
import {
  COPILOT_LIMITS,
  DEFAULT_MEETING_TYPE,
  VALID_CAHIER_SECTIONS,
  VALID_MEETING_TYPES,
  type CahierSection,
  type LiveCopilotFireResult,
  type LiveSessionState,
  type MeetingType,
  type SuggestionCard,
  type SuggestionUrgency,
} from './live-copilot.types.js'

@Injectable()
export class LiveCopilotService {
  private readonly logger = new Logger(LiveCopilotService.name)
  private readonly sessions = new Map<string, LiveSessionState>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRunner: AgentRunnerService,
  ) {
    // Idle session sweep — runs every 5 min, evicts sessions older than the cap.
    setInterval(() => this.sweepIdleSessions(), 5 * 60_000).unref()
  }

  /** Start (or re-attach to) a live session. Idempotent. */
  startSession(
    projectId: string,
    liveSessionId: string,
    userId: string,
    meetingType: MeetingType = DEFAULT_MEETING_TYPE,
  ): Result<LiveSessionState> {
    const existing = this.sessions.get(liveSessionId)
    if (existing) {
      // Idempotent: same session id already active. Update meetingType in
      // case the caller chose differently between attach attempts; everything
      // else is preserved.
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
      fireCount: 0,
      cardCount: 0,
      tokenSpend: 0,
      startedAtMs: Date.now(),
      lastChunkHash: '',
    }
    this.sessions.set(liveSessionId, state)
    this.logger.log(`Copilot session started: ${liveSessionId} (project=${projectId}, type=${safeType})`)
    return Result.ok(state)
  }

  /**
   * Append a new transcript chunk. Dedupes against the last-100-chars
   * hash to filter SpeechRecognition restarts. Returns whether a fire is
   * now warranted (caller uses this as a hint, but `fire()` does its own
   * checks).
   */
  appendTranscript(liveSessionId: string, chunk: string): Result<{ shouldFire: boolean }> {
    const state = this.sessions.get(liveSessionId)
    if (!state) return Result.fail('Session introuvable.')
    if (!chunk || chunk.length === 0) return Result.ok({ shouldFire: false })

    const tail = chunk.slice(-100)
    const hash = createHash('sha1').update(tail).digest('hex')
    if (hash === state.lastChunkHash) {
      // Same trailing 100 chars as last append → likely a SpeechRecognition
      // re-flush of identical text. Skip.
      return Result.ok({ shouldFire: false })
    }
    state.lastChunkHash = hash

    state.transcriptBuffer = (state.transcriptBuffer + ' ' + chunk).trim()
    state.totalCharsAppended += chunk.length

    // Cap the in-memory buffer.
    if (state.transcriptBuffer.length > COPILOT_LIMITS.TRANSCRIPT_BUFFER_MAX_CHARS) {
      state.transcriptBuffer = state.transcriptBuffer.slice(-COPILOT_LIMITS.TRANSCRIPT_BUFFER_MAX_CHARS)
    }

    const newSinceLastFire = state.totalCharsAppended - state.lastFiredAtOffset
    const shouldFire =
      newSinceLastFire >= COPILOT_LIMITS.MIN_CONTENT_CHARS &&
      Date.now() - state.lastFiredAtMs >= COPILOT_LIMITS.MIN_FIRE_INTERVAL_MS &&
      state.fireCount < COPILOT_LIMITS.MAX_FIRES_PER_MEETING &&
      state.cardCount < COPILOT_LIMITS.MAX_CARDS_PER_MEETING

    return Result.ok({ shouldFire })
  }

  /**
   * Run one copilot agent loop. Returns the new cards (if any) plus the
   * refreshed rolling summary. Caller is expected to push the cards via
   * the socket gateway. Errors during the loop are downgraded to
   * `{ skipped: true, skipReason: 'provider' }` so the calling HTTP path
   * never 5xx's mid-meeting.
   */
  async fire(liveSessionId: string): Promise<Result<LiveCopilotFireResult>> {
    const state = this.sessions.get(liveSessionId)
    if (!state) return Result.ok({ cards: [], summary: '', skipped: true, skipReason: 'no_session' })

    // Cap checks before agent invocation.
    if (Date.now() - state.lastFiredAtMs < COPILOT_LIMITS.MIN_FIRE_INTERVAL_MS) {
      return Result.ok({ cards: [], summary: state.summary, skipped: true, skipReason: 'cooldown' })
    }
    if (state.fireCount >= COPILOT_LIMITS.MAX_FIRES_PER_MEETING) {
      return Result.ok({ cards: [], summary: state.summary, skipped: true, skipReason: 'cap_reached' })
    }
    if (state.cardCount >= COPILOT_LIMITS.MAX_CARDS_PER_MEETING) {
      return Result.ok({ cards: [], summary: state.summary, skipped: true, skipReason: 'cap_reached' })
    }
    if (state.tokenSpend >= COPILOT_LIMITS.MAX_TOKENS_PER_MEETING) {
      return Result.ok({ cards: [], summary: state.summary, skipped: true, skipReason: 'budget' })
    }
    const newChars = state.totalCharsAppended - state.lastFiredAtOffset
    if (newChars < COPILOT_LIMITS.MIN_CONTENT_CHARS) {
      return Result.ok({ cards: [], summary: state.summary, skipped: true, skipReason: 'min_content' })
    }

    state.fireCount += 1
    state.lastFiredAtMs = Date.now()
    state.lastFiredAtOffset = state.totalCharsAppended

    // Single-emit terminal: emit_suggestions. The summary is updated via a
    // regular (non-terminal) tool the agent can call mid-loop — keeping a
    // single terminal emit lets the runner force tool_choice on the final
    // iteration, which is more reliable than relying on the model to call
    // multiple emits in the right order.
    const emitSuggestions: ToolDefinition<{ cards: AgentCard[] }, { cards: AgentCard[] }> = {
      name: 'emit_suggestions',
      description: `Final tool. Call this exactly once with 0..${COPILOT_LIMITS.MAX_CARDS_PER_FIRE} new question cards. Empty array is allowed and preferred over filler. After this call, the loop ends.`,
      parameters: obj(
        {
          cards: arr(
            obj(
              {
                question:  str({ description: 'The question to ask, exactly as the PM would phrase it', maxLength: 240 }),
                rationale: str({ description: 'Why this question now, 1-2 sentences', maxLength: 500 }),
                urgency:   str({ enum: ['low', 'medium', 'high'] }),
                section:   str({ enum: [...VALID_CAHIER_SECTIONS] }),
              },
              { required: ['question', 'rationale', 'urgency', 'section'] },
            ),
            { maxItems: COPILOT_LIMITS.MAX_CARDS_PER_FIRE },
          ),
        },
        { required: ['cards'] },
      ),
      handler: async () => ({ cards: [] }),
    }

    // Regular tool — agent can optionally call it BEFORE emit_suggestions to
    // record a rolling summary. Side-effect persists `state.summary` so the
    // next fire has memory.
    const writeSummary: ToolDefinition<{ summary: string }, { ok: boolean }> = {
      name: 'write_session_summary',
      description: 'Persist a short rolling summary (<=600 chars) of what has been covered so far. Optional but recommended before emit_suggestions so the next fire has memory.',
      parameters: obj(
        { summary: str({ description: 'Rolling summary, <= 600 chars, French', maxLength: 600 }) },
        { required: ['summary'] },
      ),
      handler: async (args) => {
        this.updateSummary(state.liveSessionId, args.summary)
        return { ok: true }
      },
    }

    // Coverage tagging tool — the agent flags which cahier sections have
    // been substantively discussed in this fire's transcript window. Used
    // by the frontend coverage gauge to upgrade the keyword baseline with
    // an LLM-classified signal at zero extra cost (one tool call per fire).
    const tagCoverage: ToolDefinition<{ sections: CahierSection[] }, { ok: boolean }> = {
      name: 'tag_coverage',
      description: 'Flag the cahier sections that were SUBSTANTIVELY discussed (more than a passing mention) in the latest transcript window. Optional but recommended once per fire — feeds the live coverage gauge so the PM sees progress.',
      parameters: obj(
        {
          sections: arr(
            str({
              enum: [...VALID_CAHIER_SECTIONS],
              description: 'A cahier section discussed in this window.',
            }),
            { description: '0..3 sections, no duplicates.', maxItems: 4 },
          ),
        },
        { required: ['sections'] },
      ),
      handler: async (args) => {
        for (const s of args.sections ?? []) {
          if (VALID_CAHIER_SECTIONS.includes(s)) state.agentTaggedCoverage.add(s)
        }
        return { ok: true }
      },
    }

    const tools = [
      readProjectSummaryTool,
      readQuestionnaireTool,
      readValidatedCahierTool,
      readGlossaryTool,
      ...buildCopilotTools(state, this),
      writeSummary,
      tagCoverage,
    ]

    try {
      const result = await this.agentRunner.run<{ cards: AgentCard[] }>({
        systemPrompt: buildLiveCopilotPrompt(state.meetingType),
        userMessage:
          'Une nouvelle portion de transcription est disponible. Lis-la (read_live_transcript_window) puis appelle emit_suggestions pour terminer cet appel. Tableau cards vide accepté si rien à proposer. Tu peux aussi appeler write_session_summary avant emit_suggestions.',
        tools,
        emitTools: [emitSuggestions],
        maxIterations: 6,
        loopTimeoutMs: COPILOT_LIMITS.AGENT_LOOP_TIMEOUT_MS,
        feature: 'meeting-analysis',
        projectId: state.projectId,
      })

      // result.output is the args of emit_suggestions (single-emit mode).
      const cards = (result.output.cards ?? []).filter(isValidAgentCard)

      // Persist + tally token spend. write_session_summary and tag_coverage
      // already mutated state directly via their handlers if the agent called them.
      const persisted = await this.persistCards(state, cards)
      this.addTokenSpend(liveSessionId, result.iterations * 1_500)

      return Result.ok({
        cards: persisted,
        summary: state.summary,
        coveredSections: Array.from(state.agentTaggedCoverage),
      })
    } catch (e) {
      if (e instanceof AgentEmitMissedError) {
        this.logger.warn(`Copilot agent missed emit on ${liveSessionId}: ${e.message}`)
        return Result.ok({ cards: [], summary: state.summary, skipped: true, skipReason: 'provider' })
      }
      this.logger.warn(`Copilot fire failed on ${liveSessionId}: ${e instanceof Error ? e.message : String(e)}`)
      return Result.ok({ cards: [], summary: state.summary, skipped: true, skipReason: 'provider' })
    }
  }

  /** Mark a suggestion as dismissed. */
  async dismissSuggestion(suggestionId: string): Promise<Result<void>> {
    try {
      await this.prisma.liveMeetingSuggestion.update({
        where: { id: suggestionId },
        data: { status: 'dismissed' },
      })
      return Result.ok()
    } catch (e) {
      this.logger.warn(`dismissSuggestion failed: ${e instanceof Error ? e.message : String(e)}`)
      return Result.fail('Suggestion introuvable.')
    }
  }

  /** Mark a suggestion as asked (the PM clicked the "Demander maintenant" button). */
  async markAsked(suggestionId: string): Promise<Result<void>> {
    try {
      await this.prisma.liveMeetingSuggestion.update({
        where: { id: suggestionId },
        data: { status: 'asked' },
      })
      return Result.ok()
    } catch (e) {
      this.logger.warn(`markAsked failed: ${e instanceof Error ? e.message : String(e)}`)
      return Result.fail('Suggestion introuvable.')
    }
  }

  /**
   * End a session. If `meetingTranscriptId` is provided, the live cards are
   * patched onto the saved meeting for audit history; otherwise they're
   * left as orphans linked only by `liveSessionId`.
   */
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
    this.logger.log(`Copilot session ended: ${liveSessionId} (fires=${state.fireCount}, cards=${state.cardCount})`)
    return Result.ok()
  }

  /** Internal helper used by Phase 2 to persist agent-emitted cards. */
  async persistCards(
    state: LiveSessionState,
    proposed: Array<{
      question: string
      rationale: string
      urgency: SuggestionUrgency
      section: CahierSection
    }>,
  ): Promise<SuggestionCard[]> {
    if (proposed.length === 0) return []
    const remainingSlot = Math.max(0, COPILOT_LIMITS.MAX_CARDS_PER_MEETING - state.cardCount)
    const toPersist = proposed.slice(0, Math.min(COPILOT_LIMITS.MAX_CARDS_PER_FIRE, remainingSlot))
    if (toPersist.length === 0) return []

    const rows = toPersist.map((c) => ({
      id: randomUUID(),
      projectId: state.projectId,
      liveSessionId: state.liveSessionId,
      meetingTranscriptId: null,
      question: c.question,
      rationale: c.rationale,
      urgency: c.urgency,
      section: VALID_CAHIER_SECTIONS.includes(c.section) ? c.section : 'contexte',
      status: 'pending' as const,
    }))
    await this.prisma.liveMeetingSuggestion.createMany({ data: rows })
    state.cardCount += rows.length

    return rows.map((r) => ({
      id: r.id,
      question: r.question,
      rationale: r.rationale,
      urgency: r.urgency as SuggestionUrgency,
      section: r.section as CahierSection,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }))
  }

  /** Read for the agent: what cards did we already emit on this session? */
  async fetchEmittedSuggestions(liveSessionId: string): Promise<Array<Pick<SuggestionCard, 'question' | 'section' | 'status'>>> {
    const rows = await this.prisma.liveMeetingSuggestion.findMany({
      where: { liveSessionId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { question: true, section: true, status: true },
    })
    return rows.map((r) => ({
      question: r.question,
      section: r.section as CahierSection,
      status: r.status as 'pending' | 'dismissed' | 'asked',
    }))
  }

  /** Internal — expose state for the agent tool factory in Phase 2. */
  getState(liveSessionId: string): LiveSessionState | undefined {
    return this.sessions.get(liveSessionId)
  }

  /** Internal — used after agent fire to track cumulative token spend. */
  addTokenSpend(liveSessionId: string, tokens: number): void {
    const state = this.sessions.get(liveSessionId)
    if (state) state.tokenSpend += tokens
  }

  /** Internal — used after agent fire to update the rolling summary. */
  updateSummary(liveSessionId: string, summary: string): void {
    const state = this.sessions.get(liveSessionId)
    if (state) state.summary = summary.slice(0, 600)
  }

  // ─── Internal — idle session sweep ───────────────────────────────────────────

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

interface AgentCard {
  question: string
  rationale: string
  urgency: SuggestionUrgency
  section: CahierSection
}

function isValidAgentCard(value: unknown): value is AgentCard {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  if (typeof c.question !== 'string' || c.question.trim().length === 0) return false
  if (typeof c.rationale !== 'string') return false
  if (c.urgency !== 'low' && c.urgency !== 'medium' && c.urgency !== 'high') return false
  if (typeof c.section !== 'string') return false
  return VALID_CAHIER_SECTIONS.includes(c.section as CahierSection)
}
