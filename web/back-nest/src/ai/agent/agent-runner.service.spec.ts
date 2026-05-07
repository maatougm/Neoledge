import { Logger } from '@nestjs/common'
import { runOpenAiCompatibleLoop } from './openai-compatible-tool-loop.js'
import { AgentEmitMissedError } from './agent-errors.js'
import type { ToolDefinition, ProviderConfig } from './agent-types.js'
import { obj, str, arr } from './json-schema.js'

const logger = new Logger('AgentRunnerSpec')
const config: ProviderConfig = {
  name: 'zai',
  apiKey: 'sk-test',
  baseUrl: 'https://api.z.ai/v',
  model: 'glm-4.5-air',
  callTimeoutMs: 5_000,
}
const ctx = {
  projectId: 'p1',
  logger,
  prisma: {} as never,
  maxResultChars: 8000,
}

function mockFetchScript(replies: Array<unknown>): jest.Mock {
  let i = 0
  return jest.fn(async () => {
    const body = replies[i++]
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as never
  })
}

describe('runOpenAiCompatibleLoop', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = jest.fn()
  })

  it('returns emit args on a single-iteration run', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = mockFetchScript([
      {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'c1', type: 'function',
              function: { name: 'emit_result', arguments: JSON.stringify({ summary: 'OK' }) },
            }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
    ])

    const emit: ToolDefinition = {
      name: 'emit_result',
      description: 'Emit',
      parameters: obj({ summary: str() }, { required: ['summary'] }),
      handler: async () => ({}),
    }
    const out = await runOpenAiCompatibleLoop({
      config, logger, ctx,
      systemPrompt: 'you are an agent',
      userMessage: null,
      tools: [],
      emitTools: [emit],
      maxIterations: 5,
      loopTimeoutMs: 60_000,
    })
    expect(out.iterationsRun).toBe(1)
    expect(out.finalToolCalls).toEqual([{ name: 'emit_result', args: { summary: 'OK' } }])
  })

  it('runs a read tool then emits', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = mockFetchScript([
      {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'c1', type: 'function',
              function: { name: 'read_data', arguments: JSON.stringify({}) },
            }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
      {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'c2', type: 'function',
              function: { name: 'emit_result', arguments: JSON.stringify({ items: ['a'] }) },
            }],
          },
        }],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      },
    ])

    const handler = jest.fn(async () => ({ items: ['a'] }))
    const read: ToolDefinition = {
      name: 'read_data',
      description: 'Read',
      parameters: obj({}, {}),
      handler,
    }
    const emit: ToolDefinition = {
      name: 'emit_result',
      description: 'Emit',
      parameters: obj({ items: arr(str()) }, { required: ['items'] }),
      handler: async () => ({}),
    }

    const out = await runOpenAiCompatibleLoop({
      config, logger, ctx,
      systemPrompt: 's',
      userMessage: null,
      tools: [read],
      emitTools: [emit],
      maxIterations: 5,
      loopTimeoutMs: 60_000,
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(out.iterationsRun).toBe(2)
    expect(out.finalToolCalls[0].args).toEqual({ items: ['a'] })
  })

  it('throws AgentEmitMissedError on max iterations', async () => {
    // Reply that loops forever calling read_data without emitting.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'c1', type: 'function',
              function: { name: 'read_data', arguments: '{}' },
            }],
          },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    }))

    const read: ToolDefinition = {
      name: 'read_data',
      description: 'Read',
      parameters: obj({}, {}),
      handler: async () => ({}),
    }
    const emit: ToolDefinition = {
      name: 'emit_result',
      description: 'Emit',
      parameters: obj({}, {}),
      handler: async () => ({}),
    }
    // Note: with single-emit forced on the final iteration, the model
    // SHOULD emit. We simulate a misbehaving model by ignoring the force.
    await expect(runOpenAiCompatibleLoop({
      config, logger, ctx,
      systemPrompt: 's',
      userMessage: null,
      tools: [read],
      emitTools: [emit],
      maxIterations: 3,
      loopTimeoutMs: 60_000,
    })).rejects.toThrow(AgentEmitMissedError)
  })

  it('replies error JSON when a tool handler throws', async () => {
    let i = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = jest.fn(async (_url: string, init: RequestInit) => {
      const reply = i === 0
        ? { choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_data', arguments: '{}' } }] } }], usage: {} }
        : { choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'emit_result', arguments: JSON.stringify({ ok: true }) } }] } }], usage: {} }
      i++
      // On the second iteration, verify the tool reply contains an `error` field.
      if (i === 2) {
        const body = JSON.parse(init.body as string) as { messages: Array<Record<string, unknown>> }
        const toolReply = body.messages.find((m) => m.role === 'tool') as { content?: string } | undefined
        expect(toolReply?.content).toContain('tool_failed')
      }
      return { ok: true, status: 200, text: async () => '', json: async () => reply } as never
    })

    const read: ToolDefinition = {
      name: 'read_data',
      description: 'Read',
      parameters: obj({}, {}),
      handler: async () => { throw new Error('boom') },
    }
    const emit: ToolDefinition = {
      name: 'emit_result',
      description: 'Emit',
      parameters: obj({ ok: { type: 'boolean' } }, { required: ['ok'] }),
      handler: async () => ({}),
    }

    const out = await runOpenAiCompatibleLoop({
      config, logger, ctx,
      systemPrompt: 's',
      userMessage: null,
      tools: [read],
      emitTools: [emit],
      maxIterations: 5,
      loopTimeoutMs: 60_000,
    })
    expect(out.iterationsRun).toBe(2)
    expect(out.toolCallsLog.find((c) => c.name === 'read_data')?.ok).toBe(false)
  })
})
