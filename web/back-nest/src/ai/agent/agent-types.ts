/**
 * @file agent-types.ts — interfaces for the tool-using agent runtime.
 *
 * NOTE: tool argument schemas are JsonSchema literals (see json-schema.ts),
 * NOT class-validator DTOs. CLAUDE.md "DTOs are classes" rule applies to
 * @Body() request bodies; these schemas serialize directly onto the
 * function-calling wire format expected by OpenAI/Z.AI/Gemini.
 */

import type { Logger } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { JsonSchema } from './json-schema.js'

export type AgentProvider = 'zai' | 'openai' | 'gemini'

/** Per-call context passed to every tool handler. */
export interface ToolContext {
  projectId: string
  userId?: string | null
  logger: Logger
  prisma: PrismaService
  /** Hard cap (chars) on a single tool result before it gets `[trunc]`-ed. */
  maxResultChars: number
}

/** A single read-only tool the agent can call. */
export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string
  description: string
  parameters: JsonSchema
  /** Pure async function. Throw on unrecoverable errors; the runner
   *  surfaces them as `{error: 'tool_failed', message: ...}` to the model. */
  handler: (args: TArgs, ctx: ToolContext) => Promise<TResult>
}

/** Input to AgentRunnerService.run(). */
export interface AgentRunInput<TOutput> {
  /** The system prompt — defines the agent's role + when to call which tools. */
  systemPrompt: string
  /** Optional initial user message (most agents skip this and lean on the system prompt). */
  userMessage?: string
  /** Read-only tools available to the agent during the loop. */
  tools: ToolDefinition[]
  /**
   * Terminal "emit" tool(s). Single tool = forced via `tool_choice` on the
   * final iteration. Multiple = collect-all mode (loop ends once every emit
   * has been called at least once OR maxIterations reached).
   */
  emitTools: ToolDefinition[]
  /** Per-loop iteration cap. */
  maxIterations: number
  /** Wall-clock cap across the whole loop. Defaults to 5 min. */
  loopTimeoutMs?: number
  /** Per-feature label for AiUsage logging. */
  feature: 'cahier' | 'backlog' | 'meeting-analysis'
  /** Project context — required for tools, also feeds into AiUsage. */
  projectId: string
  /** Optional override of the configured provider. */
  provider?: AgentProvider
  /**
   * If true, parses the SECOND emit-tool result as the output (used by
   * multi-emit terminal mode where we want to merge multiple tool results).
   * The runner doesn't merge; the caller's `combineEmits` does.
   */
  combineEmits?: (calls: Array<{ name: string; args: unknown }>) => TOutput
}

/** Successful result of run(). */
export interface AgentRunResult<TOutput> {
  output: TOutput
  iterations: number
  toolCallsLog: ToolCallLogEntry[]
  provider: AgentProvider
  model: string
}

export interface ToolCallLogEntry {
  iteration: number
  name: string
  args: unknown
  ok: boolean
  tookMs: number
  error?: string
}

/** Internal — what each tool-loop binding returns to the runner. */
export interface LoopOutcome {
  finalToolCalls: Array<{ name: string; args: unknown }>
  iterationsRun: number
  toolCallsLog: ToolCallLogEntry[]
  promptTokens: number
  completionTokens: number
}

/** Provider-specific config plumbed by AgentRunnerService. */
export interface ProviderConfig {
  name: AgentProvider
  apiKey: string
  baseUrl: string
  model: string
  /** Per-POST timeout (ms). Loop wall-clock cap is separate. */
  callTimeoutMs: number
}
