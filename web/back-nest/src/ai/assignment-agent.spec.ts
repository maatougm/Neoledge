/**
 * @file assignment-agent.spec.ts — unit tests for the assignment agent
 *   (runAssignmentAgent — tool-using loop) and its planner-worker variant
 *   (runAssignmentPlannerWorker — parallel reads → single-shot emit).
 *
 *  Strategy: these are plain async functions, not NestJS providers, so we
 *  instantiate dependencies (runner, prisma, logger) as hand-rolled mocks
 *  and call the functions directly. The `runner.run` mock returns a
 *  controlled `AssignmentSuggestionForWp[]` payload — we assert on the
 *  args the agent passes to `runner.run` (tool list, emitTools, feature
 *  label, maxIterations, projectId) and on the defensive post-processing
 *  (filter unknown wpIds, clamp confidence to [0,1], slice rationale to
 *  200 chars).
 *
 *  We DO mock `buildAssignmentTools` so the loop tests don't have to
 *  recreate the candidate tool list — what matters here is that the
 *  agent registers those tools, not their internal SQL. The integration
 *  level (real prisma + assignment-tools.ts) is covered elsewhere.
 */

import { Logger } from '@nestjs/common'
import type { AgentRunnerService } from './agent/agent-runner.service.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { ToolDefinition } from './agent/agent-types.js'

// ─── Module-level mocks ──────────────────────────────────────────────────────
//
// We stub `buildAssignmentTools` so the loop tests can:
//   1. assert the agent CALLED it with (projectId, candidateWpIds), and
//   2. inspect the tools the agent registered without spinning up real prisma.
// The planner-worker tests use the same stub but route the returned tool
// handlers through controlled mocks to verify the parallel-read step.

const buildAssignmentToolsMock = jest.fn<ToolDefinition[], [string, string[]]>()
jest.mock('./agent/tools/assignment-tools.js', () => ({
  buildAssignmentTools: (projectId: string, candidateWpIds: string[]): ToolDefinition[] =>
    buildAssignmentToolsMock(projectId, candidateWpIds),
}))

// readGlossaryTool / readProjectSummaryTool are imported as values; we keep
// the real exports (their identity is what we assert on) but stub their
// handlers below in the planner-worker tests where we need to control the
// per-read outcome.
import { readGlossaryTool } from './agent/tools/glossary-tools.js'
import { readProjectSummaryTool } from './agent/tools/project-tools.js'
import {
  runAssignmentAgent,
  runAssignmentPlannerWorker,
  type AssignmentSuggestionForWp,
} from './assignment-agent.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface RunnerRunArgs {
  systemPrompt: string
  userMessage?: string
  tools: ToolDefinition[]
  emitTools: ToolDefinition[]
  maxIterations: number
  feature: string
  projectId: string
}

interface MockRunner {
  run: jest.Mock<Promise<RunnerRunResult>, [RunnerRunArgs]>
}

interface RunnerRunResult {
  output: { items: AssignmentSuggestionForWp[] }
  iterations: number
  toolCallsLog: unknown[]
  provider: string
  model: string
}

function makeMockRunner(items: AssignmentSuggestionForWp[]): MockRunner {
  return {
    run: jest.fn(async (_input: RunnerRunArgs) => ({
      output: { items },
      iterations: 3,
      toolCallsLog: [],
      provider: 'zai',
      model: 'glm-4.5-air',
    })),
  }
}

function makeStubCandidatesTool(): ToolDefinition {
  return {
    name: 'read_candidate_tasks',
    description: 'stub',
    parameters: { type: 'object', properties: {} } as never,
    handler: jest.fn(async () => ({ tasks: [] })) as never,
  }
}

function makeStubMembersTool(): ToolDefinition {
  return {
    name: 'read_project_members',
    description: 'stub',
    parameters: { type: 'object', properties: {} } as never,
    handler: jest.fn(async () => ({ members: [] })) as never,
  }
}

function makeStubHistoryTool(): ToolDefinition {
  return {
    name: 'read_member_history',
    description: 'stub',
    parameters: { type: 'object', properties: {} } as never,
    handler: jest.fn(async () => ({ history: [] })) as never,
  }
}

const logger = new Logger('assignment-agent-spec')

beforeEach(() => {
  buildAssignmentToolsMock.mockReset()
})

// ─── runAssignmentAgent (tool-using loop) ───────────────────────────────────

describe('runAssignmentAgent', () => {
  it('short-circuits with [] when no candidate wpIds are supplied', async () => {
    const runner = makeMockRunner([])
    const result = await runAssignmentAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'p1',
      [],
    )
    expect(result).toEqual([])
    expect(runner.run).not.toHaveBeenCalled()
    expect(buildAssignmentToolsMock).not.toHaveBeenCalled()
  })

  it('builds the assignment tools with (projectId, candidateWpIds) and registers them alongside shared reads + the emit tool', async () => {
    const candidates = makeStubCandidatesTool()
    const members = makeStubMembersTool()
    const history = makeStubHistoryTool()
    buildAssignmentToolsMock.mockReturnValue([candidates, members, history])

    const runner = makeMockRunner([
      { wpId: 'wp1', suggestions: [{ userId: 'u1', confidence: 0.9, rationale: 'jobTitle match' }] },
    ])

    await runAssignmentAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'p1',
      ['wp1', 'wp2'],
    )

    // buildAssignmentTools was called with the exact (projectId, wpIds) tuple.
    expect(buildAssignmentToolsMock).toHaveBeenCalledTimes(1)
    expect(buildAssignmentToolsMock).toHaveBeenCalledWith('p1', ['wp1', 'wp2'])

    // runner.run got the merged tool list: projectSummary, ...assignment(3), glossary.
    const runArgs = runner.run.mock.calls[0][0]
    expect(runArgs.tools).toEqual([
      readProjectSummaryTool,
      candidates,
      members,
      history,
      readGlossaryTool,
    ])

    // Exactly one emit tool, named emit_assignments.
    expect(runArgs.emitTools).toHaveLength(1)
    expect(runArgs.emitTools[0].name).toBe('emit_assignments')

    // Per-call constants the runner expects.
    expect(runArgs.maxIterations).toBe(8)
    // `feature` is intentionally 'backlog' — no 'assignment' label exists in
    // the AiUsage feature union, so the agent keeps usage rows consistent
    // with the backlog feature. Locked in as a contract test.
    expect(runArgs.feature).toBe('backlog')
    expect(runArgs.projectId).toBe('p1')

    // Kickoff user message names the read order the system prompt mandates.
    expect(runArgs.userMessage).toContain('read_candidate_tasks')
    expect(runArgs.userMessage).toContain('read_project_members')
    expect(runArgs.userMessage).toContain('2 tâche')

    // The system prompt anchors the role + signal hierarchy.
    expect(runArgs.systemPrompt).toContain('manager IT')
    expect(runArgs.systemPrompt).toContain('jobTitle')
    expect(runArgs.systemPrompt).toContain('emit_assignments')
  })

  it('filters out runner output entries whose wpId is NOT in the candidate set (defensive validation)', async () => {
    buildAssignmentToolsMock.mockReturnValue([
      makeStubCandidatesTool(),
      makeStubMembersTool(),
      makeStubHistoryTool(),
    ])
    const runner = makeMockRunner([
      { wpId: 'wp1', suggestions: [{ userId: 'u1', confidence: 0.9, rationale: 'fit' }] },
      { wpId: 'ghost-wp', suggestions: [{ userId: 'u2', confidence: 0.8, rationale: 'hallucinated' }] },
      { wpId: 'wp2', suggestions: [{ userId: 'u3', confidence: 0.85, rationale: 'second' }] },
    ])

    const out = await runAssignmentAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'p1',
      ['wp1', 'wp2'],
    )

    expect(out).toHaveLength(2)
    expect(out.map((e) => e.wpId).sort()).toEqual(['wp1', 'wp2'])
    expect(out.find((e) => e.wpId === 'ghost-wp')).toBeUndefined()
  })

  it('drops suggestions with empty / non-string userId', async () => {
    buildAssignmentToolsMock.mockReturnValue([
      makeStubCandidatesTool(),
      makeStubMembersTool(),
      makeStubHistoryTool(),
    ])
    const runner = makeMockRunner([
      {
        wpId: 'wp1',
        suggestions: [
          { userId: 'u-ok', confidence: 0.9, rationale: 'ok' },
          { userId: '', confidence: 0.9, rationale: 'empty userId' },
          // unknown structural shape — Number(s.userId) would be NaN
          { userId: undefined as unknown as string, confidence: 0.7, rationale: 'missing' },
        ],
      },
    ])

    const out = await runAssignmentAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'p1',
      ['wp1'],
    )

    expect(out[0].suggestions).toHaveLength(1)
    expect(out[0].suggestions[0].userId).toBe('u-ok')
  })

  it('clamps confidence to the [0, 1] range and coerces NaN to 0', async () => {
    buildAssignmentToolsMock.mockReturnValue([
      makeStubCandidatesTool(),
      makeStubMembersTool(),
      makeStubHistoryTool(),
    ])
    const runner = makeMockRunner([
      {
        wpId: 'wp1',
        suggestions: [
          { userId: 'u1', confidence: 1.5, rationale: 'too high' },
          { userId: 'u2', confidence: -0.5, rationale: 'too low' },
          { userId: 'u3', confidence: Number.NaN, rationale: 'nan' },
          { userId: 'u4', confidence: 'oops' as unknown as number, rationale: 'string' },
          { userId: 'u5', confidence: 0.73, rationale: 'normal' },
        ],
      },
    ])

    const out = await runAssignmentAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'p1',
      ['wp1'],
    )

    const byUser = Object.fromEntries(out[0].suggestions.map((s) => [s.userId, s.confidence]))
    expect(byUser['u1']).toBe(1)
    expect(byUser['u2']).toBe(0)
    expect(byUser['u3']).toBe(0)
    expect(byUser['u4']).toBe(0)
    expect(byUser['u5']).toBeCloseTo(0.73, 5)
  })

  it('truncates rationale to 200 chars and tolerates missing rationale', async () => {
    buildAssignmentToolsMock.mockReturnValue([
      makeStubCandidatesTool(),
      makeStubMembersTool(),
      makeStubHistoryTool(),
    ])
    const long = 'r'.repeat(500)
    const runner = makeMockRunner([
      {
        wpId: 'wp1',
        suggestions: [
          { userId: 'u-long', confidence: 0.9, rationale: long },
          { userId: 'u-missing', confidence: 0.85, rationale: undefined as unknown as string },
        ],
      },
    ])

    const out = await runAssignmentAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'p1',
      ['wp1'],
    )

    const byUser = Object.fromEntries(out[0].suggestions.map((s) => [s.userId, s.rationale]))
    expect(byUser['u-long']).toHaveLength(200)
    expect(byUser['u-missing']).toBe('')
  })

  it('handles a runner output with empty / missing suggestions arrays', async () => {
    buildAssignmentToolsMock.mockReturnValue([
      makeStubCandidatesTool(),
      makeStubMembersTool(),
      makeStubHistoryTool(),
    ])
    const runner = makeMockRunner([
      { wpId: 'wp1', suggestions: [] },
      { wpId: 'wp2', suggestions: undefined as unknown as never[] },
    ])

    const out = await runAssignmentAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'p1',
      ['wp1', 'wp2'],
    )

    expect(out).toHaveLength(2)
    expect(out[0].suggestions).toEqual([])
    expect(out[1].suggestions).toEqual([])
  })

  it('throws if the runner output has no items array — the post-run log line reads items.length before the defensive ?? [] kicks in (existing edge case, locked in here)', async () => {
    buildAssignmentToolsMock.mockReturnValue([
      makeStubCandidatesTool(),
      makeStubMembersTool(),
      makeStubHistoryTool(),
    ])
    const runner: MockRunner = {
      run: jest.fn(async () => ({
        output: { items: undefined as unknown as AssignmentSuggestionForWp[] },
        iterations: 1,
        toolCallsLog: [],
        provider: 'zai',
        model: 'glm-4.5-air',
      })),
    }
    // The agent reads `result.output.items.length` in its log line. If a
    // future refactor adds `result.output.items ?? []` there, this test
    // should be updated to expect `[]` instead.
    await expect(
      runAssignmentAgent(
        runner as unknown as AgentRunnerService,
        logger,
        'p1',
        ['wp1'],
      ),
    ).rejects.toThrow(/Cannot read properties of undefined/)
  })

  it('propagates the runner error (e.g. AgentEmitMissedError) — caller is responsible for the fallback', async () => {
    buildAssignmentToolsMock.mockReturnValue([
      makeStubCandidatesTool(),
      makeStubMembersTool(),
      makeStubHistoryTool(),
    ])
    const runner: MockRunner = {
      run: jest.fn(async () => {
        throw new Error('agent emit missed')
      }),
    }
    await expect(
      runAssignmentAgent(
        runner as unknown as AgentRunnerService,
        logger,
        'p1',
        ['wp1'],
      ),
    ).rejects.toThrow('agent emit missed')
  })
})

// ─── runAssignmentPlannerWorker (parallel reads + single emit) ──────────────

describe('runAssignmentPlannerWorker', () => {
  it('short-circuits with [] when no candidate wpIds are supplied', async () => {
    const runner = makeMockRunner([])
    const prisma = {} as PrismaService
    const out = await runAssignmentPlannerWorker(
      runner as unknown as AgentRunnerService,
      prisma,
      logger,
      'p1',
      [],
    )
    expect(out).toEqual([])
    expect(runner.run).not.toHaveBeenCalled()
    expect(buildAssignmentToolsMock).not.toHaveBeenCalled()
  })

  it('runs the 4 reads in parallel (project + candidates + members + glossary), then calls runner.run with the worker prompt and forced single-iteration emit', async () => {
    const candidates = {
      name: 'read_candidate_tasks',
      description: 'stub',
      parameters: { type: 'object' } as never,
      handler: jest.fn(async () => ({ tasks: [{ id: 'wp1', title: 'API endpoint' }] })),
    } as ToolDefinition
    const members = {
      name: 'read_project_members',
      description: 'stub',
      parameters: { type: 'object' } as never,
      handler: jest.fn(async () => ({ members: [{ userId: 'u1', jobTitle: 'Senior Backend' }] })),
    } as ToolDefinition
    const history = {
      name: 'read_member_history',
      description: 'stub',
      parameters: { type: 'object' } as never,
      handler: jest.fn(),
    } as ToolDefinition

    buildAssignmentToolsMock.mockReturnValue([candidates, members, history])

    // Stub the shared readers' handlers so the planner-worker has real data
    // to fold into the context blob.
    const projectHandler = jest
      .spyOn(readProjectSummaryTool, 'handler')
      .mockResolvedValue({
        id: 'p1', name: 'Test Project', clientName: 'ACME',
        status: 'Active', startDate: '2026-01-01', endDate: '2026-12-31',
        projectManager: null, memberCount: 5,
      } as never)
    const glossaryHandler = jest
      .spyOn(readGlossaryTool, 'handler')
      .mockResolvedValue({ term: 'GED', definition: 'Gestion électronique de documents' })

    const runner = makeMockRunner([
      { wpId: 'wp1', suggestions: [{ userId: 'u1', confidence: 0.92, rationale: 'jobTitle: Senior Backend' }] },
    ])

    const prisma = { sentinel: true } as unknown as PrismaService

    const out = await runAssignmentPlannerWorker(
      runner as unknown as AgentRunnerService,
      prisma,
      logger,
      'p1',
      ['wp1'],
    )

    // buildAssignmentTools was called with the candidate set.
    expect(buildAssignmentToolsMock).toHaveBeenCalledWith('p1', ['wp1'])

    // All 4 reads fired exactly once with the shared ToolContext (we pass
    // projectId='p1' and prisma into the ctx).
    expect(projectHandler).toHaveBeenCalledTimes(1)
    expect(glossaryHandler).toHaveBeenCalledTimes(1)
    expect(candidates.handler).toHaveBeenCalledTimes(1)
    expect(members.handler).toHaveBeenCalledTimes(1)
    // history tool is intentionally NOT called in the planner-worker path —
    // readMembers's payload now carries recentResolvedTitles directly.
    expect(history.handler).not.toHaveBeenCalled()

    // The ctx passed to each handler points at the supplied prisma + projectId.
    const ctxForProject = projectHandler.mock.calls[0][1]
    expect(ctxForProject).toMatchObject({ projectId: 'p1', prisma })

    // runner.run was called once with the worker shape.
    expect(runner.run).toHaveBeenCalledTimes(1)
    const runArgs = runner.run.mock.calls[0][0]

    expect(runArgs.tools).toEqual([]) // no read tools — worker can't call tools
    expect(runArgs.emitTools).toHaveLength(1)
    expect(runArgs.emitTools[0].name).toBe('emit_assignments')
    expect(runArgs.maxIterations).toBe(1) // forced single-iteration emit
    expect(runArgs.feature).toBe('backlog')
    expect(runArgs.projectId).toBe('p1')

    // The worker user-message embeds the read outcomes as labelled sections.
    expect(runArgs.userMessage).toContain('## PROJET')
    expect(runArgs.userMessage).toContain('## TACHES_CANDIDATES')
    expect(runArgs.userMessage).toContain('## MEMBRES')
    expect(runArgs.userMessage).toContain('## GLOSSAIRE')
    expect(runArgs.userMessage).toContain('Test Project')
    expect(runArgs.userMessage).toContain('Senior Backend')
    expect(runArgs.userMessage).toContain('GED')
    expect(runArgs.userMessage).toContain('emit_assignments')

    // The worker system prompt is the worker variant (no read tools mentioned).
    expect(runArgs.systemPrompt).toContain('Tu n\'as PAS d\'outils de lecture')
    expect(runArgs.systemPrompt).toContain('jobTitle')

    // Same defensive validation as runAssignmentAgent — clamp + filter.
    expect(out).toHaveLength(1)
    expect(out[0].suggestions[0].confidence).toBeCloseTo(0.92)

    projectHandler.mockRestore()
    glossaryHandler.mockRestore()
  })

  it('treats a per-read handler failure as a soft error and folds it into the context blob (graceful degradation)', async () => {
    const candidates = {
      name: 'read_candidate_tasks',
      description: 'stub',
      parameters: { type: 'object' } as never,
      handler: jest.fn(async () => { throw new Error('candidate query failed') }),
    } as ToolDefinition
    const members = {
      name: 'read_project_members',
      description: 'stub',
      parameters: { type: 'object' } as never,
      handler: jest.fn(async () => ({ members: [] })),
    } as ToolDefinition

    buildAssignmentToolsMock.mockReturnValue([candidates, members])

    const projectHandler = jest
      .spyOn(readProjectSummaryTool, 'handler')
      .mockResolvedValue({ id: 'p1', name: 'P' } as never)
    const glossaryHandler = jest
      .spyOn(readGlossaryTool, 'handler')
      .mockResolvedValue({ term: '', definition: null })

    const runner = makeMockRunner([])
    const prisma = {} as PrismaService

    const out = await runAssignmentPlannerWorker(
      runner as unknown as AgentRunnerService,
      prisma,
      logger,
      'p1',
      ['wp1'],
    )

    expect(out).toEqual([])
    // runner.run was still called — graceful degradation, not a hard fail.
    expect(runner.run).toHaveBeenCalledTimes(1)
    const runArgs = runner.run.mock.calls[0][0]
    // The failed read shows up as an {"error":"..."} payload inside its
    // labelled section.
    expect(runArgs.userMessage).toContain('## TACHES_CANDIDATES')
    expect(runArgs.userMessage).toContain('candidate query failed')

    projectHandler.mockRestore()
    glossaryHandler.mockRestore()
  })

  it('truncates very large read payloads to ~6000 chars per section with a [trunc] marker', async () => {
    const huge = JSON.stringify({ tasks: Array.from({ length: 5000 }, (_, i) => ({ id: `wp${i}`, title: 'x'.repeat(200) })) })
    const candidates = {
      name: 'read_candidate_tasks',
      description: 'stub',
      parameters: { type: 'object' } as never,
      handler: jest.fn(async () => JSON.parse(huge)),
    } as ToolDefinition
    const members = {
      name: 'read_project_members',
      description: 'stub',
      parameters: { type: 'object' } as never,
      handler: jest.fn(async () => ({ members: [] })),
    } as ToolDefinition
    buildAssignmentToolsMock.mockReturnValue([candidates, members])

    const projectHandler = jest
      .spyOn(readProjectSummaryTool, 'handler')
      .mockResolvedValue({} as never)
    const glossaryHandler = jest
      .spyOn(readGlossaryTool, 'handler')
      .mockResolvedValue({ term: '', definition: null })

    const runner = makeMockRunner([])
    await runAssignmentPlannerWorker(
      runner as unknown as AgentRunnerService,
      {} as PrismaService,
      logger,
      'p1',
      ['wp1'],
    )

    const runArgs = runner.run.mock.calls[0][0]
    expect(runArgs.userMessage).toContain('[trunc]')

    projectHandler.mockRestore()
    glossaryHandler.mockRestore()
  })

  it('applies the same defensive validation: filters unknown wpIds, clamps confidence, slices rationale', async () => {
    buildAssignmentToolsMock.mockReturnValue([
      makeStubCandidatesTool(),
      makeStubMembersTool(),
    ])
    const projectHandler = jest
      .spyOn(readProjectSummaryTool, 'handler')
      .mockResolvedValue({} as never)
    const glossaryHandler = jest
      .spyOn(readGlossaryTool, 'handler')
      .mockResolvedValue({ term: '', definition: null })

    const long = 'r'.repeat(300)
    const runner = makeMockRunner([
      {
        wpId: 'wp1',
        suggestions: [
          { userId: 'u1', confidence: 1.7, rationale: long },
          { userId: '', confidence: 0.9, rationale: 'empty userId' },
        ],
      },
      { wpId: 'ghost', suggestions: [{ userId: 'u-x', confidence: 0.9, rationale: 'leaked' }] },
    ])

    const out = await runAssignmentPlannerWorker(
      runner as unknown as AgentRunnerService,
      {} as PrismaService,
      logger,
      'p1',
      ['wp1'],
    )

    expect(out).toHaveLength(1)
    expect(out[0].wpId).toBe('wp1')
    expect(out[0].suggestions).toHaveLength(1)
    expect(out[0].suggestions[0].userId).toBe('u1')
    expect(out[0].suggestions[0].confidence).toBe(1)
    expect(out[0].suggestions[0].rationale).toHaveLength(200)

    projectHandler.mockRestore()
    glossaryHandler.mockRestore()
  })
})
