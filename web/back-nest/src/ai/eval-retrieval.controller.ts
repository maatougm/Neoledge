/**
 * @file eval-retrieval.controller.ts — admin-only debug surface for the
 * pgvector retrieval tools. Used exclusively by `scripts/eval-retrieval.mjs`
 * to measure recall@k and MRR against a golden dataset. Not consumed by
 * any user-facing frontend.
 *
 * Why it exists: the semantic tools sit behind the cahier agent loop,
 * which makes them awkward to benchmark in isolation. This endpoint
 * calls the same SQL the tools use, but skips the LLM glue so we can
 * eval retrieval quality without spending API tokens.
 */

import { Body, Controller, Logger, Post, UseGuards } from '@nestjs/common'
import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js'
import { RolesGuard } from '../common/guards/roles.guard.js'
import { Roles } from '../common/decorators/roles.decorator.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EmbeddingsService } from './embeddings/embeddings.service.js'

export class EvalRetrieveDto {
  @IsUUID()
  projectId!: string

  @IsString()
  query!: string

  @IsIn(['segments', 'field-values'])
  target!: 'segments' | 'field-values'

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minSimilarity?: number
}

export class EvalBatchRetrieveDto {
  @IsArray()
  queries!: EvalRetrieveDto[]
}

interface SegmentHit {
  segmentId: string
  meetingId: string
  meetingTitle: string
  speaker: string
  text: string
  similarity: number
}

interface FieldValueHit {
  fieldValueId: string
  fieldLabel: string
  value: string
  similarity: number
}

@Controller('admin/eval/retrieval')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class EvalRetrievalController {
  private readonly logger = new Logger(EvalRetrievalController.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /** Single-query retrieval — used by the script in interactive mode. */
  @Post('query')
  async retrieve(@Body() dto: EvalRetrieveDto): Promise<{
    hits: SegmentHit[] | FieldValueHit[]
    latencyMs: number
    error?: string
  }> {
    return this.runOne(dto)
  }

  /** Batch — the eval script ships N queries per fixture in one round-trip. */
  @Post('batch')
  async batch(@Body() dto: EvalBatchRetrieveDto): Promise<
    Array<{ hits: SegmentHit[] | FieldValueHit[]; latencyMs: number; error?: string }>
  > {
    const results: Array<{ hits: SegmentHit[] | FieldValueHit[]; latencyMs: number; error?: string }> = []
    for (const q of dto.queries) {
      results.push(await this.runOne(q))
    }
    return results
  }

  private async runOne(dto: EvalRetrieveDto): Promise<{
    hits: SegmentHit[] | FieldValueHit[]
    latencyMs: number
    error?: string
  }> {
    const startedAt = Date.now()
    const query = (dto.query ?? '').trim()
    if (query.length < 3) {
      return { hits: [], latencyMs: 0, error: 'query too short' }
    }
    const limit = Math.max(1, Math.min(50, dto.limit ?? 10))

    if (!this.embeddings.isConfigured()) {
      return { hits: [], latencyMs: 0, error: 'embeddings_not_configured' }
    }

    const embed = await this.embeddings.embed([query], 'query', { projectId: dto.projectId })
    if (embed.isFailure || !embed.value || !embed.value[0]) {
      return { hits: [], latencyMs: Date.now() - startedAt, error: embed.error ?? 'embedding_failed' }
    }
    const vec = embed.value[0]
    const literal = `[${vec.join(',')}]`

    try {
      if (dto.target === 'segments') {
        const minSim = typeof dto.minSimilarity === 'number' ? dto.minSimilarity : 0
        const rows = await this.prisma.$queryRawUnsafe<Array<{
          segmentId: string
          meetingId: string
          meetingTitle: string
          speaker: string
          text: string
          similarity: number
        }>>(
          `SELECT s.id AS "segmentId",
                  m.id AS "meetingId",
                  m.title AS "meetingTitle",
                  s.speaker,
                  s.text,
                  1 - (s.embedding <=> $1::vector) AS similarity
             FROM "TranscriptSegments" s
             JOIN "MeetingTranscripts" m ON m.id = s."transcriptId"
            WHERE m."projectId" = $2
              AND s.embedding IS NOT NULL
              AND (1 - (s.embedding <=> $1::vector)) >= $3
         ORDER BY s.embedding <=> $1::vector ASC
            LIMIT $4`,
          literal,
          dto.projectId,
          minSim,
          limit,
        )
        return {
          hits: rows.map((r) => ({
            segmentId: r.segmentId,
            meetingId: r.meetingId,
            meetingTitle: r.meetingTitle,
            speaker: r.speaker,
            text: r.text,
            similarity: Number(r.similarity),
          })),
          latencyMs: Date.now() - startedAt,
        }
      }

      // field-values
      const rows = await this.prisma.$queryRawUnsafe<Array<{
        fieldValueId: string
        fieldLabel: string
        value: string
        similarity: number
      }>>(
        `SELECT pfv.id AS "fieldValueId",
                pf.label AS "fieldLabel",
                pfv.value,
                1 - (pfv.embedding <=> $1::vector) AS similarity
           FROM "ProjectFieldValues" pfv
           JOIN "ProjectFields" pf ON pf.id = pfv."projectFieldId"
          WHERE pfv."projectId" = $2
            AND pfv.embedding IS NOT NULL
            AND pfv.value IS NOT NULL
            AND length(pfv.value) > 0
       ORDER BY pfv.embedding <=> $1::vector ASC
          LIMIT $3`,
        literal,
        dto.projectId,
        limit,
      )
      return {
        hits: rows.map((r) => ({
          fieldValueId: r.fieldValueId,
          fieldLabel: r.fieldLabel,
          value: r.value,
          similarity: Number(r.similarity),
        })),
        latencyMs: Date.now() - startedAt,
      }
    } catch (e) {
      this.logger.warn(`retrieve(${dto.target}) failed: ${e instanceof Error ? e.message : String(e)}`)
      return { hits: [], latencyMs: Date.now() - startedAt, error: 'retrieval_failed' }
    }
  }
}
