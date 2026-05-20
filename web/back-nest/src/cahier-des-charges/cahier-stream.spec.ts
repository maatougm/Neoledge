/**
 * @file cahier-stream.spec.ts — unit tests for the Phase 3 streaming path
 *   (`CahierDesChargesService.streamCahierContent`).
 *
 * Strategy: instantiate the service with minimal mocks (no Nest TestingModule
 * — the service has lots of unrelated deps and we only need the streaming
 * path to work). Mock zaiFallback.chatWithUsage and capture every event the
 * service emits via `onEvent`. Verify:
 *   - event order: started → 3× (section | group_error) → complete
 *   - graceful degradation when one group's LLM call rejects
 *   - abort behaviour when the supplied AbortSignal fires before the LLM
 *     calls settle
 *   - the complete event always carries 9 keys (missing groups get
 *     INFO_MANQUANTE placeholders so the saved cahier never has undefined)
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { CahierDesChargesService } from './cahier-des-charges.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ZaiFallbackProvider } from '../ai/providers/zai-fallback.provider.js'
import { AiUsageService } from '../ai-usage/ai-usage.service.js'
import { AgentRunnerService } from '../ai/agent/agent-runner.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { EmbeddingsService } from '../ai/embeddings/embeddings.service.js'
import type { CahierFormData, CahierTranscriptInput, CahierStreamEvent } from './cahier-des-charges.types.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFormData(): CahierFormData {
  return {
    projectName: 'EVAL-Test',
    clientName: 'ACME',
    projectManagerName: 'Alice PM',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    priority: 'Normal',
    status: 'Active',
    fields: [
      { label: 'Contexte et problématique', value: 'Le client veut une GED.', fieldType: 'Text' },
      { label: 'Stack technique proposée',  value: 'Vue 3 + NestJS + PostgreSQL.', fieldType: 'Text' },
    ],
  }
}

function makeTranscripts(): CahierTranscriptInput[] {
  return [
    {
      title: 'Kickoff',
      recordedAt: '2026-01-10T10:00:00.000Z',
      durationSeconds: 1800,
      speakers: ['PM', 'Tech Lead'],
      fullText: 'PM: bienvenue ; Tech Lead: stack confirmée.',
      aiSummary: 'Kickoff — stack confirmée.',
      actionItems: [],
      decisions: [{ description: 'Stack: Vue 3 + NestJS', category: 'decision' }],
    },
  ]
}

/** A working group response — minimal valid JSON for one of the three groups. */
const GROUP_RESPONSES: Record<'intro' | 'scope' | 'delivery', string> = {
  intro: JSON.stringify({
    objectifDocument: 'Cadre contractuel de la mission.',
    contexte: 'Le client souhaite une GED.',
    objectifProjet: '- Déployer une GED unifiée.',
  }),
  scope: JSON.stringify({
    perimetreInclus: '- Module GED',
    perimetreExclus: '- Migration des e-mails',
    exigencesFonctionnelles: [
      { title: 'Gestion documentaire', content: '- Capture\n- Classement' },
    ],
  }),
  delivery: JSON.stringify({
    architectureTechnique: [
      { title: 'Frontend', content: '- Vue 3 + PrimeVue' },
    ],
    livrables: '- Plateforme déployée',
    conclusion: 'Synthèse contractuelle.',
  }),
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface MockChatWithUsage {
  (sys: string, user: string, opts?: unknown): Promise<{
    content: string
    promptTokens: number
    completionTokens: number
  }>
}

// Resolve the right group response by sniffing the system prompt — each
// group's system prompt narrows the schema to its 3 keys, so we just look
// at which key list it contains.
function pickGroupFromSystemPrompt(sys: string): 'intro' | 'scope' | 'delivery' {
  if (sys.includes('objectifDocument')) return 'intro'
  if (sys.includes('perimetreInclus'))  return 'scope'
  return 'delivery'
}

function makeMockZai(perGroup: Partial<Record<'intro' | 'scope' | 'delivery', () => Promise<string> | string>>): {
  zai: { isConfigured: () => boolean; chatWithUsage: MockChatWithUsage }
  calls: Array<{ group: 'intro' | 'scope' | 'delivery' }>
} {
  const calls: Array<{ group: 'intro' | 'scope' | 'delivery' }> = []
  const zai = {
    isConfigured: () => true,
    chatWithUsage: jest.fn<ReturnType<MockChatWithUsage>, Parameters<MockChatWithUsage>>(
      async (sys: string) => {
        const group = pickGroupFromSystemPrompt(sys)
        calls.push({ group })
        const resolver = perGroup[group] ?? (() => GROUP_RESPONSES[group])
        const content = await Promise.resolve(resolver())
        return { content, promptTokens: 1000, completionTokens: 500 }
      },
    ) as unknown as MockChatWithUsage,
  }
  return { zai, calls }
}

function makeMockPrisma(): {
  project: { findFirst: jest.Mock; findUnique: jest.Mock }
  projectField: { findMany: jest.Mock }
  cahierFeedback: { findMany: jest.Mock }
} {
  return {
    project: {
      findFirst: jest.fn().mockResolvedValue({ id: 'proj-1', aiOutput: null }),
      findUnique: jest.fn().mockResolvedValue({ id: 'proj-1', aiOutput: null }),
    },
    projectField: { findMany: jest.fn().mockResolvedValue([]) },
    cahierFeedback: { findMany: jest.fn().mockResolvedValue([]) },
  }
}

async function buildService(
  zai: { isConfigured: () => boolean; chatWithUsage: MockChatWithUsage },
  prismaMock: ReturnType<typeof makeMockPrisma>,
  overrides: Partial<{ aiUsage: jest.Mock; configGet: (k: string) => string | undefined }> = {},
): Promise<CahierDesChargesService> {
  const mockAiUsage = {
    log: overrides.aiUsage ?? jest.fn().mockResolvedValue(undefined),
    assertWithinDailyBudget: jest.fn().mockResolvedValue(undefined),
  }
  const mockConfig = {
    get: jest.fn((key: string) => (overrides.configGet ? overrides.configGet(key) : undefined)),
  }
  const mockAgentRunner = { run: jest.fn(), isAgentModeAvailable: () => false }
  const mockNotifications = { notify: jest.fn(), notifyEnhanced: jest.fn() }
  const mockEmbeddings = { isConfigured: () => false }

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CahierDesChargesService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: ConfigService, useValue: mockConfig },
      { provide: ZaiFallbackProvider, useValue: zai },
      { provide: AiUsageService, useValue: mockAiUsage },
      { provide: AgentRunnerService, useValue: mockAgentRunner },
      { provide: NotificationsService, useValue: mockNotifications },
      { provide: EmbeddingsService, useValue: mockEmbeddings },
    ],
  }).compile()

  return module.get<CahierDesChargesService>(CahierDesChargesService)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CahierDesChargesService.streamCahierContent', () => {
  it('emits started → 3× section → complete in order on the happy path', async () => {
    const { zai, calls } = makeMockZai({})
    const service = await buildService(zai, makeMockPrisma())

    const events: CahierStreamEvent[] = []
    await service.streamCahierContent(
      makeFormData(),
      makeTranscripts(),
      'proj-1',
      (e) => events.push(e),
    )

    expect(calls).toHaveLength(3)
    expect(calls.map((c) => c.group).sort()).toEqual(['delivery', 'intro', 'scope'])

    expect(events[0]).toMatchObject({ type: 'started', totalGroups: 3, transcriptCount: 1 })

    const sections = events.filter((e) => e.type === 'section')
    expect(sections).toHaveLength(3)
    const groupsSeen = new Set(sections.map((s) => (s as { group: string }).group))
    expect(groupsSeen).toEqual(new Set(['intro', 'scope', 'delivery']))

    const last = events[events.length - 1]
    expect(last.type).toBe('complete')
    if (last.type !== 'complete') throw new Error('expected complete event last')
    // All 9 keys present.
    expect(Object.keys(last.aiContent).sort()).toEqual([
      'architectureTechnique', 'conclusion', 'contexte', 'exigencesFonctionnelles',
      'livrables', 'objectifDocument', 'objectifProjet', 'perimetreExclus', 'perimetreInclus',
    ])
    // Real text from the intro group survived the round-trip.
    expect(last.aiContent.contexte).toContain('GED')
  })

  it('emits group_error for the failing group but still completes the others', async () => {
    const { zai } = makeMockZai({
      scope: () => Promise.reject(new Error('Z.AI fallback chat error 429')),
    })
    const service = await buildService(zai, makeMockPrisma())

    const events: CahierStreamEvent[] = []
    await service.streamCahierContent(
      makeFormData(),
      makeTranscripts(),
      'proj-1',
      (e) => events.push(e),
    )

    const errors = events.filter((e) => e.type === 'group_error')
    expect(errors).toHaveLength(1)
    expect((errors[0] as { group: string }).group).toBe('scope')

    const sections = events.filter((e) => e.type === 'section')
    expect(sections.map((s) => (s as { group: string }).group).sort()).toEqual(['delivery', 'intro'])

    const last = events[events.length - 1]
    expect(last.type).toBe('complete')
    if (last.type !== 'complete') throw new Error('expected complete')
    // Missing scope group → its 3 keys default to INFO_MANQUANTE.
    expect(last.aiContent.perimetreInclus).toMatch(/INFO_MANQUANTE/)
    expect(last.aiContent.perimetreExclus).toMatch(/INFO_MANQUANTE/)
    expect(Array.isArray(last.aiContent.exigencesFonctionnelles)).toBe(true)
    // The successful intro group still made it through.
    expect(last.aiContent.contexte).not.toMatch(/INFO_MANQUANTE/)
  })

  it('emits error when zai is not configured', async () => {
    const zai = { isConfigured: () => false, chatWithUsage: jest.fn() as unknown as MockChatWithUsage }
    const service = await buildService(zai, makeMockPrisma())

    const events: CahierStreamEvent[] = []
    await service.streamCahierContent(
      makeFormData(),
      makeTranscripts(),
      'proj-1',
      (e) => events.push(e),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error' })
    expect((events[0] as { message: string }).message).toMatch(/Z\.AI/i)
  })

  it('emits aborted when the supplied AbortSignal fires before LLM calls settle', async () => {
    // Hold all three calls open until we abort.
    const gate: Array<(c: string) => void> = []
    const slowResponder = (group: 'intro' | 'scope' | 'delivery') => () =>
      new Promise<string>((resolve) => { gate.push((c) => resolve(c.length > 0 ? c : GROUP_RESPONSES[group])) })

    const { zai } = makeMockZai({
      intro: slowResponder('intro'),
      scope: slowResponder('scope'),
      delivery: slowResponder('delivery'),
    })
    const service = await buildService(zai, makeMockPrisma())

    const events: CahierStreamEvent[] = []
    const controller = new AbortController()

    const runPromise = service.streamCahierContent(
      makeFormData(),
      makeTranscripts(),
      'proj-1',
      (e) => events.push(e),
      controller.signal,
    )

    // Wait one tick so the service has registered the abort listener.
    await new Promise((r) => setImmediate(r))
    controller.abort()

    // Release the held LLM calls so the service can finish its bookkeeping.
    for (const release of gate) release(GROUP_RESPONSES.intro)
    await runPromise

    expect(events[0].type).toBe('started')
    const aborted = events.find((e) => e.type === 'aborted')
    expect(aborted).toBeDefined()
    expect((aborted as { reason: string }).reason).toBe('client_disconnected')
    // No complete event after abort.
    expect(events.some((e) => e.type === 'complete')).toBe(false)
  })

  it('still emits complete (with INFO_MANQUANTE everywhere) when ALL three groups fail', async () => {
    const { zai } = makeMockZai({
      intro:    () => Promise.reject(new Error('429')),
      scope:    () => Promise.reject(new Error('429')),
      delivery: () => Promise.reject(new Error('429')),
    })
    const service = await buildService(zai, makeMockPrisma())

    const events: CahierStreamEvent[] = []
    await service.streamCahierContent(makeFormData(), makeTranscripts(), 'proj-1', (e) => events.push(e))

    const errors = events.filter((e) => e.type === 'group_error')
    expect(errors).toHaveLength(3)

    const last = events[events.length - 1]
    expect(last.type).toBe('complete')
    if (last.type !== 'complete') throw new Error('expected complete')
    for (const key of [
      'objectifDocument', 'contexte', 'objectifProjet',
      'perimetreInclus', 'perimetreExclus',
      'livrables', 'conclusion',
    ] as const) {
      expect(last.aiContent[key]).toMatch(/INFO_MANQUANTE/)
    }
    expect(last.aiContent.exigencesFonctionnelles).toEqual([])
    expect(last.aiContent.architectureTechnique).toEqual([])
  })
})

describe('CahierDesChargesService.savePersistedCahier — concurrency guard', () => {
  // Enriched prisma mock with the transaction + row-lock surface the save
  // path now uses. $transaction invokes the callback with the same mock as tx.
  function makeSavePrisma() {
    const project = {
      findFirst: jest.fn().mockResolvedValue({ id: 'proj-1', name: 'Proj', aiOutput: null }),
      update: jest.fn().mockResolvedValue({}),
    }
    const prisma = {
      project,
      projectActivity: { create: jest.fn().mockResolvedValue({}) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      cahierVersion: { create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'proj-1' }]),
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prismaPlaceholder)),
    }
    // Self-reference so the tx callback hits the same spies.
    const prismaPlaceholder = prisma
    return prisma
  }

  it('acquires a SELECT … FOR UPDATE row lock inside a transaction', async () => {
    const zai = { isConfigured: () => true, chatWithUsage: jest.fn() as unknown as MockChatWithUsage }
    const prisma = makeSavePrisma()
    const service = await buildService(zai, prisma as never)

    await service.savePersistedCahier('proj-1', { contexte: 'X' }, 'user-1')

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    // The lock query runs before the update.
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      'proj-1',
    )
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'proj-1' } }),
    )
  })

  it('rejects (no update) when the project is soft-deleted / missing', async () => {
    const zai = { isConfigured: () => true, chatWithUsage: jest.fn() as unknown as MockChatWithUsage }
    const prisma = makeSavePrisma()
    prisma.project.findFirst.mockResolvedValueOnce(null)
    const service = await buildService(zai, prisma as never)

    await expect(service.savePersistedCahier('gone', { contexte: 'X' }, 'u1')).rejects.toThrow(
      /introuvable/,
    )
    expect(prisma.project.update).not.toHaveBeenCalled()
  })
})
