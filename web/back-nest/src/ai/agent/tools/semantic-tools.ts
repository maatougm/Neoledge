/**
 * @file semantic-tools.ts — pgvector-backed retrieval tools for the cahier
 * (and any future) agent. Two tools:
 *
 *   - read_relevant_meeting_excerpts(query, limit, minSimilarity)
 *   - read_relevant_questionnaire(query, limit)
 *
 * Both run a cosine-similarity nearest-neighbour search against the HNSW
 * indexes added in migration 20260517120100_pgvector_columns_and_indexes,
 * filtered by `projectId` (multi-tenancy invariant — every SQL filter
 * includes `WHERE m."projectId" = $X` or equivalent).
 *
 * Builder pattern (not bare exports) because each tool needs the
 * EmbeddingsService injected at handler-call time. The cahier agent calls
 * `buildSemanticTools(embeddings)` once and slots the returned tools into
 * its tool list, behind the `CAHIER_USE_SEMANTIC_RETRIEVAL` env flag.
 *
 * Graceful degradation:
 *   - If the embedding service is down → caller is told (`embedding_unavailable`)
 *     and the agent loop falls through to the keyword tools that still exist.
 *   - If the project has no segments/values indexed yet (backfill in flight)
 *     → both tools return an empty `hits` array. The caller is then expected
 *     to call the keyword tools as a fallback.
 */

import type { Logger } from '@nestjs/common'
import type { ToolDefinition, ToolContext } from '../agent-types.js'
import type { EmbeddingsService, EmbeddingInputType } from '../../embeddings/embeddings.service.js'
import { obj, str, num, int } from '../json-schema.js'

interface MeetingExcerptHit {
  segmentId: string
  meetingId: string
  meetingTitle: string
  meetingDate: string
  speaker: string
  text: string
  startTime: number
  endTime: number
  similarity: number
}

interface QuestionnaireHit {
  fieldLabel: string
  fieldType: string
  isRequired: boolean
  isBacklogDriver: boolean
  backlogHint: string | null
  value: string
  similarity: number
}

/** Builds the two semantic-retrieval tools bound to a single embeddings
 *  client. Returns an empty array when `embeddings` reports it isn't
 *  configured — keeps the cahier agent's tool list valid even on dev
 *  boxes where the transcription service isn't running.
 */
export function buildSemanticTools(
  embeddings: EmbeddingsService,
  logger: Logger,
): ToolDefinition[] {
  if (!embeddings.isConfigured()) {
    logger.warn('Semantic tools requested but embeddings service not configured — returning empty tool set')
    return []
  }

  // Shared helper: embed a single query as type='query' and return the
  // serialised vector literal for pgvector. e5 models require asymmetric
  // prefixes; mixing 'query' and 'passage' degrades cosine similarity.
  const embedQuery = async (
    query: string,
    ctx: ToolContext,
  ): Promise<{ vec: number[]; literal: string } | { error: string }> => {
    const r = await embeddings.embed([query], 'query' satisfies EmbeddingInputType, { projectId: ctx.projectId })
    if (r.isFailure || !r.value) return { error: r.error ?? 'embedding_failed' }
    const vec = r.value[0]
    if (!vec || vec.length === 0) return { error: 'empty_embedding' }
    // pgvector accepts the JSON array form `[1.0, 2.0, ...]` cast to ::vector.
    return { vec, literal: `[${vec.join(',')}]` }
  }

  // ── read_relevant_meeting_excerpts ──────────────────────────────────────
  const readRelevantMeetingExcerpts: ToolDefinition<
    { query: string; limit?: number; minSimilarity?: number },
    { hits: MeetingExcerptHit[]; truncated: boolean } | { error: string }
  > = {
    name: 'read_relevant_meeting_excerpts',
    description:
      "Semantic search across this project's meeting transcripts. Returns the top-K transcript segments most similar to your query. Faster, more relevant, and works on paraphrases — prefer this over read_meeting_segments for finding a fact mentioned in a meeting.",
    parameters: obj(
      {
        query: str({
          description: "Natural-language question or topic. Examples: 'délais de livraison', 'intégration GED Elise', 'contraintes RGPD'.",
        }),
        limit: int({ description: 'Max hits (default 8, max 20)', minimum: 1, maximum: 20 }),
        minSimilarity: num({
          description: 'Optional cosine similarity floor 0–1 (default 0.35). Hits below this are dropped.',
        }),
      },
      { required: ['query'] },
    ),
    handler: async (args, ctx) => {
      const query = (args.query ?? '').trim()
      if (query.length < 3) return { error: 'query too short (min 3 chars)' }
      const limit = Math.max(1, Math.min(20, args.limit ?? 8))
      const minSim = typeof args.minSimilarity === 'number'
        ? Math.max(0, Math.min(1, args.minSimilarity))
        : 0.35

      const embedded = await embedQuery(query, ctx)
      if ('error' in embedded) return { error: embedded.error }

      try {
        const rows = await ctx.prisma.$queryRawUnsafe<Array<{
          segmentId: string
          meetingId: string
          meetingTitle: string
          createdAt: Date
          speaker: string
          text: string
          startTime: number
          endTime: number
          similarity: number
        }>>(
          // The `1 - (embedding <=> $1)` expression converts cosine distance
          // (0..2) into similarity (0..1) for normalised vectors.
          // ORDER BY uses the raw distance so HNSW can serve it cheaply.
          `SELECT s.id AS "segmentId",
                  m.id AS "meetingId",
                  m.title AS "meetingTitle",
                  m."createdAt" AS "createdAt",
                  s.speaker,
                  s.text,
                  s."startTime",
                  s."endTime",
                  1 - (s.embedding <=> $1::vector) AS similarity
             FROM "TranscriptSegments" s
             JOIN "MeetingTranscripts" m ON m.id = s."transcriptId"
            WHERE m."projectId" = $2
              AND s.embedding IS NOT NULL
              AND (1 - (s.embedding <=> $1::vector)) >= $3
         ORDER BY s.embedding <=> $1::vector ASC
            LIMIT $4`,
          embedded.literal,
          ctx.projectId,
          minSim,
          limit,
        )

        const hits: MeetingExcerptHit[] = rows.map((r) => ({
          segmentId: r.segmentId,
          meetingId: r.meetingId,
          meetingTitle: r.meetingTitle,
          meetingDate: new Date(r.createdAt).toISOString().slice(0, 10),
          speaker: r.speaker,
          text: r.text,
          startTime: Number(r.startTime),
          endTime: Number(r.endTime),
          similarity: Number(r.similarity),
        }))
        return { hits, truncated: hits.length >= limit }
      } catch (e) {
        ctx.logger.warn(`read_relevant_meeting_excerpts failed: ${e instanceof Error ? e.message : String(e)}`)
        return { error: 'retrieval_failed' }
      }
    },
  }

  // ── read_relevant_questionnaire ─────────────────────────────────────────
  const readRelevantQuestionnaire: ToolDefinition<
    { query: string; limit?: number },
    { hits: QuestionnaireHit[]; truncated: boolean } | { error: string }
  > = {
    name: 'read_relevant_questionnaire',
    description:
      "Semantic search across this project's filled questionnaire answers. Returns top-K fields whose label+value best match the query. Use this when you need a specific answer and don't want to dump the whole questionnaire.",
    parameters: obj(
      {
        query: str({ description: "What you're looking for. Examples: 'budget cible', 'équipe technique côté client', 'volume documentaire estimé'." }),
        limit: int({ description: 'Max hits (default 6, max 15)', minimum: 1, maximum: 15 }),
      },
      { required: ['query'] },
    ),
    handler: async (args, ctx) => {
      const query = (args.query ?? '').trim()
      if (query.length < 3) return { error: 'query too short (min 3 chars)' }
      const limit = Math.max(1, Math.min(15, args.limit ?? 6))

      const embedded = await embedQuery(query, ctx)
      if ('error' in embedded) return { error: embedded.error }

      try {
        const rows = await ctx.prisma.$queryRawUnsafe<Array<{
          fieldLabel: string
          fieldType: string
          isRequired: boolean
          isBacklogDriver: boolean
          backlogHint: string | null
          value: string
          similarity: number
        }>>(
          `SELECT pf.label AS "fieldLabel",
                  pf."fieldType" AS "fieldType",
                  pf."isRequired" AS "isRequired",
                  pf."isBacklogDriver" AS "isBacklogDriver",
                  pf."backlogHint" AS "backlogHint",
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
          embedded.literal,
          ctx.projectId,
          limit,
        )
        const hits: QuestionnaireHit[] = rows.map((r) => ({
          fieldLabel: r.fieldLabel,
          fieldType: r.fieldType,
          isRequired: Boolean(r.isRequired),
          isBacklogDriver: Boolean(r.isBacklogDriver),
          backlogHint: r.backlogHint ?? null,
          value: r.value,
          similarity: Number(r.similarity),
        }))
        return { hits, truncated: hits.length >= limit }
      } catch (e) {
        ctx.logger.warn(`read_relevant_questionnaire failed: ${e instanceof Error ? e.message : String(e)}`)
        return { error: 'retrieval_failed' }
      }
    },
  }

  return [readRelevantMeetingExcerpts, readRelevantQuestionnaire]
}
