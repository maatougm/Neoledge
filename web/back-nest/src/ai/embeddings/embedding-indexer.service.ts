/**
 * @file embedding-indexer.service.ts — combines `EmbeddingsService` (HTTP
 * client over the FastAPI `/embed` endpoint) with raw SQL writes to the
 * three pgvector columns added in migration 20260517120100. Each write
 * site (transcript ingestion, AI analyze, field-value upsert) calls
 * `indexAndStore(...)` fire-and-forget; failures are logged-and-eaten.
 *
 * The indexer is designed to be called immediately after the source row
 * is committed — there's no debouncing here. The field-value path
 * debounces upstream (in the collaboration socket / pm.controller path)
 * to coalesce rapid edits before triggering the embedding call.
 */

import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import { EmbeddingsService } from './embeddings.service.js'

export type IndexTarget = 'segment' | 'field-value' | 'summary'

export interface IndexItem {
  id: string
  text: string
}

@Injectable()
export class EmbeddingIndexerService {
  private readonly logger = new Logger(EmbeddingIndexerService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /** Embed every item's text in parallel (one /embed batch call) and
   *  UPDATE the corresponding row's embedding column. Idempotent — re-
   *  embedding a row just overwrites the prior vector. Fire-and-forget
   *  callers should chain `.catch(...)` on the returned promise.
   */
  async indexAndStore(
    target: IndexTarget,
    items: IndexItem[],
    opts: { projectId?: string | null } = {},
  ): Promise<{ indexed: number; failed: number }> {
    if (items.length === 0) return { indexed: 0, failed: 0 }
    if (!this.embeddings.isConfigured()) return { indexed: 0, failed: items.length }

    // Multi-tenancy: the UPDATE statements are scoped by projectId so a
    // buggy caller can never overwrite another tenant's vectors. Every
    // existing call site already passes opts.projectId; require it.
    const projectId = opts.projectId
    if (!projectId) {
      throw new Error('indexAndStore requires opts.projectId for tenant scoping')
    }

    // Filter out empty texts upfront — the embed endpoint would pad with
    // a zero vector, but we'd rather not waste the SQL roundtrip.
    const filtered = items.filter((it) => typeof it.text === 'string' && it.text.trim().length > 0)
    if (filtered.length === 0) return { indexed: 0, failed: 0 }

    const result = await this.embeddings.embed(
      filtered.map((it) => it.text),
      'passage',
      { projectId },
    )
    if (result.isFailure || !result.value) {
      this.logger.warn(`indexAndStore ${target}: embed failed — ${result.error ?? 'unknown'}`)
      return { indexed: 0, failed: filtered.length }
    }

    let indexed = 0
    let failed = 0
    const updateSql = this.updateSqlFor(target)
    for (let i = 0; i < filtered.length; i++) {
      const vec = result.value[i]
      if (!vec) { failed += 1; continue }
      try {
        // $1 vector literal, $2 row id, $3 projectId (tenant guard).
        await this.prisma.$executeRawUnsafe(updateSql, `[${vec.join(',')}]`, filtered[i].id, projectId)
        indexed += 1
      } catch (e) {
        failed += 1
        this.logger.warn(
          `indexAndStore ${target} UPDATE id=${filtered[i].id} failed: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }

    return { indexed, failed }
  }

  private updateSqlFor(target: IndexTarget): string {
    switch (target) {
      // Segments have no projectId column — scope via the parent transcript.
      case 'segment':
        return `UPDATE "TranscriptSegments" SET embedding = $1::vector
                 WHERE id = $2
                   AND EXISTS (
                     SELECT 1 FROM "MeetingTranscripts" m
                      WHERE m.id = "TranscriptSegments"."transcriptId"
                        AND m."projectId" = $3
                   )`
      case 'field-value':
        return `UPDATE "ProjectFieldValues" SET embedding = $1::vector
                 WHERE id = $2 AND "projectId" = $3`
      case 'summary':
        return `UPDATE "MeetingTranscripts" SET "summaryEmbedding" = $1::vector
                 WHERE id = $2 AND "projectId" = $3`
    }
  }
}
