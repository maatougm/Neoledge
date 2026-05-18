/**
 * @file cahier-grounding.spec.ts — unit tests for the anti-hallucination
 *  defences:
 *
 *   - applyGroundingCheck  — deterministic regex pass that rewrites every
 *     ungrounded KNOWN_TECH_NAMES mention to INFO_MANQUANTE markers.
 *   - runSelfCritique      — second-pass LLM call that re-reads its own
 *     output against the source corpus.
 *
 *  Both are private. We reach them via bracket access on the service
 *  instance — tests live next to the implementation and are allowed to
 *  poke at internals; this is preferable to exposing them publicly just
 *  for testing.
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
import type { CahierAiResult, CahierFormData, CahierTranscriptInput } from './cahier-des-charges.types.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeFormData(opts: Partial<CahierFormData> = {}): CahierFormData {
  return {
    projectName: 'EVAL-Grounding',
    clientName: 'ACME',
    projectManagerName: 'Alice PM',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    priority: 'Normal',
    status: 'Active',
    fields: [],
    ...opts,
  }
}

function makeTranscripts(): CahierTranscriptInput[] {
  return []
}

function makeResult(overrides: Partial<CahierAiResult> = {}): CahierAiResult {
  return {
    objectifDocument: '',
    contexte: '',
    objectifProjet: '',
    perimetreInclus: '',
    perimetreExclus: '',
    exigencesFonctionnelles: [],
    architectureTechnique: [],
    livrables: '',
    conclusion: '',
    ...overrides,
  }
}

// ─── Test harness ────────────────────────────────────────────────────────────

interface MockZai {
  isConfigured: jest.Mock
  chatWithUsage: jest.Mock
}

async function buildService(
  zai: MockZai,
): Promise<CahierDesChargesService> {
  const mockConfig = { get: jest.fn().mockReturnValue(undefined) }
  const mockPrisma = {}
  const mockAgentRunner = { run: jest.fn(), isAgentModeAvailable: () => false }
  const mockNotifications = { notify: jest.fn(), notifyEnhanced: jest.fn() }
  const mockEmbeddings = { isConfigured: () => false }
  const mockAiUsage = {
    log: jest.fn().mockResolvedValue(undefined),
    assertWithinDailyBudget: jest.fn().mockResolvedValue(undefined),
  }

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CahierDesChargesService,
      { provide: PrismaService, useValue: mockPrisma },
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

// ─── applyGroundingCheck ─────────────────────────────────────────────────────

describe('applyGroundingCheck (deterministic regex pass)', () => {
  let service: CahierDesChargesService
  let svc: { applyGroundingCheck: (r: CahierAiResult, corpus: string) => CahierAiResult; buildSourceCorpus: (f: CahierFormData, t: CahierTranscriptInput[]) => string }

  beforeAll(async () => {
    const zai: MockZai = { isConfigured: jest.fn().mockReturnValue(false), chatWithUsage: jest.fn() }
    service = await buildService(zai)
    svc = service as unknown as typeof svc
  })

  it('preserves tech names that ARE in the source corpus', () => {
    const corpus = 'postgresql + nestjs + docker'
    const input = makeResult({
      architectureTechnique: [
        { title: 'Backend', content: 'NestJS sur PostgreSQL, déployé via Docker' },
      ],
    })

    const out = svc.applyGroundingCheck(input, corpus)

    expect(out.architectureTechnique[0].content).toContain('NestJS')
    expect(out.architectureTechnique[0].content).toContain('PostgreSQL')
    expect(out.architectureTechnique[0].content).toContain('Docker')
    expect(out.architectureTechnique[0].content).not.toMatch(/INFO_MANQUANTE/)
  })

  it('rewrites ungrounded tech names to INFO_MANQUANTE markers', () => {
    // The source mentions only PostgreSQL. AWS / DocuSign are inventions.
    const corpus = 'postgresql'
    const input = makeResult({
      architectureTechnique: [
        { title: 'Cloud', content: 'Hébergement AWS avec signature DocuSign' },
      ],
    })

    const out = svc.applyGroundingCheck(input, corpus)

    expect(out.architectureTechnique[0].content).not.toContain('AWS')
    expect(out.architectureTechnique[0].content).not.toContain('DocuSign')
    expect(out.architectureTechnique[0].content).toMatch(/INFO_MANQUANTE/)
  })

  it('rewriting persists across two passes — once-flagged names stay flagged', () => {
    // The implementation isn't strictly idempotent (re-running can re-wrap
    // the marker payload because the original name survives inside the
    // marker text). The safety contract we actually depend on is weaker
    // but still load-bearing: the dangerous bare name "AWS" never leaks
    // back out after the second pass, and the marker prefix remains.
    const corpus = 'postgresql'
    const input = makeResult({
      contexte: 'Stack proposée : PostgreSQL, AWS et MongoDB.',
    })
    const once  = svc.applyGroundingCheck(input, corpus)
    const twice = svc.applyGroundingCheck(once, corpus)
    // The dangerous bare tokens never reappear as standalone names.
    expect(twice.contexte).not.toMatch(/\bAWS\b(?![:\]])/)
    expect(twice.contexte).not.toMatch(/\bMongoDB\b(?![:\]])/)
    // The marker prefix is still present.
    expect(twice.contexte).toMatch(/INFO_MANQUANTE/)
    // And the grounded reference survives.
    expect(twice.contexte).toContain('PostgreSQL')
  })

  it('uses word-boundary matching — French words that contain a tech name fragment are not touched', () => {
    // The KNOWN_TECH_NAMES list deliberately uses disambiguated variants
    // ("vue.js", not "vue") to avoid French collisions on common words.
    const corpus = '' // empty — anything ungrounded would be rewritten
    const input = makeResult({
      contexte: "La vue d'ensemble du projet montre que React.js sera utilisé.",
    })
    const out = svc.applyGroundingCheck(input, corpus)
    // "vue" the French word survives; "React.js" is ungrounded → rewritten.
    expect(out.contexte).toContain("La vue d'ensemble")
    expect(out.contexte).not.toContain('React.js')
  })

  it('scans both array titles and array contents in exigencesFonctionnelles + architectureTechnique', () => {
    const corpus = ''
    const input = makeResult({
      exigencesFonctionnelles: [
        { title: 'Migration depuis SharePoint', content: 'Module Stripe pour paiements' },
      ],
      architectureTechnique: [
        { title: 'Cloud GCP', content: 'API Salesforce intégrée' },
      ],
    })
    const out = svc.applyGroundingCheck(input, corpus)
    expect(out.exigencesFonctionnelles[0].title).not.toContain('SharePoint')
    expect(out.exigencesFonctionnelles[0].content).not.toContain('Stripe')
    expect(out.architectureTechnique[0].title).not.toContain('GCP')
    expect(out.architectureTechnique[0].content).not.toContain('Salesforce')
  })

  it('buildSourceCorpus lowercases the corpus so case-insensitive matching works', () => {
    const corpus = svc.buildSourceCorpus(
      makeFormData({ fields: [{ label: 'Stack', value: 'PostgreSQL + NestJS', fieldType: 'Text' }] }),
      makeTranscripts(),
    )
    expect(corpus).toMatch(/postgresql/)
    expect(corpus).toMatch(/nestjs/)
    // Original casing preserved nowhere — the corpus is normalised.
    expect(corpus).not.toMatch(/PostgreSQL/)
  })
})

// ─── runSelfCritique ─────────────────────────────────────────────────────────

describe('runSelfCritique (second-pass LLM correction)', () => {
  it('returns the candidate untouched when Z.AI is not configured', async () => {
    const zai: MockZai = { isConfigured: jest.fn().mockReturnValue(false), chatWithUsage: jest.fn() }
    const service = await buildService(zai)
    const svc = service as unknown as {
      runSelfCritique: (c: CahierAiResult, f: CahierFormData, t: CahierTranscriptInput[], pid?: string) => Promise<CahierAiResult>
    }

    const candidate = makeResult({ contexte: 'original contexte' })
    const out = await svc.runSelfCritique(candidate, makeFormData(), makeTranscripts())
    expect(out).toEqual(candidate)
    expect(zai.chatWithUsage).not.toHaveBeenCalled()
  })

  it('returns a corrected version when the critique LLM returns valid JSON', async () => {
    // Build a corrected JSON the mock LLM will hand back. Every section is
    // > ~30 chars so the total-length floor (200) passes.
    const corrected: CahierAiResult = {
      objectifDocument: 'Objectif corrigé par la relecture stricte du document.',
      contexte: 'Contexte corrigé sans hallucination du stack technique.',
      objectifProjet: 'Objectif projet ramené aux faits sourcés uniquement.',
      perimetreInclus: '- Module GED contractuel sourcé du questionnaire.',
      perimetreExclus: '- Migration des e-mails Exchange.',
      exigencesFonctionnelles: [{ title: 'GED', content: 'Capture documents.' }],
      architectureTechnique: [],
      livrables: '- Plateforme déployée selon le calendrier convenu.',
      conclusion: 'Synthèse contractuelle sans mention de techno inventée.',
    }
    const zai: MockZai = {
      isConfigured: jest.fn().mockReturnValue(true),
      chatWithUsage: jest.fn().mockResolvedValue({
        content: JSON.stringify(corrected),
        promptTokens: 2000,
        completionTokens: 800,
      }),
    }
    const service = await buildService(zai)
    const svc = service as unknown as {
      runSelfCritique: (c: CahierAiResult, f: CahierFormData, t: CahierTranscriptInput[], pid?: string) => Promise<CahierAiResult>
    }

    const candidate = makeResult({
      contexte: 'Original contexte mentioning AWS and DocuSign (uninvited)',
      conclusion: 'Original conclusion with invented vendors',
    })
    const out = await svc.runSelfCritique(candidate, makeFormData(), makeTranscripts(), 'proj-1')

    expect(zai.chatWithUsage).toHaveBeenCalled()
    expect(out.contexte).toBe(corrected.contexte)
    expect(out.conclusion).toBe(corrected.conclusion)
  })

  it('falls back to the candidate when the critique returns a degenerate (too-short) result', async () => {
    const degenerate: CahierAiResult = {
      objectifDocument: 'INFO_MANQUANTE: 1',
      contexte: 'INFO_MANQUANTE: 2',
      objectifProjet: 'INFO_MANQUANTE: 3',
      perimetreInclus: 'INFO_MANQUANTE: 4',
      perimetreExclus: 'INFO_MANQUANTE: 5',
      exigencesFonctionnelles: [],
      architectureTechnique: [],
      livrables: 'INFO_MANQUANTE: 6',
      conclusion: 'INFO_MANQUANTE: 7',
    }
    const zai: MockZai = {
      isConfigured: jest.fn().mockReturnValue(true),
      chatWithUsage: jest.fn().mockResolvedValue({
        content: JSON.stringify(degenerate),
        promptTokens: 100,
        completionTokens: 100,
      }),
    }
    const service = await buildService(zai)
    const svc = service as unknown as {
      runSelfCritique: (c: CahierAiResult, f: CahierFormData, t: CahierTranscriptInput[], pid?: string) => Promise<CahierAiResult>
    }

    const candidate = makeResult({
      contexte: 'A long enough candidate contexte that should survive the degeneracy fallback path because its total content length exceeds the 200-char guard.',
      conclusion: 'A long enough candidate conclusion paragraph for the same reason — defence-in-depth.',
    })
    const out = await svc.runSelfCritique(candidate, makeFormData(), makeTranscripts(), 'proj-1')

    // Total length of the degenerate result is < 200 chars, so the guard
    // engages and the candidate is returned instead.
    expect(out).toEqual(candidate)
  })

  it('returns the candidate when the critique LLM throws (network / quota / parse error)', async () => {
    const zai: MockZai = {
      isConfigured: jest.fn().mockReturnValue(true),
      chatWithUsage: jest.fn().mockRejectedValue(new Error('Z.AI 429 burst limit')),
    }
    const service = await buildService(zai)
    const svc = service as unknown as {
      runSelfCritique: (c: CahierAiResult, f: CahierFormData, t: CahierTranscriptInput[], pid?: string) => Promise<CahierAiResult>
    }

    const candidate = makeResult({ contexte: 'The original (un-critiqued) contexte that we expect back on LLM failure.' })
    const out = await svc.runSelfCritique(candidate, makeFormData(), makeTranscripts(), 'proj-1')
    expect(out).toEqual(candidate)
  })
})
