/**
 * @file cahier-agent.spec.ts — unit tests for the two cahier agent
 *   entry points exported by `cahier-agent.ts`:
 *
 *     - runCahierAgent(runner, logger, projectId, semantic?)
 *         Drives the runner with the full keyword tool set; when
 *         `semantic.enabled=true`, also registers the semantic tools and
 *         swaps in `SYSTEM_PROMPT_WITH_SEMANTIC`.
 *
 *     - runCahierPlannerWorker(runner, prisma, logger, projectId)
 *         Fires all six read tools in parallel via `runReadSafely`, then
 *         hands the assembled context blob to the runner with
 *         `maxIterations=1, tools=[], emitTools=[emitCahierTool]`. A failing
 *         read does NOT abort the worker call — its slot in the context
 *         blob shows `{error: "..."}` and the worker degrades gracefully.
 *
 *   Both functions are plain async exports, NOT NestJS providers — so we
 *   instantiate dependencies (mock runner, mock prisma, mock embeddings)
 *   directly rather than going through TestingModule.
 */

import { Logger } from '@nestjs/common'
import { runCahierAgent, runCahierPlannerWorker } from './cahier-agent.js'
import type { CahierAiResult } from './cahier-des-charges.types.js'
import type { AgentRunInput, AgentRunResult } from '../ai/agent/agent-types.js'
import {
  readProjectSummaryTool,
  readQuestionnaireTool,
  readValidatedCahierTool,
  readMeetingSummariesTool,
  readValidationFeedbackTool,
} from '../ai/agent/tools/project-tools.js'
import { readMeetingSegmentsTool } from '../ai/agent/tools/cahier-tools.js'
import { readGlossaryTool } from '../ai/agent/tools/glossary-tools.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function fullCahierResult(): CahierAiResult {
  return {
    objectifDocument: 'Objectif du document — cadre contractuel.',
    contexte: 'Contexte — projet client X.',
    objectifProjet: '- Livrer la plateforme.',
    perimetreInclus: '- Module GED',
    perimetreExclus: '- Migration des e-mails',
    exigencesFonctionnelles: [{ title: 'GED', content: '- Capture' }],
    architectureTechnique: [{ title: 'Backend', content: '- NestJS' }],
    livrables: '- Plateforme déployée',
    conclusion: 'Synthèse contractuelle.',
  }
}

function makeRunResult(): AgentRunResult<CahierAiResult> {
  return {
    output: fullCahierResult(),
    iterations: 3,
    toolCallsLog: [
      { iteration: 1, name: 'read_project_summary', args: {}, ok: true, tookMs: 10 },
      { iteration: 2, name: 'read_questionnaire',   args: {}, ok: true, tookMs: 12 },
      { iteration: 3, name: 'emit_cahier',          args: {}, ok: true, tookMs: 8  },
    ],
    provider: 'zai',
    model: 'glm-4.5-air',
  }
}

/** Build a runner double whose `run` returns the canned result and whose
 *  call args are easy to assert on. The single `run` mock is shared with
 *  any other shape `AgentRunnerService` may expose, but only `.run` is
 *  actually exercised by cahier-agent.ts. */
function makeRunner(): {
  runner: { run: jest.Mock<Promise<AgentRunResult<CahierAiResult>>, [AgentRunInput<CahierAiResult>]> }
  lastInput: () => AgentRunInput<CahierAiResult>
} {
  const run = jest.fn(async (_input: AgentRunInput<CahierAiResult>) => makeRunResult())
  return {
    runner: { run },
    lastInput: () => run.mock.calls[0][0],
  }
}

/** A minimal Logger that swallows output — keeps test stdout clean. */
function silentLogger(): Logger {
  const l = new Logger('cahier-agent-spec')
  jest.spyOn(l, 'log').mockImplementation(() => undefined)
  jest.spyOn(l, 'warn').mockImplementation(() => undefined)
  jest.spyOn(l, 'error').mockImplementation(() => undefined)
  return l
}

// ─── runCahierPlannerWorker ──────────────────────────────────────────────────

describe('runCahierPlannerWorker', () => {
  // We spy on each tool's `handler` field so we can:
  //   (a) avoid hitting any real Prisma client,
  //   (b) assert all six handlers fire,
  //   (c) make one handler reject to exercise the failure branch.
  // Restored in afterEach so suites don't leak.

  let projectHandler: jest.SpyInstance
  let questionnaireHandler: jest.SpyInstance
  let validatedCahierHandler: jest.SpyInstance
  let meetingSummariesHandler: jest.SpyInstance
  let validationFeedbackHandler: jest.SpyInstance
  let glossaryHandler: jest.SpyInstance

  beforeEach(() => {
    projectHandler = jest
      .spyOn(readProjectSummaryTool, 'handler')
      .mockResolvedValue({ id: 'p1', name: 'EVAL-Test', clientName: 'ACME', status: 'Active', startDate: '2026-01-01', endDate: '2026-12-31', projectManager: null, memberCount: 1 })
    questionnaireHandler = jest
      .spyOn(readQuestionnaireTool, 'handler')
      .mockResolvedValue({ items: [{ label: 'Contexte', fieldType: 'Text', isRequired: true, isBacklogDriver: false, backlogHint: null, value: 'GED migration' }] })
    validatedCahierHandler = jest
      .spyOn(readValidatedCahierTool, 'handler')
      .mockResolvedValue({ saved: false, aiContent: null, savedAt: null })
    meetingSummariesHandler = jest
      .spyOn(readMeetingSummariesTool, 'handler')
      .mockResolvedValue({ summaries: [] })
    validationFeedbackHandler = jest
      .spyOn(readValidationFeedbackTool, 'handler')
      .mockResolvedValue({ items: [] })
    glossaryHandler = jest
      .spyOn(readGlossaryTool, 'handler')
      .mockResolvedValue({ term: '', definition: null })
  })

  afterEach(() => {
    projectHandler.mockRestore()
    questionnaireHandler.mockRestore()
    validatedCahierHandler.mockRestore()
    meetingSummariesHandler.mockRestore()
    validationFeedbackHandler.mockRestore()
    glossaryHandler.mockRestore()
  })

  it('fires all six read tools in parallel BEFORE the runner.run call', async () => {
    const { runner, lastInput } = makeRunner()

    // Capture the order via timestamps. Promise.all means every handler
    // is invoked before any awaits, so the start order is deterministic.
    const handlerStartTimes: Record<string, number> = {}
    let counter = 0
    const stamp = (name: string) => () => { handlerStartTimes[name] = ++counter }
    projectHandler.mockImplementation(async () => { stamp('project')(); return {} })
    questionnaireHandler.mockImplementation(async () => { stamp('questionnaire')(); return { items: [] } })
    validatedCahierHandler.mockImplementation(async () => { stamp('validatedCahier')(); return { saved: false, aiContent: null, savedAt: null } })
    meetingSummariesHandler.mockImplementation(async () => { stamp('meetingSummaries')(); return { summaries: [] } })
    validationFeedbackHandler.mockImplementation(async () => { stamp('validationFeedback')(); return { items: [] } })
    glossaryHandler.mockImplementation(async () => { stamp('glossary')(); return { terms: [] } })

    // Make runner.run record the order it ran relative to the handlers.
    let runnerStartTime = 0
    runner.run.mockImplementation(async () => {
      runnerStartTime = ++counter
      return makeRunResult()
    })

    const prisma = {} as never
    const out = await runCahierPlannerWorker(runner as never, prisma, silentLogger(), 'p1')

    // Every handler ran exactly once.
    expect(projectHandler).toHaveBeenCalledTimes(1)
    expect(questionnaireHandler).toHaveBeenCalledTimes(1)
    expect(validatedCahierHandler).toHaveBeenCalledTimes(1)
    expect(meetingSummariesHandler).toHaveBeenCalledTimes(1)
    expect(validationFeedbackHandler).toHaveBeenCalledTimes(1)
    expect(glossaryHandler).toHaveBeenCalledTimes(1)

    // Every handler started BEFORE the runner.run call.
    const allHandlerStarts = Object.values(handlerStartTimes)
    expect(allHandlerStarts).toHaveLength(6)
    for (const t of allHandlerStarts) expect(t).toBeLessThan(runnerStartTime)

    // The runner output flows through unchanged.
    expect(out).toEqual(fullCahierResult())

    // Sanity on the AgentRunInput.
    const input = lastInput()
    expect(input.tools).toEqual([])
    expect(input.emitTools).toHaveLength(1)
    expect(input.emitTools[0].name).toBe('emit_cahier')
    expect(input.maxIterations).toBe(1)
    expect(input.feature).toBe('cahier')
    expect(input.projectId).toBe('p1')
  })

  it('passes the questionnaire with driverOnly=false (full questionnaire, not just drivers)', async () => {
    const { runner } = makeRunner()
    await runCahierPlannerWorker(runner as never, {} as never, silentLogger(), 'p1')

    // questionnaire is the only tool called with non-empty args by the planner.
    expect(questionnaireHandler).toHaveBeenCalledTimes(1)
    const [args] = questionnaireHandler.mock.calls[0] as [{ driverOnly?: boolean }]
    expect(args).toEqual({ driverOnly: false })
  })

  it('forces emit_cahier via maxIterations=1, tools=[], emitTools=[emitCahierTool]', async () => {
    const { runner, lastInput } = makeRunner()
    await runCahierPlannerWorker(runner as never, {} as never, silentLogger(), 'p1')

    const input = lastInput()
    expect(input.maxIterations).toBe(1)
    expect(input.tools).toEqual([])
    expect(input.emitTools.map((t) => t.name)).toEqual(['emit_cahier'])
    expect(input.userMessage).toBeDefined()
    expect(input.userMessage!).toMatch(/contexte projet rassemblé/)
    expect(input.userMessage!).toMatch(/Appelle MAINTENANT `emit_cahier`/)
  })

  it('builds the context blob from all six reads — each labelled section appears', async () => {
    const { runner, lastInput } = makeRunner()
    await runCahierPlannerWorker(runner as never, {} as never, silentLogger(), 'p1')

    const ctx = lastInput().userMessage!
    // Labels are: PROJET, QUESTIONNAIRE, CAHIER_VALIDE, REUNIONS,
    // RETOURS_VALIDATION, GLOSSAIRE.
    expect(ctx).toContain('## PROJET')
    expect(ctx).toContain('## QUESTIONNAIRE')
    expect(ctx).toContain('## CAHIER_VALIDE')
    expect(ctx).toContain('## REUNIONS')
    expect(ctx).toContain('## RETOURS_VALIDATION')
    expect(ctx).toContain('## GLOSSAIRE')
  })

  it('still runs the worker when one read fails — its slot carries {error:...}', async () => {
    questionnaireHandler.mockRejectedValueOnce(new Error('DB unreachable'))

    const { runner, lastInput } = makeRunner()
    const out = await runCahierPlannerWorker(runner as never, {} as never, silentLogger(), 'p1')

    // Other five handlers still fired.
    expect(projectHandler).toHaveBeenCalledTimes(1)
    expect(validatedCahierHandler).toHaveBeenCalledTimes(1)
    expect(meetingSummariesHandler).toHaveBeenCalledTimes(1)
    expect(validationFeedbackHandler).toHaveBeenCalledTimes(1)
    expect(glossaryHandler).toHaveBeenCalledTimes(1)

    // Runner was still invoked (the failure does NOT short-circuit).
    expect(runner.run).toHaveBeenCalledTimes(1)

    // Worker output is whatever the runner returned.
    expect(out).toEqual(fullCahierResult())

    // The failed read's error message is embedded in the context blob.
    const ctx = lastInput().userMessage!
    expect(ctx).toContain('## QUESTIONNAIRE')
    expect(ctx).toContain('"error":"DB unreachable"')
  })

  it('returns the runner output as-is (no post-processing in the planner-worker)', async () => {
    const customResult: CahierAiResult = {
      ...fullCahierResult(),
      contexte: 'CUSTOM-CONTEXTE-SENTINEL',
    }
    const { runner } = makeRunner()
    runner.run.mockResolvedValueOnce({
      output: customResult,
      iterations: 1,
      toolCallsLog: [],
      provider: 'zai',
      model: 'glm-4.5-air',
    })

    const out = await runCahierPlannerWorker(runner as never, {} as never, silentLogger(), 'p1')
    expect(out).toBe(customResult) // identity — no clone/post-processing
    expect(out.contexte).toBe('CUSTOM-CONTEXTE-SENTINEL')
  })

  it('truncates oversized read payloads in the context blob', async () => {
    // Force one read to return >6000 chars. Implementation TRUNCATE_PER_SECTION = 6000.
    const huge = 'x'.repeat(7000)
    meetingSummariesHandler.mockResolvedValueOnce({ summaries: [huge] })

    const { runner, lastInput } = makeRunner()
    await runCahierPlannerWorker(runner as never, {} as never, silentLogger(), 'p1')

    const ctx = lastInput().userMessage!
    // The expanded section is marked with `[trunc]` and is bounded at ~6000+
    // chars of body plus separators.
    expect(ctx).toContain('[trunc]')
  })

  it('logs a completion message on success', async () => {
    const logger = silentLogger()
    const logSpy = logger.log as unknown as jest.SpyInstance

    const { runner } = makeRunner()
    await runCahierPlannerWorker(runner as never, {} as never, logger, 'p1')

    // Two log lines expected: none from the agent itself (this path doesn't log
    // failures), but the planner-worker writes one summary line on success.
    const messages = logSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m) => m.includes('Cahier planner-worker done'))).toBe(true)
  })
})

// ─── runCahierAgent ──────────────────────────────────────────────────────────

describe('runCahierAgent', () => {
  it('runs with the keyword-only tool set when `semantic` is omitted', async () => {
    const { runner, lastInput } = makeRunner()
    const out = await runCahierAgent(runner as never, silentLogger(), 'p1')

    expect(out).toEqual(fullCahierResult())

    const input = lastInput()
    const toolNames = input.tools.map((t) => t.name)
    // Keyword tools, in the order declared in cahier-agent.ts.
    expect(toolNames).toEqual([
      'read_project_summary',
      'read_questionnaire',
      'read_validated_cahier',
      'read_validation_feedback',
      'read_meeting_summaries',
      'read_meeting_segments',
      'read_glossary',
    ])
    // No semantic tools.
    expect(toolNames).not.toContain('read_relevant_meeting_excerpts')
    expect(toolNames).not.toContain('read_relevant_questionnaire')

    expect(input.emitTools.map((t) => t.name)).toEqual(['emit_cahier'])
    expect(input.maxIterations).toBe(10)
    expect(input.feature).toBe('cahier')
    expect(input.projectId).toBe('p1')
  })

  it('runs with the keyword-only tool set when `semantic.enabled` is false', async () => {
    const { runner, lastInput } = makeRunner()
    const fakeEmbeddings = { isConfigured: () => true } as never
    await runCahierAgent(runner as never, silentLogger(), 'p1', { embeddings: fakeEmbeddings, enabled: false })

    const toolNames = lastInput().tools.map((t) => t.name)
    expect(toolNames).not.toContain('read_relevant_meeting_excerpts')
    expect(toolNames).not.toContain('read_relevant_questionnaire')
  })

  it('registers the semantic tools when `semantic.enabled` is true and embeddings is configured', async () => {
    const { runner, lastInput } = makeRunner()
    const fakeEmbeddings = { isConfigured: () => true } as never

    await runCahierAgent(runner as never, silentLogger(), 'p1', { embeddings: fakeEmbeddings, enabled: true })

    const toolNames = lastInput().tools.map((t) => t.name)
    expect(toolNames).toContain('read_relevant_meeting_excerpts')
    expect(toolNames).toContain('read_relevant_questionnaire')

    // Semantic tools are slotted AFTER read_project_summary and BEFORE the
    // keyword variants — preserves the prompt's hint order.
    expect(toolNames.indexOf('read_project_summary'))
      .toBeLessThan(toolNames.indexOf('read_relevant_meeting_excerpts'))
    expect(toolNames.indexOf('read_relevant_meeting_excerpts'))
      .toBeLessThan(toolNames.indexOf('read_questionnaire'))
  })

  it('falls back to keyword tools when embeddings.isConfigured() returns false (even when enabled=true)', async () => {
    const { runner, lastInput } = makeRunner()
    const fakeEmbeddings = { isConfigured: () => false } as never

    await runCahierAgent(runner as never, silentLogger(), 'p1', { embeddings: fakeEmbeddings, enabled: true })

    const toolNames = lastInput().tools.map((t) => t.name)
    // buildSemanticTools short-circuits to [] when isConfigured() is false.
    expect(toolNames).not.toContain('read_relevant_meeting_excerpts')
    expect(toolNames).not.toContain('read_relevant_questionnaire')
  })

  it('uses SYSTEM_PROMPT_WITH_SEMANTIC when semantic tools are registered', async () => {
    const { runner, lastInput } = makeRunner()
    const fakeEmbeddings = { isConfigured: () => true } as never

    await runCahierAgent(runner as never, silentLogger(), 'p1', { embeddings: fakeEmbeddings, enabled: true })

    const prompt = lastInput().systemPrompt
    // Lines that ONLY appear in the semantic variant.
    expect(prompt).toContain('read_relevant_questionnaire(query=')
    expect(prompt).toContain('read_relevant_meeting_excerpts(query=')
  })

  it('uses the default SYSTEM_PROMPT (no semantic guidance) when semantic is disabled', async () => {
    const { runner, lastInput } = makeRunner()
    await runCahierAgent(runner as never, silentLogger(), 'p1')

    const prompt = lastInput().systemPrompt
    // Default prompt mentions read_meeting_segments directly without
    // wrapping it inside a semantic-search escalation flow.
    expect(prompt).toContain('Tu es expert NeoLedge')
    expect(prompt).toContain('read_questionnaire')
    expect(prompt).not.toContain('read_relevant_questionnaire(query=')
  })

  it('returns the runner output unchanged', async () => {
    const customResult: CahierAiResult = {
      ...fullCahierResult(),
      conclusion: 'CONCLUSION-SENTINEL',
    }
    const { runner } = makeRunner()
    runner.run.mockResolvedValueOnce({
      output: customResult,
      iterations: 5,
      toolCallsLog: [],
      provider: 'zai',
      model: 'glm-4.5-air',
    })

    const out = await runCahierAgent(runner as never, silentLogger(), 'p1')
    expect(out).toBe(customResult)
    expect(out.conclusion).toBe('CONCLUSION-SENTINEL')
  })

  it('logs a completion summary line on success', async () => {
    const logger = silentLogger()
    const logSpy = logger.log as unknown as jest.SpyInstance

    const { runner } = makeRunner()
    await runCahierAgent(runner as never, logger, 'p1')

    const messages = logSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(messages.some((m) => m.includes('Cahier agent done'))).toBe(true)
  })

  it('propagates errors from runner.run (no swallowing)', async () => {
    const { runner } = makeRunner()
    runner.run.mockRejectedValueOnce(new Error('AgentEmitMissedError'))

    await expect(runCahierAgent(runner as never, silentLogger(), 'p1'))
      .rejects.toThrow(/AgentEmitMissedError/)
  })
})
