/**
 * @file cahier-tools.ts — read tools dedicated to cahier des charges
 * generation. Cahier needs:
 *   - Full questionnaire (not just driver fields).
 *   - Meeting summaries (lighter than raw segments).
 *   - Specific transcript segments when a topic isn't well-summarized.
 *   - Past CahierFeedback so the agent addresses prior rejections.
 *   - The previously saved cahier (so the agent doesn't regress
 *     manual edits the spec team baked into it).
 *
 * The full questionnaire and meeting tools are reused from
 * project-tools.ts; only `read_meeting_segments` (cross-meeting
 * search) is cahier-specific.
 */

import type { ToolDefinition, ToolContext } from '../agent-types.js'
import { obj, str, int } from '../json-schema.js'
import type { PrismaService } from '../../../prisma/prisma.service.js'
import { redactPii } from '../../../common/pii-redact.js'

interface MeetingSegmentDto {
  meetingId: string
  meetingTitle: string
  date: string
  speaker: string
  text: string
}

/**
 * Search ALL meetings on the project for segments whose text contains
 * the query term (case-insensitive). Useful for finding a specific
 * requirement, deadline, or decision that the per-meeting summary
 * didn't capture.
 */
export const readMeetingSegmentsTool: ToolDefinition<
  { query: string; limit?: number },
  { segments: MeetingSegmentDto[]; truncated: boolean }
> = {
  name: 'read_meeting_segments',
  description: 'Search across all meetings on this project for transcript segments matching a query term. Returns up to 30 hits with speaker / meeting context. Use this when the per-meeting summary is missing a specific detail (e.g. exact deadline, named technology, contractual figure).',
  parameters: obj(
    {
      query: str({ description: 'Term to search for (case-insensitive). Examples: "RGPD", "API REST", "livraison", "février".' }),
      limit: int({ description: 'Max segments to return (default 20, max 30)', minimum: 1, maximum: 30 }),
    },
    { required: ['query'] },
  ),
  handler: async (args, ctx: ToolContext) => {
    const prisma = ctx.prisma as PrismaService
    const limit = Math.min(30, Math.max(1, args.limit ?? 20))
    const q = args.query.toLowerCase()
    if (q.length < 2) return { segments: [], truncated: false }

    // Pull recent meetings with segments. We bound the search to keep cost
    // predictable — the latest 8 meetings (most likely to contain fresh
    // requirements) is a reasonable default.
    const meetings = await prisma.meetingTranscript.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { segments: { orderBy: { startTime: 'asc' } } },
    })

    const hits: MeetingSegmentDto[] = []
    for (const m of meetings) {
      for (const s of m.segments) {
        if (!s.text.toLowerCase().includes(q)) continue
        const { text: clean } = redactPii(s.text)
        hits.push({
          meetingId: m.id,
          meetingTitle: m.title,
          date: m.createdAt.toISOString().slice(0, 10),
          speaker: s.speaker,
          text: clean,
        })
        if (hits.length >= limit) break
      }
      if (hits.length >= limit) break
    }
    return { segments: hits, truncated: hits.length >= limit }
  },
}
