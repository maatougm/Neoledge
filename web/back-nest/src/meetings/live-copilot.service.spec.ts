/**
 * @file live-copilot.service.spec.ts — unit tests for the real-time
 *   copilot orchestrator. Mocks PrismaService + AgentRunnerService.
 *   The service mounts a `setInterval(...).unref()` in its constructor;
 *   `jest.useFakeTimers()` is used selectively so the spec doesn't leak
 *   timers, and the constructor's interval is harmless under fake timers
 *   because it never advances.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { LiveCopilotService } from './live-copilot.service'
import { PrismaService } from '../prisma/prisma.service'
import { AgentRunnerService } from '../ai/agent/agent-runner.service'
import { AgentEmitMissedError } from '../ai/agent/agent-errors'
import { COPILOT_LIMITS, DEFAULT_MEETING_TYPE } from './live-copilot.types'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPrisma = {
  liveMeetingSuggestion: {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
}

const mockAgentRunner = {
  run: jest.fn(),
  isAgentModeAvailable: jest.fn().mockReturnValue(true),
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('LiveCopilotService', () => {
  let service: LiveCopilotService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPrisma.liveMeetingSuggestion.findMany.mockResolvedValue([])

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveCopilotService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentRunnerService, useValue: mockAgentRunner },
      ],
    }).compile()

    service = module.get<LiveCopilotService>(LiveCopilotService)
  })

  // ── Session lifecycle ─────────────────────────────────────────────────────

  describe('startSession', () => {
    it('creates a fresh session with the supplied meeting type', () => {
      const r = service.startSession('p1', 'live-1', 'u1', 'kickoff')
      expect(r.isSuccess).toBe(true)
      const state = r.value!
      expect(state.liveSessionId).toBe('live-1')
      expect(state.projectId).toBe('p1')
      expect(state.userId).toBe('u1')
      expect(state.meetingType).toBe('kickoff')
      expect(state.fireCount).toBe(0)
      expect(state.checklist).toEqual([])
    })

    it('falls back to DEFAULT_MEETING_TYPE on an invalid type', () => {
      const r = service.startSession('p1', 'live-2', 'u1', 'bogus' as unknown as 'kickoff')
      expect(r.value!.meetingType).toBe(DEFAULT_MEETING_TYPE)
    })

    it('returns the existing session and updates type when called twice', () => {
      service.startSession('p1', 'live-3', 'u1', 'kickoff')
      const r = service.startSession('p1', 'live-3', 'u1', 'cadrage')
      expect(r.isSuccess).toBe(true)
      expect(r.value!.meetingType).toBe('cadrage')
      expect(service.getState('live-3')!.meetingType).toBe('cadrage')
    })

    it('ignores invalid meeting type on a second start', () => {
      service.startSession('p1', 'live-4', 'u1', 'kickoff')
      const r = service.startSession('p1', 'live-4', 'u1', 'bogus' as unknown as 'kickoff')
      expect(r.value!.meetingType).toBe('kickoff')
    })
  })

  describe('endSession', () => {
    it('removes the session and is idempotent (no-op when missing)', async () => {
      service.startSession('p1', 'live-end-1', 'u1')
      const r = await service.endSession('live-end-1')
      expect(r.isSuccess).toBe(true)
      expect(service.getState('live-end-1')).toBeUndefined()

      const r2 = await service.endSession('does-not-exist')
      expect(r2.isSuccess).toBe(true)
    })

    it('links pending suggestion rows to the saved transcript', async () => {
      mockPrisma.liveMeetingSuggestion.updateMany.mockResolvedValue({ count: 3 })
      service.startSession('p1', 'live-end-2', 'u1')

      await service.endSession('live-end-2', 'mt-99')

      expect(mockPrisma.liveMeetingSuggestion.updateMany).toHaveBeenCalledWith({
        where: { liveSessionId: 'live-end-2', meetingTranscriptId: null },
        data: { meetingTranscriptId: 'mt-99' },
      })
    })

    it('swallows DB errors during the link step', async () => {
      mockPrisma.liveMeetingSuggestion.updateMany.mockRejectedValue(new Error('DB down'))
      service.startSession('p1', 'live-end-3', 'u1')

      const r = await service.endSession('live-end-3', 'mt-100')
      expect(r.isSuccess).toBe(true)
    })
  })

  // ── appendTranscript ──────────────────────────────────────────────────────

  describe('appendTranscript', () => {
    it('returns Result.fail when the session does not exist', () => {
      const r = service.appendTranscript('missing', 'hello')
      expect(r.isFailure).toBe(true)
    })

    it('does not fire on the first short append', () => {
      service.startSession('p1', 'live-a1', 'u1')
      const r = service.appendTranscript('live-a1', 'a small chunk')
      expect(r.isSuccess).toBe(true)
      expect(r.value!.shouldFire).toBe(false)
    })

    it('flags shouldFire when accumulated chars cross MIN_CONTENT_CHARS and interval elapsed', () => {
      service.startSession('p1', 'live-a2', 'u1')

      // First append is below threshold.
      service.appendTranscript('live-a2', 'x'.repeat(50))
      // Second append puts us over MIN_CONTENT_CHARS (80 by default).
      const r = service.appendTranscript('live-a2', 'y'.repeat(60))
      expect(r.value!.shouldFire).toBe(true)
    })

    it('dedupes by the last-100-chars hash of the chunk', () => {
      service.startSession('p1', 'live-a3', 'u1')

      service.appendTranscript('live-a3', 'first chunk text')
      const dupe = service.appendTranscript('live-a3', 'first chunk text')
      expect(dupe.value!.shouldFire).toBe(false)
      // The buffer should not have grown the second time.
      expect(service.getState('live-a3')!.totalCharsAppended).toBe('first chunk text'.length)
    })

    it('ignores empty chunks', () => {
      service.startSession('p1', 'live-a4', 'u1')
      const r = service.appendTranscript('live-a4', '')
      expect(r.value!.shouldFire).toBe(false)
      expect(service.getState('live-a4')!.totalCharsAppended).toBe(0)
    })

    it('keeps the ring buffer capped to TRANSCRIPT_BUFFER_MAX_CHARS', () => {
      service.startSession('p1', 'live-a5', 'u1')

      // Push 3 × the cap, one chunk at a time (each chunk has a different
      // tail-100 so the dedupe hash doesn't trip).
      const cap = COPILOT_LIMITS.TRANSCRIPT_BUFFER_MAX_CHARS
      for (let i = 0; i < 3; i++) {
        service.appendTranscript('live-a5', 'A'.repeat(cap) + `-${i}`)
      }
      const state = service.getState('live-a5')!
      expect(state.transcriptBuffer.length).toBeLessThanOrEqual(cap)
      expect(state.totalCharsAppended).toBeGreaterThanOrEqual(3 * cap)
    })
  })

  // ── fire ──────────────────────────────────────────────────────────────────

  describe('fire', () => {
    function happyEmit(): unknown {
      return {
        checklist: [
          {
            id: 'topic-1',
            topic: 'Volume documentaire',
            question: 'Combien de documents par an ?',
            category: 'context',
            section: 'contexte',
            status: 'missing',
            evidence: '',
            suggestion: { question: 'Pouvez-vous chiffrer le volume annuel ?', rationale: 'Important pour dimensionner.', urgency: 'medium' },
          },
        ],
        hint: 'Demandez le volume documentaire',
        readyForCahier: false,
      }
    }

    function mockRunnerOk(output: unknown = happyEmit(), iterations = 3): void {
      mockAgentRunner.run.mockResolvedValue({
        output,
        iterations,
        toolCallsLog: [],
        provider: 'zai',
        model: 'glm-4.5-air',
      })
    }

    it('returns no_session skip when the session does not exist', async () => {
      const r = await service.fire('missing')
      expect(r.value!.skipped).toBe(true)
      expect(r.value!.skipReason).toBe('no_session')
    })

    it('returns cap_reached when fireCount >= MAX_FIRES_PER_MEETING', async () => {
      service.startSession('p1', 'live-f1', 'u1')
      const state = service.getState('live-f1')!
      state.fireCount = COPILOT_LIMITS.MAX_FIRES_PER_MEETING

      const r = await service.fire('live-f1', true)
      expect(r.value!.skipped).toBe(true)
      expect(r.value!.skipReason).toBe('cap_reached')
      expect(mockAgentRunner.run).not.toHaveBeenCalled()
    })

    it('returns budget skip when tokenSpend >= MAX_TOKENS_PER_MEETING', async () => {
      service.startSession('p1', 'live-f2', 'u1')
      const state = service.getState('live-f2')!
      state.tokenSpend = COPILOT_LIMITS.MAX_TOKENS_PER_MEETING

      const r = await service.fire('live-f2', true)
      expect(r.value!.skipped).toBe(true)
      expect(r.value!.skipReason).toBe('budget')
      expect(mockAgentRunner.run).not.toHaveBeenCalled()
    })

    it('returns cooldown skip when the previous fire was recent and not forced', async () => {
      service.startSession('p1', 'live-f3', 'u1')
      const state = service.getState('live-f3')!
      state.lastFiredAtMs = Date.now() // just fired
      state.checklist = [{ id: 'x', topic: 'T', question: 'Q', category: 'context', section: 'contexte', status: 'missing', evidence: null, suggestion: null, userAction: null }]

      const r = await service.fire('live-f3', false)
      expect(r.value!.skipped).toBe(true)
      expect(r.value!.skipReason).toBe('cooldown')
    })

    it('bypasses cooldown when forced (PM clicked Rafraîchir)', async () => {
      mockRunnerOk()
      service.startSession('p1', 'live-f4', 'u1')
      const state = service.getState('live-f4')!
      state.lastFiredAtMs = Date.now()
      state.lastFiredAtOffset = 0

      const r = await service.fire('live-f4', true)
      expect(r.value!.skipped).toBeFalsy()
      expect(mockAgentRunner.run).toHaveBeenCalled()
    })

    it('happy path: runs the agent loop, sanitises emit, merges into state', async () => {
      mockRunnerOk()
      service.startSession('p1', 'live-f5', 'u1')

      const r = await service.fire('live-f5', true)
      expect(r.isSuccess).toBe(true)
      expect(r.value!.skipped).toBeFalsy()
      expect(r.value!.checklist).toHaveLength(1)
      expect(r.value!.checklist[0].id).toBe('topic-1')
      expect(r.value!.hint).toBe('Demandez le volume documentaire')

      const state = service.getState('live-f5')!
      expect(state.fireCount).toBe(1)
      // 3 iterations × 1500 token estimate.
      expect(state.tokenSpend).toBe(3 * 1500)
    })

    it('sticky covered: when prev=covered and emit=partial, status stays covered', async () => {
      service.startSession('p1', 'live-f6', 'u1')
      const state = service.getState('live-f6')!
      state.checklist = [{
        id: 'sticky', topic: 'Volume', question: 'Q', category: 'context',
        section: 'contexte', status: 'covered', evidence: 'old evidence',
        suggestion: null, userAction: null,
      }]

      mockRunnerOk({
        checklist: [{
          id: 'sticky', topic: 'Volume', question: 'Q', category: 'context',
          section: 'contexte', status: 'partial', evidence: '',
        }],
        hint: '',
        readyForCahier: false,
      })

      const r = await service.fire('live-f6', true)
      expect(r.value!.checklist[0].status).toBe('covered')
    })

    it('empty-emit guard: preserves previous checklist when emit.checklist is empty', async () => {
      service.startSession('p1', 'live-f7', 'u1')
      const state = service.getState('live-f7')!
      state.checklist = [{
        id: 'keep', topic: 'T', question: 'Q', category: 'context',
        section: 'contexte', status: 'missing', evidence: null,
        suggestion: null, userAction: null,
      }]

      mockRunnerOk({ checklist: [], hint: '', readyForCahier: false })

      const r = await service.fire('live-f7', true)
      expect(r.isSuccess).toBe(true)
      expect(r.value!.skipped).toBeFalsy()
      expect(r.value!.checklist).toHaveLength(1)
      expect(r.value!.checklist[0].id).toBe('keep')
    })

    it("empty-emit on a session with no prior checklist returns skip 'provider'", async () => {
      service.startSession('p1', 'live-f8', 'u1')
      mockRunnerOk({ checklist: [], hint: '', readyForCahier: false })

      const r = await service.fire('live-f8', true)
      expect(r.value!.skipped).toBe(true)
      expect(r.value!.skipReason).toBe('provider')
    })

    it('AgentEmitMissedError → bills tokens and returns provider skip', async () => {
      service.startSession('p1', 'live-f9', 'u1')
      mockAgentRunner.run.mockRejectedValue(new AgentEmitMissedError('no emit'))

      const r = await service.fire('live-f9', true)
      expect(r.value!.skipped).toBe(true)
      expect(r.value!.skipReason).toBe('provider')

      // Failure billing: 6 * 1500 = 9000.
      const state = service.getState('live-f9')!
      expect(state.tokenSpend).toBe(9000)
    })

    it('generic agent error → provider skip + failure billing', async () => {
      service.startSession('p1', 'live-fa', 'u1')
      mockAgentRunner.run.mockRejectedValue(new Error('boom'))

      const r = await service.fire('live-fa', true)
      expect(r.value!.skipped).toBe(true)
      expect(r.value!.skipReason).toBe('provider')
      expect(service.getState('live-fa')!.tokenSpend).toBe(9000)
    })

    it('concurrency guard: a second fire while inFlight returns cooldown', async () => {
      service.startSession('p1', 'live-fb', 'u1')
      // Hold the runner so the first fire is still in flight when the second
      // is invoked.
      let release!: (v: unknown) => void
      mockAgentRunner.run.mockReturnValue(new Promise((resolve) => { release = resolve }))

      const first = service.fire('live-fb', true)
      // Yield so first reaches the runner.run await.
      await new Promise((r) => setImmediate(r))

      const second = await service.fire('live-fb', true)
      expect(second.value!.skipReason).toBe('cooldown')

      // Unblock the first call so we don't leak the promise.
      release({ output: { checklist: [], hint: '', readyForCahier: false }, iterations: 1, toolCallsLog: [], provider: 'zai', model: 'glm-4.5-air' })
      await first
    })
  })

  // ── recordItemAction ──────────────────────────────────────────────────────

  describe('recordItemAction', () => {
    it('soft no-op when the session was wiped (server restart)', async () => {
      const r = await service.recordItemAction('missing', 'item-1', 'asked')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toBeNull()
    })

    it('soft no-op when the item id is not in the checklist', async () => {
      service.startSession('p1', 'live-r1', 'u1')
      const r = await service.recordItemAction('live-r1', 'unknown', 'asked')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toBeNull()
    })

    it('records the action and persists the suggestion audit row when present', async () => {
      mockPrisma.liveMeetingSuggestion.create.mockResolvedValue({ id: 'persisted' })
      service.startSession('p1', 'live-r2', 'u1')
      const state = service.getState('live-r2')!
      state.checklist = [{
        id: 'item-q', topic: 'T', question: 'Q', category: 'context',
        section: 'contexte', status: 'missing', evidence: null,
        suggestion: { question: 'Quelle est la deadline ?', rationale: 'Important.', urgency: 'high' },
        userAction: null,
      }]

      const r = await service.recordItemAction('live-r2', 'item-q', 'asked')
      expect(r.isSuccess).toBe(true)
      expect(r.value!.checklist[0].userAction).toBe('asked')
      expect(mockPrisma.liveMeetingSuggestion.create).toHaveBeenCalled()
    })

    it('skips persistence when the checklist item has no suggestion', async () => {
      service.startSession('p1', 'live-r3', 'u1')
      const state = service.getState('live-r3')!
      state.checklist = [{
        id: 'item-x', topic: 'T', question: 'Q', category: 'context',
        section: 'contexte', status: 'missing', evidence: null,
        suggestion: null, userAction: null,
      }]

      const r = await service.recordItemAction('live-r3', 'item-x', 'dismissed')
      expect(r.isSuccess).toBe(true)
      expect(mockPrisma.liveMeetingSuggestion.create).not.toHaveBeenCalled()
    })

    it('swallows persistence errors and still returns success', async () => {
      mockPrisma.liveMeetingSuggestion.create.mockRejectedValue(new Error('DB down'))
      service.startSession('p1', 'live-r4', 'u1')
      const state = service.getState('live-r4')!
      state.checklist = [{
        id: 'item-q', topic: 'T', question: 'Q', category: 'context',
        section: 'contexte', status: 'missing', evidence: null,
        suggestion: { question: 'Q?', rationale: 'R', urgency: 'low' },
        userAction: null,
      }]

      const r = await service.recordItemAction('live-r4', 'item-q', 'asked')
      expect(r.isSuccess).toBe(true)
    })
  })

  // ── Helpers ───────────────────────────────────────────────────────────────

  describe('fetchEmittedSuggestions', () => {
    it('returns the latest 30 rows ordered by createdAt desc', async () => {
      mockPrisma.liveMeetingSuggestion.findMany.mockResolvedValue([
        { question: 'q1', section: 'contexte', status: 'asked' },
        { question: 'q2', section: 'perimetreInclus', status: 'dismissed' },
      ])

      const out = await service.fetchEmittedSuggestions('live-s1')
      expect(out).toEqual([
        { question: 'q1', section: 'contexte', status: 'asked' },
        { question: 'q2', section: 'perimetreInclus', status: 'dismissed' },
      ])
      const callArgs = mockPrisma.liveMeetingSuggestion.findMany.mock.calls[0][0]
      expect(callArgs.take).toBe(30)
      expect(callArgs.orderBy).toEqual({ createdAt: 'desc' })
      expect(callArgs.where).toEqual({ liveSessionId: 'live-s1' })
    })
  })

  describe('addTokenSpend / updateSummary / getState', () => {
    it('addTokenSpend increments the in-memory counter', () => {
      service.startSession('p1', 'live-t1', 'u1')
      service.addTokenSpend('live-t1', 500)
      service.addTokenSpend('live-t1', 250)
      expect(service.getState('live-t1')!.tokenSpend).toBe(750)
    })

    it('addTokenSpend is a no-op for unknown sessions', () => {
      service.addTokenSpend('missing', 100)
      expect(service.getState('missing')).toBeUndefined()
    })

    it('updateSummary truncates to 600 chars', () => {
      service.startSession('p1', 'live-t2', 'u1')
      service.updateSummary('live-t2', 'x'.repeat(1000))
      expect(service.getState('live-t2')!.summary.length).toBe(600)
    })

    it('updateSummary is a no-op for unknown sessions', () => {
      service.updateSummary('missing', 'whatever')
      expect(service.getState('missing')).toBeUndefined()
    })
  })

  // ── Idle session sweep ────────────────────────────────────────────────────

  describe('sweepIdleSessions (via the private interval handler)', () => {
    it('evicts sessions older than SESSION_IDLE_EVICTION_MS', () => {
      service.startSession('p1', 'idle-1', 'u1')
      service.startSession('p1', 'fresh-1', 'u1')

      const idle = service.getState('idle-1')!
      idle.startedAtMs = Date.now() - (COPILOT_LIMITS.SESSION_IDLE_EVICTION_MS + 60_000)
      idle.lastFiredAtMs = 0

      // Reach into the private method — no public sweep API.
      ;(service as unknown as { sweepIdleSessions: () => void }).sweepIdleSessions()

      expect(service.getState('idle-1')).toBeUndefined()
      expect(service.getState('fresh-1')).toBeDefined()
    })

    it('keeps a session alive if lastFiredAtMs is recent even when startedAtMs is old', () => {
      service.startSession('p1', 'recent-fire', 'u1')
      const state = service.getState('recent-fire')!
      state.startedAtMs = Date.now() - 10 * 60 * 60_000
      state.lastFiredAtMs = Date.now() - 1_000

      ;(service as unknown as { sweepIdleSessions: () => void }).sweepIdleSessions()

      expect(service.getState('recent-fire')).toBeDefined()
    })
  })
})
