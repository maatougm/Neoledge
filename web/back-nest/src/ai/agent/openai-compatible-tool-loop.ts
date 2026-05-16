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

  // Z.AI rejects `messages` arrays that contain only a system turn (HTTP
  // 400 "messages parameter is illegal"), so we always add a user kick-off
  // — either the caller-supplied one, or a generic "begin" instruction.
  const messages: OpenAiToolMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage ?? 'Commence par appeler les fonctions de lecture nécessaires, puis appelle l\'outil terminal d\'émission une fois prêt.' },
  ]

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
    // Z.AI rejects `content: null` on assistant turns even when tool_calls
    // are present (HTTP 400 "messages parameter is illegal"); coerce to ''.
    messages.push({
      role: 'assistant',
      content: message?.content ?? '',
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    })

    if (toolCalls.length === 0) {
      // No tool call. In single-emit mode this is a violation; in multi-emit
      // mode we've collected nothing yet — also a violation. Throw.
      throw new AgentEmitMissedError(
        `Iteration ${iterationsRun} produced no tool call (finish_reason=${choice?.finish_reason ?? 'unknown'})`,
      )
    }

    // ─── Phase 1: parallel tool-call processing ──────────────────────────
    //
    // The model can emit N tool_calls in a single assistant message (e.g.
    // read_questionnaire + read_meeting_summaries + read_validated_cahier).
    // Reading them sequentially was the dominant cost of the cahier agent
    // loop — most read tools are independent DB queries.
    //
    // Strategy:
    //   1. Pre-classify every call (parse, identify emit vs read vs error).
    //   2. Fire every READ handler in parallel via Promise.all (emit tools
    //      have no handler to run — they're just validated + collected).
    //   3. Walk the original tool_calls array IN ORDER to push the tool
    //      replies. OpenAI's chat-completions API requires that every
    //      tool_call_id is answered AND that the replies appear in the
    //      same order as the tool_calls field of the assistant message.
    type Job =
      | { kind: 'parse-error'; call: typeof toolCalls[number]; tStart: number; argsRaw: string | undefined; error: string }
      | { kind: 'unknown'; call: typeof toolCalls[number]; tStart: number; parsedArgs: unknown }
      | { kind: 'emit'; call: typeof toolCalls[number]; tStart: number; parsedArgs: unknown; def: ToolDefinition }
      | { kind: 'read'; call: typeof toolCalls[number]; tStart: number; parsedArgs: unknown; def: ToolDefinition }

    const jobs: Job[] = toolCalls.map((call) => {
      const tStart = Date.now()
      const name = call.function.name
      const argsRaw = call.function.arguments
      let parsedArgs: unknown
      try {
        parsedArgs = argsRaw ? (JSON.parse(argsRaw) as unknown) : {}
      } catch (e) {
        return {
          kind: 'parse-error' as const,
          call, tStart, argsRaw,
          error: e instanceof Error ? e.message : String(e),
        }
      }
      if (emitNames.has(name)) {
        const def = emitTools.find((t) => t.name === name)
        if (!def) return { kind: 'unknown' as const, call, tStart, parsedArgs }
        return { kind: 'emit' as const, call, tStart, parsedArgs, def }
      }
      const def = tools.find((t) => t.name === name)
      if (!def) return { kind: 'unknown' as const, call, tStart, parsedArgs }
      return { kind: 'read' as const, call, tStart, parsedArgs, def }
    })

    // Execute every READ handler concurrently. Each handler's try/catch is
    // independent so one failing handler doesn't abort the rest of the batch.
    type ReadOutcome =
      | { ok: true; replyContent: string; tookMs: number }
      | { ok: false; replyContent: string; tookMs: number; error: string }

    const readJobs = jobs.filter((j): j is Extract<Job, { kind: 'read' }> => j.kind === 'read')
    const readOutcomes = await Promise.all(
      readJobs.map(async (job): Promise<ReadOutcome> => {
        try {
          const validation = validateAgainst(job.def.parameters, job.parsedArgs)
          if (!validation.ok) throw new AgentToolValidationError(job.def.name, validation.reason)
          const result = await job.def.handler(job.parsedArgs, ctx)
          const json = JSON.stringify(result)
          const truncated = json.length > ctx.maxResultChars
          const replyContent = truncated
            ? json.slice(0, ctx.maxResultChars) + ' [trunc]'
            : json
          return { ok: true, replyContent, tookMs: Date.now() - job.tStart }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e)
          logger.warn(`Tool "${job.def.name}" failed: ${errMsg.slice(0, 200)}`)
          return {
            ok: false,
            replyContent: JSON.stringify({ error: 'tool_failed', message: errMsg.slice(0, 300) }),
            tookMs: Date.now() - job.tStart,
            error: errMsg,
          }
        }
      }),
    )
    const readOutcomeByCallId = new Map(
      readJobs.map((job, idx) => [job.call.id, readOutcomes[idx]] as const),
    )

    // Push tool replies in the ORIGINAL tool_calls order. Mandatory for
    // OpenAI's API — out-of-order replies trigger a 400.
    for (const job of jobs) {
      if (job.kind === 'parse-error') {
        const reply = JSON.stringify({ error: 'invalid_json', message: job.error.slice(0, 200) })
        messages.push({ role: 'tool', tool_call_id: job.call.id, content: reply })
        toolCallsLog.push({
          iteration: iterationsRun, name: job.call.function.name, args: job.argsRaw,
          ok: false, tookMs: 0, error: job.error,
        })
        continue
      }
      if (job.kind === 'unknown') {
        const reply = JSON.stringify({ error: 'unknown_tool', message: `No tool named "${job.call.function.name}"` })
        messages.push({ role: 'tool', tool_call_id: job.call.id, content: reply })
        toolCallsLog.push({
          iteration: iterationsRun, name: job.call.function.name, args: job.parsedArgs,
          ok: false, tookMs: 0, error: 'unknown_tool',
        })
        continue
      }
      if (job.kind === 'emit') {
        const validation = validateAgainst(job.def.parameters, job.parsedArgs)
        if (!validation.ok) {
          const reply = JSON.stringify({ error: 'invalid_args', message: validation.reason })
          messages.push({ role: 'tool', tool_call_id: job.call.id, content: reply })
          toolCallsLog.push({
            iteration: iterationsRun, name: job.def.name, args: job.parsedArgs,
            ok: false, tookMs: Date.now() - job.tStart, error: validation.reason,
          })
          continue
        }
        collectedEmits.set(job.def.name, { name: job.def.name, args: job.parsedArgs })
        // Echo back so the model sees its emit was accepted; OpenAI also
        // requires every tool_call_id to be answered.
        messages.push({ role: 'tool', tool_call_id: job.call.id, content: JSON.stringify({ ok: true }) })
        toolCallsLog.push({
          iteration: iterationsRun, name: job.def.name, args: job.parsedArgs,
          ok: true, tookMs: Date.now() - job.tStart,
        })
        continue
      }
      // kind === 'read'
      const outcome = readOutcomeByCallId.get(job.call.id)
      if (!outcome) {
        // Defensive — should be impossible if the readJobs/outcome map are aligned.
        const reply = JSON.stringify({ error: 'tool_failed', message: 'missing read outcome' })
        messages.push({ role: 'tool', tool_call_id: job.call.id, content: reply })
        toolCallsLog.push({
          iteration: iterationsRun, name: job.def.name, args: job.parsedArgs,
          ok: false, tookMs: 0, error: 'missing_outcome',
        })
        continue
      }
      messages.push({ role: 'tool', tool_call_id: job.call.id, content: outcome.replyContent })
      toolCallsLog.push({
        iteration: iterationsRun, name: job.def.name, args: job.parsedArgs,
        ok: outcome.ok, tookMs: outcome.tookMs,
        ...(outcome.ok ? {} : { error: outcome.error }),
      })
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
