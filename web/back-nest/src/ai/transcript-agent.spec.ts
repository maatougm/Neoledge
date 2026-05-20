/**
 * @file transcript-agent.spec.ts — unit tests for `runTranscriptAgent`.
 *
 *   runTranscriptAgent is a plain async function (NOT a NestJS service).
 *   It wires three emit tools (`emit_summary`, `emit_action_items`,
 *   `emit_decisions`) into `runner.run()` and then post-processes the
 *   returned tool-call args via `combineEmits` to defend against malformed
 *   model output:
 *     - drop items without a string `description`
 *     - keep `assigneeName` only when it's a non-empty string
 *     - keep `dueDate` only when it matches `YYYY-MM-DD`
 *     - coerce decision `category` to 'decision' unless it's the literal 'risk'
 *
 *   We mock `buildTranscriptTools` so the tool list it returns is inspectable
 *   without spinning up real prisma — what matters is that the agent
 *   registers those tools and the right glossary/other-meetings tools.
 */

import { Logger } from '@nestjs/common'
import type { AgentRunnerService } from './agent/agent-runner.service.js'
import type { ToolDefinition } from './agent/agent-types.js'
import type { AiAnalysisResult } from './ai.types.js'

// ─── Module-level mocks ──────────────────────────────────────────────────────

const buildTranscriptToolsMock = jest.fn<ToolDefinition[], [string]>()
const readOtherMeetingsToolStub: ToolDefinition = {
  name: 'read_other_meeting_summaries',
  description: 'stub',
  parameters: { type: 'object', properties: {}, required: [] },
  handler: async () => ({}),
}
jest.mock('./agent/tools/transcript-tools.js', () => ({
  buildTranscriptTools: (transcriptId: string): ToolDefinition[] =>
    buildTranscriptToolsMock(transcriptId),
  readOtherMeetingsTool: readOtherMeetingsToolStub,
}))

import { readGlossaryTool } from './agent/tools/glossary-tools.js'
import { runTranscriptAgent } from './transcript-agent.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface RunnerRunArgs {
  systemPrompt: string
  userMessage?: string
  tools: ToolDefinition[]
  emitTools: ToolDefinition[]
  maxIterations: number
  feature: string
  projectId: string
  combineEmits?: (calls: Array<{ name: string; args: unknown }>) => AiAnalysisResult
}

interface RunnerRunResult {
  output: AiAnalysisResult
  iterations: number
  toolCallsLog: unknown[]
  provider: string
  model: string
}

interface MockRunner {
  run: jest.Mock<Promise<RunnerRunResult>, [RunnerRunArgs]>
  capturedInput?: RunnerRunArgs
}

/** Build a runner that captures the input it was called with and runs
 *  the supplied `calls` array through the real `combineEmits` so we can
 *  assert on the post-processed output the agent returns. */
function makeMockRunner(calls: Array<{ name: string; args: unknown }>): MockRunner {
  const mock: MockRunner = {
    run: jest.fn(async (input: RunnerRunArgs) => {
      mock.capturedInput = input
      const merged = input.combineEmits ? input.combineEmits(calls) : ({} as AiAnalysisResult)
      return {
        output: merged,
        iterations: 3,
        toolCallsLog: [],
        provider: 'zai',
        model: 'glm-4.5-air',
      }
    }),
  }
  return mock
}

const TRANSCRIPT_TOOL_NAMES = ['read_transcript_metadata', 'read_segments']
function makeTranscriptTools(): ToolDefinition[] {
  return TRANSCRIPT_TOOL_NAMES.map((name) => ({
    name,
    description: 'stub',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => ({}),
  }))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runTranscriptAgent', () => {
  let logger: Logger
  beforeEach(() => {
    jest.clearAllMocks()
    logger = new Logger('transcript-agent-spec')
    buildTranscriptToolsMock.mockReturnValue(makeTranscriptTools())
  })

  // ── Agent wiring assertions ───────────────────────────────────────────────

  it('passes the correct AgentRunInput to runner.run', async () => {
    const runner = makeMockRunner([
      { name: 'emit_summary', args: { summary: '# OK' } },
      { name: 'emit_action_items', args: { items: [] } },
      { name: 'emit_decisions', args: { items: [] } },
    ])

    await runTranscriptAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'proj-1',
      'tx-42',
    )

    expect(buildTranscriptToolsMock).toHaveBeenCalledWith('tx-42')
    expect(runner.run).toHaveBeenCalledTimes(1)
    const input = runner.capturedInput!
    expect(input.feature).toBe('meeting-analysis')
    expect(input.projectId).toBe('proj-1')
    expect(input.maxIterations).toBe(8)
    expect(input.userMessage).toContain('tx-42')
    expect(input.systemPrompt).toContain('emit_summary')
    expect(input.systemPrompt).toContain('emit_action_items')
    expect(input.systemPrompt).toContain('emit_decisions')

    // Three emit tools in multi-emit mode.
    expect(input.emitTools.map((t) => t.name).sort()).toEqual([
      'emit_action_items', 'emit_decisions', 'emit_summary',
    ])

    // Read-tool list = transcript tools + read_other_meeting_summaries + glossary.
    const readNames = input.tools.map((t) => t.name)
    expect(readNames).toEqual(expect.arrayContaining(TRANSCRIPT_TOOL_NAMES))
    expect(readNames).toContain('read_other_meeting_summaries')
    expect(readNames).toContain(readGlossaryTool.name)
  })

  // ── combineEmits — happy path ─────────────────────────────────────────────

  it('combines a well-formed multi-emit result into AiAnalysisResult', async () => {
    const runner = makeMockRunner([
      { name: 'emit_summary', args: { summary: '# Réunion\n- point 1' } },
      {
        name: 'emit_action_items',
        args: {
          items: [
            { description: 'envoyer la maquette', assigneeName: 'Alice', dueDate: '2026-06-15' },
            { description: 'planifier le suivi' }, // optional fields missing
          ],
        },
      },
      {
        name: 'emit_decisions',
        args: {
          items: [
            { description: 'stack Vue 3', category: 'decision' },
            { description: 'retard livreur', category: 'risk' },
          ],
        },
      },
    ])

    const result = await runTranscriptAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'proj-1',
      'tx-1',
    )

    expect(result.summary).toBe('# Réunion\n- point 1')
    expect(result.actionItems).toEqual([
      { description: 'envoyer la maquette', assigneeName: 'Alice', dueDate: '2026-06-15' },
      { description: 'planifier le suivi' },
    ])
    expect(result.decisions).toEqual([
      { description: 'stack Vue 3', category: 'decision' },
      { description: 'retard livreur', category: 'risk' },
    ])
  })

  // ── combineEmits — drops malformed items ──────────────────────────────────

  it('drops action items missing a string description', async () => {
    const runner = makeMockRunner([
      { name: 'emit_summary', args: { summary: 'S' } },
      {
        name: 'emit_action_items',
        args: {
          items: [
            { description: 'good' },
            { description: 123 },          // non-string → dropped
            { description: null },          // null → dropped
            null,                           // null entry → dropped
            { assigneeName: 'orphan' },     // no description → dropped
            { description: 'also good' },
          ],
        },
      },
      { name: 'emit_decisions', args: { items: [] } },
    ])

    const result = await runTranscriptAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'proj-1',
      'tx-1',
    )
    expect(result.actionItems).toEqual([
      { description: 'good' },
      { description: 'also good' },
    ])
  })

  // ── combineEmits — assigneeName / dueDate defensive filters ───────────────

  it('drops empty assigneeName and non-ISO dueDate', async () => {
    const runner = makeMockRunner([
      { name: 'emit_summary', args: { summary: 'S' } },
      {
        name: 'emit_action_items',
        args: {
          items: [
            { description: 'a', assigneeName: 'Alice', dueDate: '2026-06-15' },
            { description: 'b', assigneeName: '', dueDate: '2026-06-15' },       // empty assignee → dropped
            { description: 'c', assigneeName: null, dueDate: '2026-06-15' },     // null assignee → dropped
            { description: 'd', assigneeName: 'Bob', dueDate: '15/06/2026' },    // wrong format → dropped
            { description: 'e', assigneeName: 'Carol', dueDate: 'next month' },  // free text → dropped
            { description: 'f', assigneeName: 'Dan', dueDate: null },            // null due → dropped
            { description: 'g', assigneeName: 'Eve' },                            // no due key at all
          ],
        },
      },
      { name: 'emit_decisions', args: { items: [] } },
    ])

    const result = await runTranscriptAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'proj-1',
      'tx-1',
    )
    expect(result.actionItems).toEqual([
      { description: 'a', assigneeName: 'Alice', dueDate: '2026-06-15' },
      { description: 'b', dueDate: '2026-06-15' },
      { description: 'c', dueDate: '2026-06-15' },
      { description: 'd', assigneeName: 'Bob' },
      { description: 'e', assigneeName: 'Carol' },
      { description: 'f', assigneeName: 'Dan' },
      { description: 'g', assigneeName: 'Eve' },
    ])
  })

  // ── combineEmits — decision category coercion ─────────────────────────────

  it('coerces decision category to "decision" unless literally "risk"', async () => {
    const runner = makeMockRunner([
      { name: 'emit_summary', args: { summary: 'S' } },
      { name: 'emit_action_items', args: { items: [] } },
      {
        name: 'emit_decisions',
        args: {
          items: [
            { description: 'a', category: 'risk' },          // stays 'risk'
            { description: 'b', category: 'decision' },      // stays 'decision'
            { description: 'c', category: 'RISK' },          // case-sensitive — coerced to 'decision'
            { description: 'd', category: 'unknown' },       // coerced to 'decision'
            { description: 'e', category: null },            // coerced to 'decision'
            { description: 'f' },                             // missing → coerced to 'decision'
          ],
        },
      },
    ])

    const result = await runTranscriptAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'proj-1',
      'tx-1',
    )
    expect(result.decisions).toEqual([
      { description: 'a', category: 'risk' },
      { description: 'b', category: 'decision' },
      { description: 'c', category: 'decision' },
      { description: 'd', category: 'decision' },
      { description: 'e', category: 'decision' },
      { description: 'f', category: 'decision' },
    ])
  })

  // ── combineEmits — drops malformed decision items ─────────────────────────

  it('drops decision items missing a string description', async () => {
    const runner = makeMockRunner([
      { name: 'emit_summary', args: { summary: 'S' } },
      { name: 'emit_action_items', args: { items: [] } },
      {
        name: 'emit_decisions',
        args: {
          items: [
            { description: 'good', category: 'decision' },
            { description: 42, category: 'risk' },           // non-string → dropped
            null,                                              // null → dropped
            { category: 'risk' },                              // no description → dropped
            { description: 'also good', category: 'risk' },
          ],
        },
      },
    ])

    const result = await runTranscriptAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'proj-1',
      'tx-1',
    )
    expect(result.decisions).toEqual([
      { description: 'good', category: 'decision' },
      { description: 'also good', category: 'risk' },
    ])
  })

  // ── combineEmits — missing emit calls ─────────────────────────────────────

  it('defaults summary to empty string when emit_summary is missing', async () => {
    const runner = makeMockRunner([
      // no emit_summary
      { name: 'emit_action_items', args: { items: [{ description: 'a' }] } },
      { name: 'emit_decisions', args: { items: [{ description: 'b', category: 'decision' }] } },
    ])
    const result = await runTranscriptAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'proj-1',
      'tx-1',
    )
    expect(result.summary).toBe('')
    expect(result.actionItems).toHaveLength(1)
    expect(result.decisions).toHaveLength(1)
  })

  it('defaults items to [] when emit_action_items / emit_decisions are missing', async () => {
    const runner = makeMockRunner([
      { name: 'emit_summary', args: { summary: 'S' } },
      // no emit_action_items, no emit_decisions
    ])
    const result = await runTranscriptAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'proj-1',
      'tx-1',
    )
    expect(result.summary).toBe('S')
    expect(result.actionItems).toEqual([])
    expect(result.decisions).toEqual([])
  })

  it('treats missing args.items as []', async () => {
    const runner = makeMockRunner([
      { name: 'emit_summary', args: {} },                    // no summary key
      { name: 'emit_action_items', args: {} },               // no items key
      { name: 'emit_decisions', args: {} },                  // no items key
    ])
    const result = await runTranscriptAgent(
      runner as unknown as AgentRunnerService,
      logger,
      'proj-1',
      'tx-1',
    )
    expect(result).toEqual({ summary: '', actionItems: [], decisions: [] })
  })

  // ── Error propagation ─────────────────────────────────────────────────────

  it('propagates errors from runner.run unchanged', async () => {
    const failingRunner: MockRunner = {
      run: jest.fn(async (_args: RunnerRunArgs) => {
        throw new Error('agent loop crashed')
      }),
    }
    await expect(
      runTranscriptAgent(failingRunner as unknown as AgentRunnerService, logger, 'p', 't'),
    ).rejects.toThrow('agent loop crashed')
  })

  // ── Logging ───────────────────────────────────────────────────────────────

  it('logs a success line with iter + toolCallsLog count + model', async () => {
    const runner: MockRunner = {
      run: jest.fn(async (input: RunnerRunArgs) => ({
        output: input.combineEmits!([{ name: 'emit_summary', args: { summary: 'S' } }]),
        iterations: 7,
        toolCallsLog: [{}, {}, {}],
        provider: 'zai',
        model: 'glm-4.5-air',
      })),
    }
    const spy = jest.spyOn(logger, 'log').mockImplementation(() => undefined)
    await runTranscriptAgent(runner as unknown as AgentRunnerService, logger, 'p', 't')
    expect(spy).toHaveBeenCalledTimes(1)
    const msg = spy.mock.calls[0][0] as string
    expect(msg).toContain('7 iter')
    expect(msg).toContain('3 tool calls')
    expect(msg).toContain('glm-4.5-air')
  })
})
