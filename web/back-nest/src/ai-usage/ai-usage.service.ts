import { Injectable, Logger, ForbiddenException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service.js'

export type AiFeature =
  | 'cahier'
  | 'checklist'
  | 'backlog'
  | 'meeting-analysis'
  | 'transcribe'
  | 'transcribe-chunk'

export interface AiUsageInput {
  projectId?: string | null
  userId?: string | null
  provider: string
  model: string
  feature: AiFeature
  promptTokens?: number
  completionTokens?: number
  audioSeconds?: number
  durationMs?: number
  success?: boolean
  errorMessage?: string
}

/**
 * Per-feature unit costs in USD per 1k tokens (chat) or per second (audio).
 * These are best-effort defaults — real billing happens on the provider side;
 * we only track an estimate so the admin can see a per-project ballpark.
 */
const COST_PER_1K_PROMPT_TOKENS: Record<string, number> = {
  'gpt-4o-mini': 0.00015,
  'gpt-4o': 0.0025,
  'glm-4.5-air': 0.00015,
  'gemini-1.5-flash': 0.00015,
  // default below
}
const COST_PER_1K_COMPLETION_TOKENS: Record<string, number> = {
  'gpt-4o-mini': 0.0006,
  'gpt-4o': 0.01,
  'glm-4.5-air': 0.0006,
  'gemini-1.5-flash': 0.0006,
}
const FALLBACK_COST_PROMPT = 0.0002
const FALLBACK_COST_COMPLETION = 0.0008

const COST_PER_AUDIO_SECOND: Record<string, number> = {
  assemblyai: 0.000106, // ~$0.38/h for Universal-2
  'local-whisper': 0,    // self-hosted
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Daily token budget per project. 0 / unset = unlimited. */
  private get dailyTokenCap(): number {
    const raw = this.config.get<string>('AI_MAX_TOKENS_PER_PROJECT_PER_DAY')
    const n = raw ? parseInt(raw, 10) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  /**
   * Throws ForbiddenException if the project would exceed its daily token
   * budget after a hypothetical `estimateTokens` call. Pass 0 (or omit) to
   * just check the current usage — useful before pricier paths like cahier
   * generation. No-op when AI_MAX_TOKENS_PER_PROJECT_PER_DAY is unset.
   */
  async assertWithinDailyBudget(projectId: string | null | undefined, estimateTokens = 0): Promise<void> {
    if (!projectId || this.dailyTokenCap === 0) return
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const agg = await this.prisma.aiUsage.aggregate({
      where: { projectId, createdAt: { gte: since } },
      _sum: { totalTokens: true },
    })
    const used = agg._sum.totalTokens ?? 0
    if (used + estimateTokens >= this.dailyTokenCap) {
      throw new ForbiddenException(
        `Quota IA quotidien atteint pour ce projet (${used}/${this.dailyTokenCap} tokens). Réessayez demain ou contactez l'administrateur.`,
      )
    }
  }

  /** Fire-and-forget log of one AI call. Never throws — usage tracking must
   *  not break the calling business path. */
  async log(input: AiUsageInput): Promise<void> {
    try {
      const promptTokens = Math.max(0, Math.floor(input.promptTokens ?? 0))
      const completionTokens = Math.max(0, Math.floor(input.completionTokens ?? 0))
      const audioSeconds = Math.max(0, Math.floor(input.audioSeconds ?? 0))
      const totalTokens = promptTokens + completionTokens
      const costEstimate = this.estimateCost(input.model, input.provider, promptTokens, completionTokens, audioSeconds)

      await this.prisma.aiUsage.create({
        data: {
          projectId: input.projectId ?? null,
          userId: input.userId ?? null,
          provider: (input.provider || 'unknown').slice(0, 40),
          model: (input.model || 'unknown').slice(0, 80),
          feature: input.feature,
          promptTokens,
          completionTokens,
          totalTokens,
          audioSeconds,
          costEstimateUsd: costEstimate,
          durationMs: Math.max(0, Math.floor(input.durationMs ?? 0)),
          success: input.success ?? true,
          errorMessage: input.errorMessage ? input.errorMessage.slice(0, 500) : null,
        },
      })
    } catch (err) {
      this.logger.warn(
        `AiUsage log failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private estimateCost(
    model: string,
    provider: string,
    promptTokens: number,
    completionTokens: number,
    audioSeconds: number,
  ): number {
    const m = model.toLowerCase()
    const p = provider.toLowerCase()
    const promptRate = COST_PER_1K_PROMPT_TOKENS[m] ?? FALLBACK_COST_PROMPT
    const completionRate = COST_PER_1K_COMPLETION_TOKENS[m] ?? FALLBACK_COST_COMPLETION
    const audioRate = COST_PER_AUDIO_SECOND[p] ?? 0
    return (
      (promptTokens / 1000) * promptRate +
      (completionTokens / 1000) * completionRate +
      audioSeconds * audioRate
    )
  }

  /** Aggregate usage by project for the admin dashboard. */
  async summaryByProject(daysBack = 30) {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    const rows = await this.prisma.aiUsage.groupBy({
      by: ['projectId', 'feature'],
      where: { createdAt: { gte: since } },
      _sum: {
        totalTokens: true,
        audioSeconds: true,
        costEstimateUsd: true,
      },
      _count: { _all: true },
    })
    return rows.map((r) => ({
      projectId: r.projectId,
      feature: r.feature,
      calls: r._count._all,
      totalTokens: r._sum.totalTokens ?? 0,
      audioSeconds: r._sum.audioSeconds ?? 0,
      costEstimateUsd: Number((r._sum.costEstimateUsd ?? 0).toFixed(4)),
    }))
  }
}
