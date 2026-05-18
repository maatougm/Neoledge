import { Logger } from '@nestjs/common'
import { buildSemanticTools } from './semantic-tools.js'
import { Result } from '../../../common/result.js'
import type { EmbeddingsService } from '../../embeddings/embeddings.service.js'
import type { ToolContext, ToolDefinition } from '../agent-types.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

function mkEmbeddings(opts: {
  configured?: boolean
  vector?: number[] | null
  failure?: string
} = {}): EmbeddingsService {
  const configured = opts.configured ?? true
  const stub = {
    isConfigured: jest.fn().mockReturnValue(configured),
    embed: jest.fn(async () => {
      if (opts.failure) return Result.fail<number[][]>(opts.failure)
      if (opts.vector === null) return Result.ok<number[][]>([[]])
      const vec = opts.vector ?? [0.1, 0.2, 0.3, 0.4]
      return Result.ok<number[][]>([vec])
    }),
  }
  return stub as unknown as EmbeddingsService
}

function mkCtx(rowsForQuery: unknown[] | (() => unknown[]) | Error = []): ToolContext {
  const queryRawUnsafe = jest.fn(async () => {
    if (rowsForQuery instanceof Error) throw rowsForQuery
    return typeof rowsForQuery === 'function' ? rowsForQuery() : rowsForQuery
  })
  return {
    projectId: 'p-1',
    logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() } as unknown as Logger,
    prisma: { $queryRawUnsafe: queryRawUnsafe } as never,
    maxResultChars: 8000,
  }
}

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const found = tools.find((t) => t.name === name)
  if (!found) throw new Error(`tool ${name} not found`)
  return found
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('buildSemanticTools', () => {
  let logger: Logger

  beforeEach(() => {
    logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() } as unknown as Logger
  })

  describe('factory gating', () => {
    it('returns an empty array AND logs a warning when embeddings.isConfigured() is false', () => {
      const embeddings = mkEmbeddings({ configured: false })
      const tools = buildSemanticTools(embeddings, logger)
      expect(tools).toEqual([])
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/Semantic tools requested/))
    })

    it('returns exactly 2 tools when embeddings are configured', () => {
      const tools = buildSemanticTools(mkEmbeddings(), logger)
      expect(tools.map((t) => t.name).sort()).toEqual(
        ['read_relevant_meeting_excerpts', 'read_relevant_questionnaire'],
      )
    })
  })

  describe('read_relevant_meeting_excerpts', () => {
    function getTool(embeddings = mkEmbeddings()): ToolDefinition<
      { query: string; limit?: number; minSimilarity?: number },
      unknown
    > {
      return findTool(buildSemanticTools(embeddings, logger), 'read_relevant_meeting_excerpts') as ToolDefinition<
        { query: string; limit?: number; minSimilarity?: number },
        unknown
      >
    }

    it('rejects a query shorter than 3 characters', async () => {
      const tool = getTool()
      const out = await tool.handler({ query: 'hi' }, mkCtx())
      expect(out).toEqual({ error: 'query too short (min 3 chars)' })
    })

    it('rejects an empty/whitespace-only query', async () => {
      const tool = getTool()
      const out = await tool.handler({ query: '   ' }, mkCtx())
      expect(out).toEqual({ error: 'query too short (min 3 chars)' })
    })

    it('returns the embed-failure reason when the embedding service fails', async () => {
      const tool = getTool(mkEmbeddings({ failure: 'embedding_unavailable' }))
      const out = await tool.handler({ query: 'délais de livraison' }, mkCtx())
      expect(out).toEqual({ error: 'embedding_unavailable' })
    })

    it('returns empty_embedding when the model returns a zero-length vector', async () => {
      const tool = getTool(mkEmbeddings({ vector: null }))
      const out = await tool.handler({ query: 'budget' }, mkCtx())
      expect(out).toEqual({ error: 'empty_embedding' })
    })

    it('maps raw SQL rows to MeetingExcerptHit shape on success', async () => {
      const fixedDate = new Date('2026-03-15T10:30:00.000Z')
      const rows = [
        {
          segmentId: 's1', meetingId: 'm1', meetingTitle: 'Kickoff',
          createdAt: fixedDate, speaker: 'PM', text: 'Décision SwissSign',
          startTime: 12, endTime: 18, similarity: 0.87,
        },
      ]
      const tool = getTool()
      const out = (await tool.handler(
        { query: 'signature électronique' },
        mkCtx(rows),
      )) as { hits: Array<Record<string, unknown>>; truncated: boolean }

      expect(out.hits).toEqual([
        {
          segmentId: 's1',
          meetingId: 'm1',
          meetingTitle: 'Kickoff',
          meetingDate: '2026-03-15',
          speaker: 'PM',
          text: 'Décision SwissSign',
          startTime: 12,
          endTime: 18,
          similarity: 0.87,
        },
      ])
      expect(out.truncated).toBe(false)
    })

    it('passes the right SQL parameters (literal vector, projectId, minSim, limit)', async () => {
      const ctx = mkCtx([])
      const tool = getTool()
      await tool.handler(
        { query: 'budget cible', limit: 5, minSimilarity: 0.5 },
        ctx,
      )
      const call = (ctx.prisma.$queryRawUnsafe as jest.Mock).mock.calls[0]
      const [sql, literal, projectId, minSim, limit] = call as [string, string, string, number, number]
      expect(sql).toContain('WHERE m."projectId" = $2')
      expect(literal).toBe('[0.1,0.2,0.3,0.4]')
      expect(projectId).toBe('p-1')
      expect(minSim).toBe(0.5)
      expect(limit).toBe(5)
    })

    it('clamps limit to [1, 20] and applies a default of 8', async () => {
      const ctx1 = mkCtx([])
      await getTool().handler({ query: 'foo' }, ctx1)
      expect((ctx1.prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][4]).toBe(8)

      const ctx2 = mkCtx([])
      await getTool().handler({ query: 'foo', limit: 999 }, ctx2)
      expect((ctx2.prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][4]).toBe(20)

      const ctx3 = mkCtx([])
      await getTool().handler({ query: 'foo', limit: -5 }, ctx3)
      expect((ctx3.prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][4]).toBe(1)
    })

    it('clamps minSimilarity to [0, 1] and applies a default of 0.35', async () => {
      const ctx1 = mkCtx([])
      await getTool().handler({ query: 'foo' }, ctx1)
      expect((ctx1.prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][3]).toBe(0.35)

      const ctx2 = mkCtx([])
      await getTool().handler({ query: 'foo', minSimilarity: 2 }, ctx2)
      expect((ctx2.prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][3]).toBe(1)

      const ctx3 = mkCtx([])
      await getTool().handler({ query: 'foo', minSimilarity: -1 }, ctx3)
      expect((ctx3.prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][3]).toBe(0)
    })

    it('marks truncated=true when hit count reaches the limit', async () => {
      const limit = 2
      const rows = [
        { segmentId: 's1', meetingId: 'm1', meetingTitle: 'M', createdAt: new Date('2026-01-01'), speaker: 'A', text: 'x', startTime: 0, endTime: 1, similarity: 0.9 },
        { segmentId: 's2', meetingId: 'm1', meetingTitle: 'M', createdAt: new Date('2026-01-01'), speaker: 'A', text: 'y', startTime: 1, endTime: 2, similarity: 0.8 },
      ]
      const out = (await getTool().handler({ query: 'foo', limit }, mkCtx(rows))) as { truncated: boolean }
      expect(out.truncated).toBe(true)
    })

    it('returns { error: "retrieval_failed" } when the SQL throws', async () => {
      const ctx = mkCtx(new Error('DB exploded'))
      const out = await getTool().handler({ query: 'something' }, ctx)
      expect(out).toEqual({ error: 'retrieval_failed' })
      expect(ctx.logger.warn).toHaveBeenCalled()
    })
  })

  describe('read_relevant_questionnaire', () => {
    function getTool(embeddings = mkEmbeddings()): ToolDefinition<
      { query: string; limit?: number },
      unknown
    > {
      return findTool(buildSemanticTools(embeddings, logger), 'read_relevant_questionnaire') as ToolDefinition<
        { query: string; limit?: number },
        unknown
      >
    }

    it('rejects a too-short query', async () => {
      const tool = getTool()
      const out = await tool.handler({ query: 'a' }, mkCtx())
      expect(out).toEqual({ error: 'query too short (min 3 chars)' })
    })

    it('returns the embed-failure reason when the embedding service fails', async () => {
      const tool = getTool(mkEmbeddings({ failure: 'embedding_timeout' }))
      const out = await tool.handler({ query: 'volumétrie' }, mkCtx())
      expect(out).toEqual({ error: 'embedding_timeout' })
    })

    it('maps raw SQL rows to QuestionnaireHit shape, coercing isRequired/isBacklogDriver to boolean', async () => {
      const rows = [
        {
          fieldLabel: 'Volume',
          fieldType: 'Number',
          isRequired: 1, // sometimes Prisma returns 1/0 for booleans on raw queries
          isBacklogDriver: 0,
          backlogHint: null,
          value: '8M documents',
          similarity: 0.91,
        },
      ]
      const tool = getTool()
      const out = (await tool.handler(
        { query: 'volume documentaire' },
        mkCtx(rows),
      )) as { hits: Array<Record<string, unknown>>; truncated: boolean }

      expect(out.hits).toEqual([
        {
          fieldLabel: 'Volume',
          fieldType: 'Number',
          isRequired: true,
          isBacklogDriver: false,
          backlogHint: null,
          value: '8M documents',
          similarity: 0.91,
        },
      ])
    })

    it('clamps limit to [1, 15] and applies a default of 6', async () => {
      const ctx1 = mkCtx([])
      await getTool().handler({ query: 'foo' }, ctx1)
      expect((ctx1.prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][3]).toBe(6)

      const ctx2 = mkCtx([])
      await getTool().handler({ query: 'foo', limit: 50 }, ctx2)
      expect((ctx2.prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][3]).toBe(15)

      const ctx3 = mkCtx([])
      await getTool().handler({ query: 'foo', limit: 0 }, ctx3)
      expect((ctx3.prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][3]).toBe(1)
    })

    it('preserves nullable backlogHint', async () => {
      const rows = [{
        fieldLabel: 'L', fieldType: 'Text', isRequired: false, isBacklogDriver: true,
        backlogHint: undefined, value: 'v', similarity: 0.5,
      }]
      const out = (await getTool().handler({ query: 'foo' }, mkCtx(rows))) as { hits: Array<{ backlogHint: unknown }> }
      expect(out.hits[0].backlogHint).toBeNull()
    })

    it('returns { error: "retrieval_failed" } when the SQL throws', async () => {
      const ctx = mkCtx(new Error('connection refused'))
      const out = await getTool().handler({ query: 'budget' }, ctx)
      expect(out).toEqual({ error: 'retrieval_failed' })
      expect(ctx.logger.warn).toHaveBeenCalled()
    })

    it('multi-tenancy: passes ctx.projectId as $2 of the SQL', async () => {
      const ctx = mkCtx([])
      const customCtx = { ...ctx, projectId: 'project-xyz' }
      await getTool().handler({ query: 'team' }, customCtx)
      const call = (customCtx.prisma.$queryRawUnsafe as jest.Mock).mock.calls[0]
      expect(call[2]).toBe('project-xyz')
    })

    it('truncated=true when hit count reaches the limit', async () => {
      const rows = [
        { fieldLabel: 'A', fieldType: 'Text', isRequired: true, isBacklogDriver: false, backlogHint: null, value: 'x', similarity: 0.8 },
        { fieldLabel: 'B', fieldType: 'Text', isRequired: false, isBacklogDriver: false, backlogHint: null, value: 'y', similarity: 0.7 },
      ]
      const out = (await getTool().handler({ query: 'foo', limit: 2 }, mkCtx(rows))) as { truncated: boolean }
      expect(out.truncated).toBe(true)
    })
  })
})
