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
import {
  COPILOT_LIMITS,
  type CahierSection,
  type LiveCopilotFireResult,
  type LiveSessionState,
  type SuggestionCard,
  type SuggestionUrgency,
  VALID_CAHIER_SECTIONS,
} from './live-copilot.types.js'

@Injectable()
export class LiveCopilotService {
  private readonly logger = new Logger(LiveCopilotService.name)
  private readonly sessions = new Map<string, LiveSessionState>()

  constructor(private readonly prisma: PrismaService) {
    // Idle session sweep — runs every 5 min, evicts sessions older than the cap.
    setInterval(() => this.sweepIdleSessions(), 5 * 60_000).unref()
  }

  /** Start (or re-attach to) a live session. Idempotent. */
  startSession(projectId: string, liveSessionId: string, userId: string): Result<LiveSessionState> {
    const existing = this.sessions.get(liveSessionId)
    if (existing) {
      // Idempotent: same session id already active. Return current state.
      return Result.ok(existing)
    }
    const state: LiveSessionState = {
      liveSessionId,
      projectId,
      userId,
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
    this.logger.log(`Copilot session started: ${liveSessionId} (project=${projectId})`)
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
   * Phase 1 stub — returns no cards. Phase 2 wires this to AgentRunnerService.
   * Always logs telemetry (fire count, content size) and decrements caps as
   * if a real fire had happened so the integration tests for caps still pass.
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

    // Phase 1 stub. Phase 2 replaces with: agentRunner.run(...) + persist cards.
    return Result.ok({ cards: [], summary: state.summary })
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
