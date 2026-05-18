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

  it('runs multiple read tools in parallel and preserves reply ordering', async () => {
    // The model fires three independent reads in a single assistant turn.
    // Each handler sleeps 80ms; sequentially this would take ~240ms but
    // parallel execution should finish in ~80ms. We assert both the wall
    // time AND that the tool replies appear in the exact order of the
    // tool_calls (OpenAI's API requires this).
    let assistantSentBodies: Array<Record<string, unknown>> = []
    let iter = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = jest.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { messages: Array<Record<string, unknown>> }
      assistantSentBodies.push(body)
      const replies: Array<{ choices: Array<{ message: Record<string, unknown> }>; usage: Record<string, number> }> = [
        {
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [
                { id: 'r-a', type: 'function', function: { name: 'read_a', arguments: '{}' } },
                { id: 'r-b', type: 'function', function: { name: 'read_b', arguments: '{}' } },
                { id: 'r-c', type: 'function', function: { name: 'read_c', arguments: '{}' } },
              ],
            },
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
        {
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [
                { id: 'emit-1', type: 'function', function: { name: 'emit_result', arguments: JSON.stringify({ items: ['a', 'b', 'c'] }) } },
              ],
            },
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
      ]
      const r = replies[iter++]
      return { ok: true, status: 200, text: async () => '', json: async () => r } as never
    })

    const mkRead = (label: string): ToolDefinition => ({
      name: `read_${label}`,
      description: `Read ${label}`,
      parameters: obj({}, {}),
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80))
        return { label }
      },
    })
    const emit: ToolDefinition = {
      name: 'emit_result',
      description: 'Emit',
      parameters: obj({ items: arr(str()) }, { required: ['items'] }),
      handler: async () => ({}),
    }

    const start = Date.now()
    const out = await runOpenAiCompatibleLoop({
      config, logger, ctx,
      systemPrompt: 's',
      userMessage: null,
      tools: [mkRead('a'), mkRead('b'), mkRead('c')],
      emitTools: [emit],
      maxIterations: 5,
      loopTimeoutMs: 60_000,
    })
    const elapsed = Date.now() - start

    // Three 80ms handlers in parallel: ~80ms wall time, well under the
    // sequential 240ms. Allow generous headroom for CI.
    expect(elapsed).toBeLessThan(200)
    expect(out.iterationsRun).toBe(2)
    expect(out.toolCallsLog.filter((c) => c.ok).length).toBeGreaterThanOrEqual(3)

    // The second POST to /chat/completions must carry the tool replies in
    // the order [r-a, r-b, r-c] (matching the assistant's tool_calls). Out
    // of order = 400 from OpenAI.
    const secondCallBody = assistantSentBodies[1]
    const toolMessages = (secondCallBody.messages as Array<{ role: string; tool_call_id?: string }>).filter((m) => m.role === 'tool')
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual(['r-a', 'r-b', 'r-c'])
  })

  it('does not abort the batch when one parallel read fails', async () => {
    // Two reads in parallel; one throws. The other must still complete
    // and the loop must continue cleanly into the emit on the next turn.
    let iter = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = jest.fn(async () => {
      const replies = [
        {
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [
                { id: 'ok', type: 'function', function: { name: 'read_ok', arguments: '{}' } },
                { id: 'bad', type: 'function', function: { name: 'read_bad', arguments: '{}' } },
              ],
            },
          }],
          usage: {},
        },
        {
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [
                { id: 'e', type: 'function', function: { name: 'emit_result', arguments: JSON.stringify({ ok: true }) } },
              ],
            },
          }],
          usage: {},
        },
      ]
      return { ok: true, status: 200, text: async () => '', json: async () => replies[iter++] } as never
    })

    const okRead: ToolDefinition = {
      name: 'read_ok', description: 'r', parameters: obj({}, {}),
      handler: async () => ({ result: 'ok' }),
    }
    const badRead: ToolDefinition = {
      name: 'read_bad', description: 'r', parameters: obj({}, {}),
      handler: async () => { throw new Error('boom in parallel') },
    }
    const emit: ToolDefinition = {
      name: 'emit_result', description: 'e',
      parameters: obj({ ok: { type: 'boolean' } }, { required: ['ok'] }),
      handler: async () => ({}),
    }

    const out = await runOpenAiCompatibleLoop({
      config, logger, ctx,
      systemPrompt: 's', userMessage: null,
      tools: [okRead, badRead], emitTools: [emit],
      maxIterations: 5, loopTimeoutMs: 60_000,
    })

    // The emit must still have fired despite the bad read.
    expect(out.iterationsRun).toBe(2)
    expect(out.finalToolCalls[0].name).toBe('emit_result')
    // The bad read's log row must show ok: false; the ok read must show ok: true.
    const goodRow = out.toolCallsLog.find((c) => c.name === 'read_ok')
    const badRow = out.toolCallsLog.find((c) => c.name === 'read_bad')
    expect(goodRow?.ok).toBe(true)
    expect(badRow?.ok).toBe(false)
    expect(badRow?.error).toContain('boom')
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
