/**
 * @file openai-compatible-tool-loop.ts — tool-use loop against any
 * OpenAI-compatible /chat/completions endpoint. Used for both Z.AI
 * (glm-4.5-air, AI_FALLBACK_BASE_URL) and OpenAI itself. Z.AI has been
 * empirically verified to support `tools`, `tool_choice` (free + forced),
 * and the `tool_calls` reply format.
 */

import type { Logger } from '@nestjs/common'
import type {
  LoopOutcome,
  ProviderConfig,
  ToolCallLogEntry,
  ToolContext,
  ToolDefinition,
} from './agent-types.js'
import {
  AgentEmitMissedError,
  AgentLoopTimeoutError,
  AgentToolValidationError,
} from './agent-errors.js'
import { validateAgainst } from './json-schema.js'

interface OpenAiToolMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

interface OpenAiCompletion {
  choices?: Array<{
    finish_reason?: string
    message?: OpenAiToolMessage
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

const MAX_TOOL_RESULT_CHARS_DEFAULT = 8000

/**
 * Drive the agent loop. Returns once an emit tool fires (single-emit mode)
 * or all emit tools fire at least once (multi-emit mode). Throws on:
 *   - max iterations exhausted with no emit
 *   - wall-clock timeout
 *   - non-recoverable provider error
 *
 * Tool handler errors are NOT thrown; they're surfaced to the model as
 * a JSON `{error}` reply so the loop can self-correct.
 */
export async function runOpenAiCompatibleLoop(args: {
  config: ProviderConfig
  logger: Logger
  ctx: ToolContext
  systemPrompt: string
  userMessage: string | null
  tools: ToolDefinition[]
  emitTools: ToolDefinition[]
  maxIterations: number
  loopTimeoutMs: number
}): Promise<LoopOutcome> {
  const { config, logger, ctx, systemPrompt, userMessage, tools, emitTools, maxIterations, loopTimeoutMs } = args

  const allTools = [...tools, ...emitTools]
  const toolDefs = allTools.map(toToolDef)
  const emitNames = new Set(emitTools.map((t) => t.name))
  const collectedEmits = new Map<string, { name: string; args: unknown }>()

  const messages: OpenAiToolMessage[] = [{ role: 'system', content: systemPrompt }]
  if (userMessage) messages.push({ role: 'user', content: userMessage })

  const toolCallsLog: ToolCallLogEntry[] = []
  let iterationsRun = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  const startedAt = Date.now()

  for (let iter = 0; iter < maxIterations; iter++) {
    iterationsRun = iter + 1

    if (Date.now() - startedAt > loopTimeoutMs) {
      throw new AgentLoopTimeoutError(Date.now() - startedAt, loopTimeoutMs)
    }

    // Force a terminal emit on the final iteration when there's exactly one
    // emit tool. Otherwise leave tool_choice='auto' so the model can pick
    // any of the multiple emits at any time (multi-emit mode).
    const isFinalIter = iter === maxIterations - 1
    const forceSingleEmit = emitTools.length === 1 && isFinalIter
    const toolChoice = forceSingleEmit
      ? { type: 'function' as const, function: { name: emitTools[0].name } }
      : 'auto'

    const completion = await postCompletion({
      config,
      messages,
      tools: toolDefs,
      toolChoice,
    })

    totalPromptTokens += completion.usage?.prompt_tokens ?? 0
    totalCompletionTokens += completion.usage?.completion_tokens ?? 0

    const choice = completion.choices?.[0]
    const message = choice?.message
    const toolCalls = message?.tool_calls ?? []

    // Append the assistant turn so the next loop has the right history.
    messages.push({
      role: 'assistant',
      content: message?.content ?? null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    })

    if (toolCalls.length === 0) {
      // No tool call. In single-emit mode this is a violation; in multi-emit
      // mode we've collected nothing yet — also a violation. Throw.
      throw new AgentEmitMissedError(
        `Iteration ${iterationsRun} produced no tool call (finish_reason=${choice?.finish_reason ?? 'unknown'})`,
      )
    }

    // Process each tool call. Multi-emit mode: a single iteration may emit
    // several at once, e.g. emit_summary + emit_action_items together.
    for (const call of toolCalls) {
      const name = call.function.name
      const argsRaw = call.function.arguments
      const tStart = Date.now()
      let parsedArgs: unknown
      try {
        parsedArgs = argsRaw ? (JSON.parse(argsRaw) as unknown) : {}
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        const replyContent = JSON.stringify({ error: 'invalid_json', message: err.slice(0, 200) })
        messages.push({ role: 'tool', tool_call_id: call.id, content: replyContent })
        toolCallsLog.push({ iteration: iterationsRun, name, args: argsRaw, ok: false, tookMs: 0, error: err })
        continue
      }

      // Emit tool? Validate and collect; do NOT execute (no handler to run).
      if (emitNames.has(name)) {
        const def = emitTools.find((t) => t.name === name)
        if (!def) continue
        const validation = validateAgainst(def.parameters, parsedArgs)
        if (!validation.ok) {
          const reply = JSON.stringify({ error: 'invalid_args', message: validation.reason })
          messages.push({ role: 'tool', tool_call_id: call.id, content: reply })
          toolCallsLog.push({
            iteration: iterationsRun, name, args: parsedArgs,
            ok: false, tookMs: Date.now() - tStart, error: validation.reason,
          })
          continue
        }
        collectedEmits.set(name, { name, args: parsedArgs })
        // Echo the args back so the model knows the emit was accepted —
        // some providers expect a tool reply for every tool_call_id.
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true }) })
        toolCallsLog.push({ iteration: iterationsRun, name, args: parsedArgs, ok: true, tookMs: Date.now() - tStart })
        continue
      }

      // Read tool — find handler, invoke, JSON-stringify the result.
      const def = tools.find((t) => t.name === name)
      if (!def) {
        const reply = JSON.stringify({ error: 'unknown_tool', message: `No tool named "${name}"` })
        messages.push({ role: 'tool', tool_call_id: call.id, content: reply })
        toolCallsLog.push({
          iteration: iterationsRun, name, args: parsedArgs,
          ok: false, tookMs: 0, error: 'unknown_tool',
        })
        continue
      }

      try {
        const validation = validateAgainst(def.parameters, parsedArgs)
        if (!validation.ok) throw new AgentToolValidationError(name, validation.reason)
        const result = await def.handler(parsedArgs, ctx)
        const json = JSON.stringify(result)
        const truncated = json.length > ctx.maxResultChars
        const replyContent = truncated
          ? json.slice(0, ctx.maxResultChars) + ' [trunc]'
          : json
        messages.push({ role: 'tool', tool_call_id: call.id, content: replyContent })
        toolCallsLog.push({
          iteration: iterationsRun, name, args: parsedArgs,
          ok: true, tookMs: Date.now() - tStart,
        })
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        const reply = JSON.stringify({ error: 'tool_failed', message: errMsg.slice(0, 300) })
        messages.push({ role: 'tool', tool_call_id: call.id, content: reply })
        toolCallsLog.push({
          iteration: iterationsRun, name, args: parsedArgs,
          ok: false, tookMs: Date.now() - tStart, error: errMsg,
        })
        logger.warn(`Tool "${name}" failed: ${errMsg.slice(0, 200)}`)
      }
    }

    // Termination check.
    // Single-emit mode: any emit observed → done.
    // Multi-emit mode: every emit name observed at least once → done.
    if (emitTools.length === 1 && collectedEmits.size > 0) break
    if (emitTools.length > 1 && collectedEmits.size >= emitTools.length) break
  }

  if (collectedEmits.size === 0) {
    throw new AgentEmitMissedError(`Loop exited after ${iterationsRun} iterations without any emit`)
  }
  if (emitTools.length > 1 && collectedEmits.size < emitTools.length) {
    const missing = emitTools.filter((t) => !collectedEmits.has(t.name)).map((t) => t.name).join(', ')
    throw new AgentEmitMissedError(`Loop exited without these emits: ${missing}`)
  }

  return {
    finalToolCalls: Array.from(collectedEmits.values()),
    iterationsRun,
    toolCallsLog,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toToolDef(def: ToolDefinition): {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
} {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }
}

interface PostArgs {
  config: ProviderConfig
  messages: OpenAiToolMessage[]
  tools: ReturnType<typeof toToolDef>[]
  toolChoice: 'auto' | { type: 'function'; function: { name: string } }
}

async function postCompletion(args: PostArgs): Promise<OpenAiCompletion> {
  const { config, messages, tools, toolChoice } = args
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(config.callTimeoutMs),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools,
      tool_choice: toolChoice,
      temperature: 0.3,
      max_tokens: 4096,
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Agent provider HTTP ${response.status}: ${text.slice(0, 300)}`)
  }
  const data = (await response.json().catch(() => null)) as OpenAiCompletion | null
  if (!data || !Array.isArray(data.choices)) {
    throw new Error('Agent provider returned malformed JSON')
  }
  return data
}

export const TOOL_RESULT_CHAR_DEFAULT = MAX_TOOL_RESULT_CHARS_DEFAULT
