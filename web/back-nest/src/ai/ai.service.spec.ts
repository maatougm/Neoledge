/**
 * @file ai.service.spec.ts — unit tests for `AiService`.
 *
 * Covers:
 *   - `onModuleInit()` stuck-row sweep (success, no-op, error swallowed)
 *   - `analyzeTranscript()`:
 *     - concurrency guard (already-processing skip + missing row error log)
 *     - single-shot happy path (primary provider analyse → transaction
 *       writes summary/items/decisions, fires embedding hook, PM notify,
 *       activity log)
 *     - agent-mode happy path (runTranscriptAgent called when
 *       AI_AGENT_MODE includes 'transcript' AND the runner is available)
 *     - agent-mode fallthrough on AgentEmitMissedError → single-shot
 *     - agent-mode non-Emit error propagates to outer catch
 *     - outer catch sanitises API keys and writes failed activity row
 *
 * Strategy mirrors `cahier-stream.spec.ts`: Nest TestingModule with full
 * mocks per dep; the runTranscriptAgent function (imported at module
 * scope inside ai.service) is mocked with jest.mock() so agent mode can
 * be exercised without spinning up the real runner.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service.js'
import { AiProviderFactory } from './ai-provider.factory.js'
import { AgentRunnerService } from './agent/agent-runner.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { EmbeddingIndexerService } from './embeddings/embedding-indexer.service.js'
import { AgentEmitMissedError } from './agent/agent-errors.js'
import { AiService } from './ai.service.js'
import type { AiAnalysisResult } from './ai.types.js'

// Mock the transcript-agent module so we can control the agent-mode path
// without instantiating the real runner. Path matches the SUT's import
// (the `.js` extension is stripped by jest's moduleNameMapper).
jest.mock('./transcript-agent', () => ({
  runTranscriptAgent: jest.fn(),
}))
import { runTranscriptAgent } from './transcript-agent.js'
const mockedAgent = runTranscriptAgent as jest.MockedFunction<typeof runTranscriptAgent>

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeAnalysis(overrides: Partial<AiAnalysisResult> = {}): AiAnalysisResult {
  return {
    summary: 'Résumé court de la réunion.',
    actionItems: [{ description: 'Préparer le draft', assigneeName: 'Alice', dueDate: '2026-06-01' }],
    decisions: [{ description: 'Décision: utiliser Vue 3', category: 'decision' }],
    ...overrides,
  }
}

function makeTranscriptRow() {
  return {
    id: 't-1',
    projectId: 'proj-1',
    aiStatus: 'pending',
    segments: [
      { speaker: 'PM', text: 'Bienvenue', startTime: 0 },
      { speaker: 'Tech', text: 'Stack confirmée', startTime: 1 },
    ],
  }
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

interface PrismaMock {
  meetingTranscript: {
    updateMany: jest.Mock
    findUnique: jest.Mock
    update: jest.Mock
  }
  meetingActionItem: { deleteMany: jest.Mock; createMany: jest.Mock }
  meetingDecision: { deleteMany: jest.Mock; createMany: jest.Mock }
  project: { findUnique: jest.Mock }
  projectActivity: { create: jest.Mock }
  $transaction: jest.Mock
}

function makeMockPrisma(): PrismaMock {
  const prisma: PrismaMock = {
    meetingTranscript: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(makeTranscriptRow()),
      update: jest.fn().mockResolvedValue(undefined),
    },
    meetingActionItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    meetingDecision: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({ projectManagerId: 'pm-1', name: 'ACME GED' }),
    },
    projectActivity: { create: jest.fn().mockResolvedValue(undefined) },
    // $transaction forwards the callback the same mocks so tx.x.y(...)
    // hits the same jest.fn() instances we assert against.
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation(async (cb: (tx: PrismaMock) => Promise<unknown>) => cb(prisma))
  return prisma
}

interface ServiceContext {
  service: AiService
  prisma: PrismaMock
  primary: { analyze: jest.Mock; modelName: string }
  fallback: { analyze: jest.Mock; modelName: string } | null
  agentRunner: { run: jest.Mock; isAgentModeAvailable: jest.Mock }
  notifications: { notifyEnhanced: jest.Mock; notify: jest.Mock }
  embeddingIndexer: { indexAndStore: jest.Mock }
  config: { get: jest.Mock }
}

async function buildService(opts: {
  agentMode?: string
  agentAvailable?: boolean
  fallback?: { analyze: jest.Mock; modelName: string } | null
  primaryThrows?: Error
} = {}): Promise<ServiceContext> {
  const prisma = makeMockPrisma()
  const primary = { analyze: jest.fn().mockResolvedValue(makeAnalysis()), modelName: 'glm-4.5-air' }
  if (opts.primaryThrows) primary.analyze.mockRejectedValue(opts.primaryThrows)
  const fallback = opts.fallback === undefined ? null : opts.fallback
  const providerFactory = {
    getPrimary: jest.fn().mockReturnValue(primary),
    getFallback: jest.fn().mockReturnValue(fallback),
  }
  const agentRunner = {
    run: jest.fn(),
    isAgentModeAvailable: jest.fn().mockReturnValue(opts.agentAvailable ?? true),
  }
  const notifications = { notifyEnhanced: jest.fn().mockResolvedValue(undefined), notify: jest.fn() }
  const embeddingIndexer = {
    indexAndStore: jest.fn().mockResolvedValue({ indexed: 1, failed: 0 }),
  }
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'AI_AGENT_MODE') return opts.agentMode ?? 'off'
      return undefined
    }),
  }

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AiService,
      { provide: PrismaService, useValue: prisma },
      { provide: AiProviderFactory, useValue: providerFactory },
      { provide: ConfigService, useValue: config },
      { provide: AgentRunnerService, useValue: agentRunner },
      { provide: NotificationsService, useValue: notifications },
      { provide: EmbeddingIndexerService, useValue: embeddingIndexer },
    ],
  }).compile()

  const service = module.get<AiService>(AiService)
  return { service, prisma, primary, fallback, agentRunner, notifications, embeddingIndexer, config }
}

/** Flush the microtask queue so fire-and-forget `void promise.catch(...)`
 *  side-effects (embedding indexer call, PM notify, activity log) have
 *  landed before the test asserts on them. */
async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockedAgent.mockReset()
  jest.clearAllMocks()
})

describe('AiService.onModuleInit (stuck-row sweep)', () => {
  it('marks stuck rows as failed and logs the count', async () => {
    const { service, prisma } = await buildService()
    prisma.meetingTranscript.updateMany.mockResolvedValueOnce({ count: 3 })

    await service.onModuleInit()

    expect(prisma.meetingTranscript.updateMany).toHaveBeenCalledWith({
      where: { aiStatus: 'processing', aiStartedAt: { lt: expect.any(Date) } },
      data: { aiStatus: 'failed', aiError: 'Timed out (abandoned on restart)' },
    })
  })

  it('does not log when nothing was stuck', async () => {
    const { service, prisma } = await buildService()
    prisma.meetingTranscript.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(service.onModuleInit()).resolves.toBeUndefined()
    expect(prisma.meetingTranscript.updateMany).toHaveBeenCalled()
  })

  it('swallows a Prisma error — never throws on startup', async () => {
    const { service, prisma } = await buildService()
    prisma.meetingTranscript.updateMany.mockRejectedValueOnce(new Error('DB down'))

    await expect(service.onModuleInit()).resolves.toBeUndefined()
  })
})

describe('AiService.analyzeTranscript — concurrency guard', () => {
  it('returns early when row is already processing (updateMany count=0)', async () => {
    const { service, prisma, primary } = await buildService()
    prisma.meetingTranscript.updateMany.mockResolvedValueOnce({ count: 0 })
    prisma.meetingTranscript.findUnique.mockResolvedValueOnce({ id: 't-1', aiStatus: 'processing' })

    await service.analyzeTranscript('t-1')

    // Provider must NOT have been touched.
    expect(primary.analyze).not.toHaveBeenCalled()
    // No transaction either.
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns early when transcript is missing (logs error path)', async () => {
    const { service, prisma, primary } = await buildService()
    prisma.meetingTranscript.updateMany.mockResolvedValueOnce({ count: 0 })
    prisma.meetingTranscript.findUnique.mockResolvedValueOnce(null)
    const errorSpy = jest.spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')

    await service.analyzeTranscript('missing-id')

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('is missing'))
    expect(primary.analyze).not.toHaveBeenCalled()
  })

  it('returns early with a warn-level log when already processing', async () => {
    const { service, prisma } = await buildService()
    prisma.meetingTranscript.updateMany.mockResolvedValueOnce({ count: 0 })
    prisma.meetingTranscript.findUnique.mockResolvedValueOnce({ id: 't-1', aiStatus: 'processing' })
    const warnSpy = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')

    await service.analyzeTranscript('t-1')

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already processing'))
  })
})

describe('AiService.analyzeTranscript — single-shot happy path (agent mode off)', () => {
  it('persists summary + items + decisions in a transaction, fires embedding hook, notifies PM', async () => {
    const ctx = await buildService({ agentMode: 'off' })

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    // The primary provider was consulted.
    expect(ctx.primary.analyze).toHaveBeenCalledWith(
      'PM: Bienvenue\nTech: Stack confirmée',
      ['PM', 'Tech'],
    )

    // Transaction wrote summary + cleared previous items + recreated.
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(ctx.prisma.meetingActionItem.deleteMany).toHaveBeenCalledWith({ where: { transcriptId: 't-1' } })
    expect(ctx.prisma.meetingDecision.deleteMany).toHaveBeenCalledWith({ where: { transcriptId: 't-1' } })
    expect(ctx.prisma.meetingTranscript.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't-1' },
      data: expect.objectContaining({
        aiSummary: 'Résumé court de la réunion.',
        aiStatus: 'completed',
        aiModel: 'glm-4.5-air',
        aiError: null,
      }),
    }))
    expect(ctx.prisma.meetingActionItem.createMany).toHaveBeenCalled()
    expect(ctx.prisma.meetingDecision.createMany).toHaveBeenCalled()

    // Fire-and-forget side-effects landed.
    expect(ctx.embeddingIndexer.indexAndStore).toHaveBeenCalledWith(
      'summary',
      [{ id: 't-1', text: 'Résumé court de la réunion.' }],
      { projectId: 'proj-1' },
    )
    expect(ctx.prisma.projectActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'proj-1',
        action: 'ai_analysis_completed',
      }),
    })
    expect(ctx.notifications.notifyEnhanced).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'pm-1',
      type: 'meeting_ai_completed',
      projectId: 'proj-1',
      entityType: 'meeting',
      entityId: 't-1',
    }))
  })

  it('skips action items + decisions persistence when the provider returns empty arrays', async () => {
    const ctx = await buildService({ agentMode: 'off' })
    ctx.primary.analyze.mockResolvedValueOnce(makeAnalysis({ actionItems: [], decisions: [] }))

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    expect(ctx.prisma.meetingActionItem.createMany).not.toHaveBeenCalled()
    expect(ctx.prisma.meetingDecision.createMany).not.toHaveBeenCalled()
    // But the update with status: 'completed' still ran.
    expect(ctx.prisma.meetingTranscript.update).toHaveBeenCalled()
  })

  it('does NOT notify when the project has no PM assigned', async () => {
    const ctx = await buildService({ agentMode: 'off' })
    ctx.prisma.project.findUnique.mockResolvedValueOnce({ projectManagerId: null, name: 'orphan' })

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    expect(ctx.notifications.notifyEnhanced).not.toHaveBeenCalled()
  })

  it('falls back to the fallback provider when primary rejects', async () => {
    const fallback = { analyze: jest.fn().mockResolvedValue(makeAnalysis({ summary: 'fallback summary' })), modelName: 'gpt-4o-mini' }
    const ctx = await buildService({
      agentMode: 'off',
      primaryThrows: new Error('Z.AI 429'),
      fallback,
    })

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    expect(fallback.analyze).toHaveBeenCalled()
    // Update should record the fallback model name with the '(fallback)' suffix.
    expect(ctx.prisma.meetingTranscript.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ aiModel: 'gpt-4o-mini (fallback)' }),
    }))
  })

  it('marks the row failed with sanitised error when both providers throw', async () => {
    const fallback = { analyze: jest.fn().mockRejectedValue(new Error('OpenAI 500')), modelName: 'gpt-4o-mini' }
    const ctx = await buildService({
      agentMode: 'off',
      primaryThrows: new Error('Z.AI 429'),
      fallback,
    })

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    // Outer catch wrote the failure record.
    expect(ctx.prisma.meetingTranscript.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't-1' },
      data: expect.objectContaining({
        aiStatus: 'failed',
        aiError: 'OpenAI 500',
      }),
    }))
    // Activity log captured the failure too.
    expect(ctx.prisma.projectActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'ai_analysis_failed' }),
    })
  })
})

describe('AiService.analyzeTranscript — agent-mode path', () => {
  it("invokes runTranscriptAgent when AI_AGENT_MODE='transcript'", async () => {
    const ctx = await buildService({ agentMode: 'transcript', agentAvailable: true })
    mockedAgent.mockResolvedValueOnce(makeAnalysis({ summary: 'agent summary' }))

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    expect(mockedAgent).toHaveBeenCalledWith(
      ctx.agentRunner,
      expect.anything(),
      'proj-1',
      't-1',
    )
    // Single-shot provider must NOT have been touched.
    expect(ctx.primary.analyze).not.toHaveBeenCalled()
    // Update recorded the 'agent-mode' model tag.
    expect(ctx.prisma.meetingTranscript.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ aiSummary: 'agent summary', aiModel: 'agent-mode' }),
    }))
  })

  it("AI_AGENT_MODE='all' also engages the agent", async () => {
    const ctx = await buildService({ agentMode: 'all', agentAvailable: true })
    mockedAgent.mockResolvedValueOnce(makeAnalysis())

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    expect(mockedAgent).toHaveBeenCalled()
  })

  it('does NOT engage the agent when the runner reports it unavailable', async () => {
    const ctx = await buildService({ agentMode: 'transcript', agentAvailable: false })

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    expect(mockedAgent).not.toHaveBeenCalled()
    expect(ctx.primary.analyze).toHaveBeenCalled()
  })

  it('falls back to single-shot on AgentEmitMissedError', async () => {
    const ctx = await buildService({ agentMode: 'transcript', agentAvailable: true })
    mockedAgent.mockRejectedValueOnce(new AgentEmitMissedError('no emit after 8 iter'))

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    // The single-shot provider picked up the slack.
    expect(ctx.primary.analyze).toHaveBeenCalled()
    expect(ctx.prisma.meetingTranscript.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ aiStatus: 'completed' }),
    }))
  })

  it('marks failed on non-EmitMissed agent errors (no fallthrough)', async () => {
    const ctx = await buildService({ agentMode: 'transcript', agentAvailable: true })
    mockedAgent.mockRejectedValueOnce(new Error('agent runner crashed'))

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    expect(ctx.primary.analyze).not.toHaveBeenCalled()
    expect(ctx.prisma.meetingTranscript.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        aiStatus: 'failed',
        aiError: 'agent runner crashed',
      }),
    }))
  })
})

describe('AiService.analyzeTranscript — error sanitisation', () => {
  it('strips an OpenAI sk- key from the persisted aiError', async () => {
    const secretKey = 'sk-proj-AAAA1234567890BBBBccccDDDDeeeeFFFFggggHHHH'
    const ctx = await buildService({
      agentMode: 'off',
      primaryThrows: new Error(`Auth failed with ${secretKey}`),
    })

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    const updateCall = ctx.prisma.meetingTranscript.update.mock.calls.find((c) => (c[0] as { data?: { aiStatus?: string } })?.data?.aiStatus === 'failed')
    expect(updateCall).toBeDefined()
    const persistedError = (updateCall![0] as { data: { aiError: string } }).data.aiError
    expect(persistedError).not.toContain(secretKey)
    expect(persistedError).toContain('[REDACTED_OPENAI_KEY]')
  })

  it('strips a Gemini AIza- key and a Bearer token from the persisted aiError', async () => {
    const gemKey = 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const bearer = 'Bearer abc.def.ghijkl_mn-opqrstuv'
    const ctx = await buildService({
      agentMode: 'off',
      primaryThrows: new Error(`Provider error: ${gemKey} and ${bearer}`),
    })

    await ctx.service.analyzeTranscript('t-1')
    await flushMicrotasks()

    const updateCall = ctx.prisma.meetingTranscript.update.mock.calls.find((c) => (c[0] as { data?: { aiStatus?: string } })?.data?.aiStatus === 'failed')
    const persistedError = (updateCall![0] as { data: { aiError: string } }).data.aiError
    expect(persistedError).toContain('[REDACTED_GEMINI_KEY]')
    expect(persistedError).toContain('Bearer [REDACTED]')
    expect(persistedError).not.toContain(gemKey)
    expect(persistedError).not.toContain('abc.def.ghijkl_mn-opqrstuv')
  })
})
