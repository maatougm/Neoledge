/**
 * @file transcript-tools.ts — read-only tools for the transcript agent.
 *
 * Tools take the transcript ID via closure (bound when the agent is
 * constructed) so the model never has to pass it manually — saves
 * tokens and avoids the model inventing a wrong ID.
 *
 * All transcript text passes through `redactPii` before crossing the
 * provider boundary.
 */

import type { ToolDefinition, ToolContext } from '../agent-types.js'
import { obj, str, int } from '../json-schema.js'
import type { PrismaService } from '../../../prisma/prisma.service.js'
import { redactPii } from '../../../common/pii-redact.js'

interface TranscriptMetadata {
  transcriptId: string
  title: string
  recordedAt: string
  durationSeconds: number
  detectedLanguages: string
  segmentCount: number
  speakers: string[]
}

interface TranscriptSegmentDto {
  index: number
  speaker: string
  text: string
  startTime: number
  endTime: number
}

interface OtherMeetingSummary {
  date: string
  aiSummary: string
}

/** Build the set of transcript-bound tools. The transcriptId comes from
 *  the closure so the model can stay focused on intent. */
export function buildTranscriptTools(transcriptId: string): ToolDefinition[] {
  // ── read_transcript_metadata ────────────────────────────────────────────
  const readMetadata: ToolDefinition<Record<string, never>, TranscriptMetadata | { error: string }> = {
    name: 'read_transcript_metadata',
    description: 'Get the meeting title, date, duration, language, and the list of distinct speakers detected. Always start here so the rest of your reasoning has the right context.',
    parameters: obj({}, {}),
    handler: async (_args, ctx: ToolContext) => {
      const prisma = ctx.prisma as PrismaService
      const t = await prisma.meetingTranscript.findUnique({
        where: { id: transcriptId },
        select: {
          id: true, title: true, recordedAt: true,
          durationSeconds: true, detectedLanguages: true,
          _count: { select: { segments: true } },
        },
      })
      if (!t) return { error: 'transcript_not_found' }
      const speakerRows = await prisma.transcriptSegment.groupBy({
        by: ['speaker'],
        where: { transcriptId },
        _count: { _all: true },
      })
      return {
        transcriptId: t.id,
        title: t.title,
        recordedAt: t.recordedAt.toISOString(),
        durationSeconds: t.durationSeconds,
        detectedLanguages: t.detectedLanguages,
        segmentCount: t._count.segments,
        speakers: speakerRows.map((s) => s.speaker),
      }
    },
  }

  // ── read_segments ────────────────────────────────────────────────────────
  const readSegments: ToolDefinition<
    { startIndex?: number; count?: number; speakerFilter?: string; query?: string },
    { segments: TranscriptSegmentDto[]; total: number; redactionTotal: number }
  > = {
    name: 'read_segments',
    description: 'Read a window of transcript segments (default first 80, max 200). Filter by speaker name or by a query term to narrow down. PII (emails / phones / IBAN) is auto-redacted.',
    parameters: obj(
      {
        startIndex: int({ description: 'Zero-based index of the first segment (default 0)', minimum: 0 }),
        count: int({ description: 'Number of segments to return (default 80, max 200)', minimum: 1, maximum: 200 }),
        speakerFilter: str({ description: 'Return only segments where speaker matches (case-insensitive contains).' }),
        query: str({ description: 'Return only segments whose text contains this term (case-insensitive).' }),
      },
      {},
    ),
    handler: async (args, ctx: ToolContext) => {
      const prisma = ctx.prisma as PrismaService
      const startIndex = Math.max(0, Math.floor(args.startIndex ?? 0))
      const count = Math.min(200, Math.max(1, Math.floor(args.count ?? 80)))
      const all = await prisma.transcriptSegment.findMany({
        where: { transcriptId },
        orderBy: { startTime: 'asc' },
      })
      let filtered = all
      if (args.speakerFilter) {
        const f = args.speakerFilter.toLowerCase()
        filtered = filtered.filter((s) => s.speaker.toLowerCase().includes(f))
      }
      if (args.query) {
        const q = args.query.toLowerCase()
        filtered = filtered.filter((s) => s.text.toLowerCase().includes(q))
      }
      const window = filtered.slice(startIndex, startIndex + count)
      let redactionTotal = 0
      const segments: TranscriptSegmentDto[] = window.map((s, i) => {
        const { text: clean, stats } = redactPii(s.text)
        redactionTotal += stats.total
        return {
          index: startIndex + i,
          speaker: s.speaker,
          text: clean,
          startTime: s.startTime,
          endTime: s.endTime,
        }
      })
      return { segments, total: filtered.length, redactionTotal }
    },
  }

  return [readMetadata, readSegments]
}

/**
 * Cross-meeting context. Independent of which transcript is being analyzed,
 * so it stays a free-standing tool with projectId from ctx.
 */
export const readOtherMeetingsTool: ToolDefinition<{ limit?: number; excludeTranscriptId?: string }, { meetings: OtherMeetingSummary[] }> = {
  name: 'read_other_meeting_summaries',
  description: 'List recent OTHER meetings on this project (excluding the one being analyzed) with their AI summaries. Use this to keep extraction consistent with prior meetings (same speakers, recurring topics).',
  parameters: obj(
    {
      limit: int({ description: 'Max meetings to return (default 3, max 5)', minimum: 1, maximum: 5 }),
      excludeTranscriptId: str({ description: 'ID of the transcript currently being analyzed (will be excluded from results).' }),
    },
    {},
  ),
  handler: async (args, ctx: ToolContext) => {
    const prisma = ctx.prisma as PrismaService
    const limit = Math.min(5, Math.max(1, args.limit ?? 3))
    const transcripts = await prisma.meetingTranscript.findMany({
      where: {
        projectId: ctx.projectId,
        aiStatus: 'completed',
        aiSummary: { not: null },
        ...(args.excludeTranscriptId ? { id: { not: args.excludeTranscriptId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { createdAt: true, aiSummary: true },
    })
    return {
      meetings: transcripts.map((t) => ({
        date: t.createdAt.toISOString().slice(0, 10),
        aiSummary: (t.aiSummary ?? '').slice(0, 3000),
      })),
    }
  },
}
