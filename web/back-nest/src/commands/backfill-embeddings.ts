/**
 * @file backfill-embeddings.ts — populates pgvector embedding columns
 * added in migration 20260517120100_pgvector_columns_and_indexes.
 *
 * Run via:
 *   docker exec -it neoleadge_server node dist/src/commands/backfill-embeddings.js \
 *     [--table=segments|field-values|summaries|all] \
 *     [--batch-size=64] \
 *     [--max-rows=10000] \
 *     [--project-id=<uuid>] \
 *     [--dry-run]
 *
 * Properties:
 *   - Idempotent. The cursor IS `WHERE embedding IS NULL` — a re-run picks
 *     up any rows added since the last invocation (and any that failed).
 *   - Batched + rate-limited. 100ms sleep between batches keeps the FastAPI
 *     embedding service from saturating.
 *   - Per-table targeting. Default --table=all walks all three populated
 *     tables in order: segments, field-values, summaries.
 *   - Per-project scoping for staged rollout (--project-id=<uuid>).
 *   - Dry-run prints counts of what would be embedded and exits 0.
 */

import { NestFactory } from '@nestjs/core'
import { Logger } from '@nestjs/common'
import { AppModule } from '../app.module.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EmbeddingsService } from '../ai/embeddings/embeddings.service.js'

interface CliOptions {
  table: 'segments' | 'field-values' | 'summaries' | 'all'
  batchSize: number
  maxRows: number
  projectId: string | null
  dryRun: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    table: 'all',
    batchSize: 64,
    maxRows: 10_000,
    projectId: null,
    dryRun: false,
  }
  for (const arg of argv) {
    if (arg.startsWith('--table=')) {
      const val = arg.slice('--table='.length)
      if (!['segments', 'field-values', 'summaries', 'all'].includes(val)) {
        throw new Error(`--table must be one of segments|field-values|summaries|all (got "${val}")`)
      }
      opts.table = val as CliOptions['table']
    } else if (arg.startsWith('--batch-size=')) {
      const n = Number(arg.slice('--batch-size='.length))
      if (!Number.isFinite(n) || n < 1 || n > 64) throw new Error('--batch-size must be 1..64')
      opts.batchSize = n
    } else if (arg.startsWith('--max-rows=')) {
      const n = Number(arg.slice('--max-rows='.length))
      if (!Number.isFinite(n) || n < 1) throw new Error('--max-rows must be > 0')
      opts.maxRows = n
    } else if (arg.startsWith('--project-id=')) {
      opts.projectId = arg.slice('--project-id='.length)
    } else if (arg === '--dry-run') {
      opts.dryRun = true
    } else if (arg === '--help' || arg === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        'Usage: backfill-embeddings [--table=segments|field-values|summaries|all] ' +
          '[--batch-size=64] [--max-rows=10000] [--project-id=<uuid>] [--dry-run]',
      )
      process.exit(0)
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return opts
}

interface BatchResult {
  embedded: number
  failed: number
  remaining: number
}

async function backfillSegments(
  prisma: PrismaService,
  embeddings: EmbeddingsService,
  logger: Logger,
  opts: CliOptions,
): Promise<BatchResult> {
  const projectFilter = opts.projectId
    ? `AND m."projectId" = '${opts.projectId.replace(/'/g, "''")}'`
    : ''

  let totalEmbedded = 0
  let totalFailed = 0
  // Resume cursor is the WHERE clause itself — a failed row stays NULL and
  // gets re-picked on the next batch.
  while (totalEmbedded + totalFailed < opts.maxRows) {
    // Select the next batch of segments that still have NULL embeddings.
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; text: string }>>(
      `SELECT s.id, s.text
         FROM "TranscriptSegments" s
         JOIN "MeetingTranscripts" m ON m.id = s."transcriptId"
        WHERE s.embedding IS NULL
          AND s.text IS NOT NULL
          AND length(s.text) > 0
          ${projectFilter}
        LIMIT ${opts.batchSize}`,
    )
    if (rows.length === 0) break

    if (opts.dryRun) {
      totalEmbedded += rows.length
      if (totalEmbedded % 500 === 0 || totalEmbedded === rows.length) {
        logger.log(`[dry-run] would embed ${totalEmbedded} segments so far`)
      }
      continue
    }

    const result = await embeddings.embed(
      rows.map((r) => r.text),
      'passage',
      { projectId: opts.projectId },
    )
    if (result.isFailure || !result.value) {
      logger.warn(`segments batch failed: ${result.error ?? 'unknown'} — sleeping 5s and retrying`)
      totalFailed += rows.length
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }

    // Persist each vector. One UPDATE per row — pgvector doesn't yet support
    // multi-row UPDATE syntax cleanly for vector(N) columns across drivers.
    // At ~100 rows/s this stays well below the index's insertion cost.
    for (let i = 0; i < rows.length; i++) {
      const vec = result.value[i]
      if (!vec) {
        totalFailed += 1
        continue
      }
      const literal = `[${vec.join(',')}]`
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "TranscriptSegments" SET embedding = $1::vector WHERE id = $2`,
          literal,
          rows[i].id,
        )
        totalEmbedded += 1
      } catch (e) {
        totalFailed += 1
        logger.warn(`segment ${rows[i].id} UPDATE failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (totalEmbedded % 500 < opts.batchSize) {
      logger.log(`[segments] embedded ${totalEmbedded}, failed ${totalFailed}`)
    }
    // Rate limit: 100ms gap between batches.
    await new Promise((r) => setTimeout(r, 100))
  }

  // Final remaining count to log.
  const remaining = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "TranscriptSegments" s
      JOIN "MeetingTranscripts" m ON m.id = s."transcriptId"
     WHERE s.embedding IS NULL ${projectFilter}`,
  )
  return { embedded: totalEmbedded, failed: totalFailed, remaining: Number(remaining[0]?.count ?? 0) }
}

async function backfillFieldValues(
  prisma: PrismaService,
  embeddings: EmbeddingsService,
  logger: Logger,
  opts: CliOptions,
): Promise<BatchResult> {
  const projectFilter = opts.projectId
    ? `AND pfv."projectId" = '${opts.projectId.replace(/'/g, "''")}'`
    : ''

  let totalEmbedded = 0
  let totalFailed = 0
  while (totalEmbedded + totalFailed < opts.maxRows) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; label: string; value: string }>>(
      `SELECT pfv.id, pf.label, pfv.value
         FROM "ProjectFieldValues" pfv
         JOIN "ProjectFields" pf ON pf.id = pfv."projectFieldId"
        WHERE pfv.embedding IS NULL
          AND pfv.value IS NOT NULL
          AND length(pfv.value) > 0
          ${projectFilter}
        LIMIT ${opts.batchSize}`,
    )
    if (rows.length === 0) break

    // The embedded text is `"label: value"` — gives the embedding semantic
    // grounding when the answer is short (e.g. "oui" alone is meaningless).
    const texts = rows.map((r) => `${r.label}: ${r.value}`)

    if (opts.dryRun) {
      totalEmbedded += rows.length
      continue
    }

    const result = await embeddings.embed(texts, 'passage', { projectId: opts.projectId })
    if (result.isFailure || !result.value) {
      totalFailed += rows.length
      logger.warn(`field-values batch failed: ${result.error ?? 'unknown'} — sleeping 5s`)
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }
    for (let i = 0; i < rows.length; i++) {
      const vec = result.value[i]
      if (!vec) { totalFailed++; continue }
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "ProjectFieldValues" SET embedding = $1::vector WHERE id = $2`,
          `[${vec.join(',')}]`,
          rows[i].id,
        )
        totalEmbedded += 1
      } catch (e) {
        totalFailed += 1
        logger.warn(`field-value ${rows[i].id} UPDATE failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (totalEmbedded % 500 < opts.batchSize) {
      logger.log(`[field-values] embedded ${totalEmbedded}, failed ${totalFailed}`)
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  const remaining = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "ProjectFieldValues" pfv
     WHERE pfv.embedding IS NULL AND pfv.value IS NOT NULL AND length(pfv.value) > 0 ${projectFilter}`,
  )
  return { embedded: totalEmbedded, failed: totalFailed, remaining: Number(remaining[0]?.count ?? 0) }
}

async function backfillSummaries(
  prisma: PrismaService,
  embeddings: EmbeddingsService,
  logger: Logger,
  opts: CliOptions,
): Promise<BatchResult> {
  const projectFilter = opts.projectId
    ? `AND m."projectId" = '${opts.projectId.replace(/'/g, "''")}'`
    : ''

  let totalEmbedded = 0
  let totalFailed = 0
  while (totalEmbedded + totalFailed < opts.maxRows) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; aiSummary: string }>>(
      `SELECT m.id, m."aiSummary"
         FROM "MeetingTranscripts" m
        WHERE m."summaryEmbedding" IS NULL
          AND m."aiSummary" IS NOT NULL
          AND length(m."aiSummary") > 0
          ${projectFilter}
        LIMIT ${opts.batchSize}`,
    )
    if (rows.length === 0) break

    if (opts.dryRun) { totalEmbedded += rows.length; continue }

    const result = await embeddings.embed(
      rows.map((r) => r.aiSummary),
      'passage',
      { projectId: opts.projectId },
    )
    if (result.isFailure || !result.value) {
      totalFailed += rows.length
      logger.warn(`summaries batch failed: ${result.error ?? 'unknown'} — sleeping 5s`)
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }
    for (let i = 0; i < rows.length; i++) {
      const vec = result.value[i]
      if (!vec) { totalFailed++; continue }
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "MeetingTranscripts" SET "summaryEmbedding" = $1::vector WHERE id = $2`,
          `[${vec.join(',')}]`,
          rows[i].id,
        )
        totalEmbedded += 1
      } catch (e) {
        totalFailed += 1
        logger.warn(`summary ${rows[i].id} UPDATE failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (totalEmbedded % 500 < opts.batchSize) {
      logger.log(`[summaries] embedded ${totalEmbedded}, failed ${totalFailed}`)
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  const remaining = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "MeetingTranscripts" m
     WHERE m."summaryEmbedding" IS NULL AND m."aiSummary" IS NOT NULL AND length(m."aiSummary") > 0 ${projectFilter}`,
  )
  return { embedded: totalEmbedded, failed: totalFailed, remaining: Number(remaining[0]?.count ?? 0) }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  // Use a NestJS application context (no HTTP server) so Prisma + EmbeddingsService
  // are wired exactly as in prod. AppModule re-uses ConfigModule, PrismaModule, AiModule.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] })
  const logger = new Logger('backfill-embeddings')
  const prisma = app.get(PrismaService)
  const embeddings = app.get(EmbeddingsService)

  logger.log(
    `backfill-embeddings starting — table=${opts.table} batch=${opts.batchSize} max=${opts.maxRows} ` +
      `project=${opts.projectId ?? 'all'} dry-run=${opts.dryRun}`,
  )

  const summary: Record<string, BatchResult> = {}
  try {
    if (opts.table === 'segments' || opts.table === 'all') {
      summary.segments = await backfillSegments(prisma, embeddings, logger, opts)
    }
    if (opts.table === 'field-values' || opts.table === 'all') {
      summary.fieldValues = await backfillFieldValues(prisma, embeddings, logger, opts)
    }
    if (opts.table === 'summaries' || opts.table === 'all') {
      summary.summaries = await backfillSummaries(prisma, embeddings, logger, opts)
    }
  } finally {
    await app.close()
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, dryRun: opts.dryRun, summary }, null, 2))
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('backfill failed:', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
