/**
 * @file agent-runner.service.ts — orchestrates a tool-using agent loop.
 *
 * Picks the provider config based on AI_PROVIDER (default 'zai'), runs
 * the OpenAI-compatible loop, logs each round-trip into AiUsage, and
 * returns the parsed terminal emit-tool args.
 *
 * Gemini is intentionally NOT supported in agent mode for v1: Z.AI is
 * the primary, OpenAI is the agent fallback. Gemini stays available
 * via the single-shot path on AiProviderFactory for callers that want it.
 */

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service.js'
import { AiUsageService } from '../../ai-usage/ai-usage.service.js'
import type {
  AgentProvider,
  AgentRunInput,
  AgentRunResult,
  ProviderConfig,
} from './agent-types.js'
import { runOpenAiCompatibleLoop, TOOL_RESULT_CHAR_DEFAULT } from './openai-compatible-tool-loop.js'
import { AgentEmitMissedError } from './agent-errors.js'

const DEFAULT_LOOP_TIMEOUT_MS = 5 * 60 * 1000
// 45s was too tight for glm-4.5-air's final emit on a 9-key cahier JSON —
// real prod test caught the agent loop aborting mid-completion at 68s wall
// time (45s per-call * retries). 120s gives the model breathing room.
const DEFAULT_PER_CALL_TIMEOUT_MS = 120_000
/** Mid-loop budget re-check iteration. */
const BUDGET_RECHECK_AT_ITER = 4

@Injectable()
export class AgentRunnerService implements OnModuleInit {
  private readonly logger = new Logger(AgentRunnerService.name)

  constructor(
    private readonly config: ConfigService,
    private readonly aiUsage: AiUsageService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Log the resolved AI configuration once at startup. Catches the
   * misconfiguration class (wrong/typo'd model, missing key, agent mode off)
   * at boot instead of as a generic "indisponible" on the first user request.
   */
  onModuleInit(): void {
    const enabled = this.config.get<string>('AI_ENABLED') ?? 'false'
    const agentMode = this.config.get<string>('AI_AGENT_MODE') ?? 'off'
    const provider = this.resolveProvider()
    try {
      const cfg = this.providerConfig(provider)
      this.logger.log(
        `AI config — enabled=${enabled} agentMode=${agentMode} provider=${provider} ` +
          `model=${cfg.model} baseUrl=${cfg.baseUrl} apiKey=${cfg.apiKey ? 'set' : 'MISSING'}`,
      )
    } catch (e) {
      this.logger.warn(
        `AI config — enabled=${enabled} agentMode=${agentMode} provider=${provider}: ` +
          `provider NOT usable — ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  /**
   * Run an agent loop synchronously. Throws on failure — callers that want
   * to gracefully fall back to single-shot should catch `AgentEmitMissedError`
   * (and any other thrown error) and re-route.
   */
  async run<TOutput>(input: AgentRunInput<TOutput>): Promise<AgentRunResult<TOutput>> {
    const provider = input.provider ?? this.resolveProvider()
    if (provider === 'gemini') {
      throw new AgentEmitMissedError('Gemini is not supported in agent mode for v1; fall back to single-shot.')
    }
    const config = this.providerConfig(provider)

    const startedAt = Date.now()
    // Budget check at iteration 0 — runaway-cost circuit breaker.
    await this.aiUsage.assertWithinDailyBudget(input.projectId, 8_000)

    const ctx = {
      projectId: input.projectId,
      logger: this.logger,
      prisma: this.prisma,
      maxResultChars: TOOL_RESULT_CHAR_DEFAULT,
    }

    let outcome
    try {
      outcome = await runOpenAiCompatibleLoop({
        config,
        logger: this.logger,
        ctx,
        systemPrompt: input.systemPrompt,
        userMessage: input.userMessage ?? null,
        tools: input.tools,
        emitTools: input.emitTools,
        maxIterations: input.maxIterations,
        loopTimeoutMs: input.loopTimeoutMs ?? DEFAULT_LOOP_TIMEOUT_MS,
      })
    } catch (e) {
      // Single failed log row for the whole loop attempt.
      void this.aiUsage.log({
        projectId: input.projectId,
        provider,
        model: config.model,
        feature: input.feature,
        durationMs: Date.now() - startedAt,
        success: false,
        errorMessage: e instanceof Error ? e.message : String(e),
      })
      throw e
    }

    // Mid-loop budget re-check post-hoc — if the loop already burned more
    // than the recheck threshold, surface it on the next call. Phase 1
    // does the cheap version; Phase 2+ can split into per-iteration logging.
    if (outcome.iterationsRun > BUDGET_RECHECK_AT_ITER) {
      try {
        await this.aiUsage.assertWithinDailyBudget(input.projectId)
      } catch (budgetErr) {
        this.logger.warn(
          `Daily budget exceeded after ${outcome.iterationsRun} iter; future runs blocked: ${
            budgetErr instanceof Error ? budgetErr.message : String(budgetErr)
          }`,
        )
      }
    }

    void this.aiUsage.log({
      projectId: input.projectId,
      provider,
      model: config.model,
      feature: input.feature,
      promptTokens: outcome.promptTokens,
      completionTokens: outcome.completionTokens,
      durationMs: Date.now() - startedAt,
      success: true,
    })

    // Resolve final output. Single-emit → first call's args. Multi-emit →
    // caller-provided combineEmits handles the merge.
    let output: TOutput
    if (input.emitTools.length === 1) {
      output = outcome.finalToolCalls[0].args as TOutput
    } else {
      if (!input.combineEmits) {
        throw new Error(
          'AgentRunInput.combineEmits is required when emitTools.length > 1',
        )
      }
      output = input.combineEmits(outcome.finalToolCalls)
    }

    return {
      output,
      iterations: outcome.iterationsRun,
      toolCallsLog: outcome.toolCallsLog,
      provider,
      model: config.model,
    }
  }

  /**
   * Fire-and-forget mode for callers that need the loop detached from the
   * HTTP response cycle (e.g. transcript analysis). Errors are caught and
   * passed to onError; the function never throws.
   */
  runDetached<TOutput>(
    input: AgentRunInput<TOutput>,
    onResult: (result: AgentRunResult<TOutput>) => void | Promise<void>,
    onError: (err: Error) => void | Promise<void>,
  ): void {
    void (async () => {
      try {
        const result = await this.run(input)
        await onResult(result)
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        await onError(err)
      }
    })()
  }

  // ─── Provider resolution ──────────────────────────────────────────────────

  private resolveProvider(): AgentProvider {
    const raw = (this.config.get<string>('AI_PROVIDER') ?? 'zai').toLowerCase()
    if (raw === 'zai' || raw === 'openai' || raw === 'gemini') return raw
    return 'zai'
  }

  private providerConfig(name: AgentProvider): ProviderConfig {
    if (name === 'zai') {
      const apiKey = this.config.get<string>('AI_FALLBACK_API_KEY')
      if (!apiKey) throw new Error('AI_FALLBACK_API_KEY required for Z.AI agent mode')
      return {
        name: 'zai',
        apiKey,
        baseUrl: this.config.get<string>('AI_FALLBACK_BASE_URL') ?? 'https://api.z.ai/api/coding/paas/v4',
        model: this.config.get<string>('AI_FALLBACK_MODEL') ?? 'glm-4.5-air',
        callTimeoutMs: DEFAULT_PER_CALL_TIMEOUT_MS,
      }
    }
    if (name === 'openai') {
      const apiKey = this.config.get<string>('OPENAI_API_KEY')
      if (!apiKey) throw new Error('OPENAI_API_KEY required for OpenAI agent mode')
      return {
        name: 'openai',
        apiKey,
        baseUrl: this.config.get<string>('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1',
        model: this.config.get<string>('AI_MODEL') ?? 'gpt-4o-mini',
        callTimeoutMs: DEFAULT_PER_CALL_TIMEOUT_MS,
      }
    }
    throw new Error(`Provider ${name} not supported in agent mode`)
  }

  /** True when the env vars needed to run this agent loop are configured. */
  isAgentModeAvailable(provider?: AgentProvider): boolean {
    try {
      this.providerConfig(provider ?? this.resolveProvider())
      return true
    } catch {
      return false
    }
  }
}
