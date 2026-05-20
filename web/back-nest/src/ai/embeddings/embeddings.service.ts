/**
 * @file embeddings.service.ts — thin NestJS client over the FastAPI
 * `/embed` endpoint (multilingual-e5-small, self-hosted in the
 * transcription container).
 *
 * Public surface:
 *   - embed(texts, inputType) — returns Result<number[][]>
 *
 * Failure semantics:
 *   - FastAPI 503 (model not loaded yet) → Result.fail('embedding_unavailable')
 *   - HTTP timeout / network error → Result.fail('embedding_timeout' | 'embedding_network')
 *   - Caller is expected to degrade gracefully (e.g. the semantic agent tool
 *     falls back to the keyword variant).
 *
 * Cost tracking:
 *   - Every call logs an AiUsage row with `provider='local-e5'`, `feature='embed'`,
 *     `costEstimateUsd=0`. Lets the admin dashboard see embed volume even
 *     though the bill is zero.
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Result } from '../../common/result.js'
import { AiUsageService } from '../../ai-usage/ai-usage.service.js'

export type EmbeddingInputType = 'passage' | 'query'

interface EmbedResponseBody {
  embeddings: number[][]
  model: string
  dim: number
}

/** Hard caps mirroring the FastAPI side. We trim here too so a bad caller
 *  gets an immediate Result.fail instead of a wasted round-trip. */
const MAX_BATCH = 64
const MAX_TEXT_CHARS = 2000

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name)

  constructor(
    private readonly config: ConfigService,
    private readonly aiUsage: AiUsageService,
  ) {}

  /** Quick gate so callers can short-circuit when the service isn't wired. */
  isConfigured(): boolean {
    return !!(this.config.get<string>('TRANSCRIPTION_URL') && this.config.get<string>('TRANSCRIPTION_SECRET'))
  }

  /**
   * Embed up to MAX_BATCH texts. Caller chooses prefix via `inputType`:
   *  - 'passage' when indexing (segments, field values).
   *  - 'query'   when an agent search-time tool runs.
   * Mixing prefixes breaks cosine similarity — keep them consistent per
   * use site.
   *
   * Returns Result.fail on any failure mode; never throws. Callers degrade
   * gracefully (semantic tool falls back to keyword search).
   */
  async embed(
    texts: string[],
    inputType: EmbeddingInputType,
    opts: { projectId?: string | null } = {},
  ): Promise<Result<number[][]>> {
    if (!Array.isArray(texts)) return Result.fail<number[][]>('texts must be an array')
    if (texts.length === 0) return Result.ok<number[][]>([])
    if (texts.length > MAX_BATCH) {
      return Result.fail<number[][]>(`batch too large: max ${MAX_BATCH}`)
    }

    const baseUrl = (this.config.get<string>('TRANSCRIPTION_URL') ?? 'http://transcription:8000').replace(/\/$/, '')
    const secret = this.config.get<string>('TRANSCRIPTION_SECRET')
    if (!secret) return Result.fail<number[][]>('embedding_unconfigured')

    // Trim each text to the same cap the FastAPI enforces. Lets us reject
    // empty rows here too (caller can filter beforehand).
    const sanitized = texts.map((t) => {
      if (typeof t !== 'string') return ''
      return t.trim().slice(0, MAX_TEXT_CHARS)
    })

    const timeoutMs = Number(this.config.get<string>('EMBEDDING_TIMEOUT_MS') ?? 30_000)
    const startedAt = Date.now()
    try {
      const response = await fetch(`${baseUrl}/embed`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          'X-Transcription-Secret': secret,
        },
        body: JSON.stringify({ texts: sanitized, input_type: inputType }),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        // 503 specifically — model not loaded yet. Distinguish so the caller
        // can decide whether to retry or fall back to keyword search.
        const reason = response.status === 503 ? 'embedding_unavailable' : `embedding_http_${response.status}`
        this.logger.warn(`embed ${response.status}: ${text.slice(0, 200)}`)
        void this.logUsage(opts.projectId, 0, Date.now() - startedAt, false)
        return Result.fail<number[][]>(reason)
      }

      const body = (await response.json().catch(() => null)) as EmbedResponseBody | null
      if (!body || !Array.isArray(body.embeddings)) {
        void this.logUsage(opts.projectId, 0, Date.now() - startedAt, false)
        return Result.fail<number[][]>('embedding_malformed_response')
      }

      // The endpoint guarantees one vector per input even when the input
      // string was empty (zero-vector padding). Assert here so callers can
      // safely zip back with the original texts array.
      if (body.embeddings.length !== sanitized.length) {
        this.logger.warn(`embed length mismatch: expected ${sanitized.length} got ${body.embeddings.length}`)
        void this.logUsage(opts.projectId, 0, Date.now() - startedAt, false)
        return Result.fail<number[][]>('embedding_length_mismatch')
      }

      // Rough token estimate for AiUsage: 1 token ≈ 4 chars for our mix.
      const approxTokens = Math.ceil(sanitized.reduce((sum, t) => sum + t.length, 0) / 4)
      void this.logUsage(opts.projectId, approxTokens, Date.now() - startedAt, true)
      return Result.ok<number[][]>(body.embeddings)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      const reason = msg.includes('aborted') || msg.includes('timeout') ? 'embedding_timeout' : 'embedding_network'
      this.logger.warn(`embed ${reason}: ${msg.slice(0, 200)}`)
      void this.logUsage(opts.projectId, 0, Date.now() - startedAt, false)
      return Result.fail<number[][]>(reason)
    }
  }

  private async logUsage(
    projectId: string | null | undefined,
    approxTokens: number,
    durationMs: number,
    success: boolean,
  ): Promise<void> {
    try {
      await this.aiUsage.log({
        projectId: projectId ?? null,
        provider: 'local-e5',
        model: 'multilingual-e5-small',
        feature: 'embed',
        durationMs,
        success,
        promptTokens: approxTokens,
        completionTokens: 0,
      })
    } catch {
      // AiUsage failure is non-fatal — don't surface it to the caller.
    }
  }
}
