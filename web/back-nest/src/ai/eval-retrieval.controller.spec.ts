import { EvalRetrievalController, EvalRetrieveDto, EvalBatchRetrieveDto } from './eval-retrieval.controller.js'

describe('EvalRetrievalController', () => {
  let controller: EvalRetrievalController
  let prisma: { $queryRawUnsafe: jest.Mock }
  let embeddings: { isConfigured: jest.Mock; embed: jest.Mock }

  beforeEach(() => {
    prisma = { $queryRawUnsafe: jest.fn() }
    embeddings = {
      isConfigured: jest.fn().mockReturnValue(true),
      embed: jest.fn().mockResolvedValue({ isSuccess: true, isFailure: false, value: [[1, 0, 0, 0]] }),
    }
    controller = new EvalRetrievalController(prisma as unknown as never, embeddings as unknown as never)
  })

  function buildDto(overrides: Partial<EvalRetrieveDto> = {}): EvalRetrieveDto {
    const dto = new EvalRetrieveDto()
    dto.projectId = 'p1'
    dto.query = 'how does pgvector work'
    dto.target = 'segments'
    return Object.assign(dto, overrides)
  }

  // ─── runOne (via retrieve) ─────────────────────────────────────────────────

  it('returns error and skips embed when query is shorter than 3 chars', async () => {
    const out = await controller.retrieve(buildDto({ query: 'ab' }))
    expect(out.error).toBe('query too short')
    expect(out.hits).toEqual([])
    expect(out.latencyMs).toBe(0)
    expect(embeddings.embed).not.toHaveBeenCalled()
  })

  it('trims whitespace and rejects when the trimmed query is too short', async () => {
    const out = await controller.retrieve(buildDto({ query: '  a  ' }))
    expect(out.error).toBe('query too short')
    expect(embeddings.embed).not.toHaveBeenCalled()
  })

  it('returns embeddings_not_configured when the embeddings service is unconfigured', async () => {
    embeddings.isConfigured.mockReturnValue(false)
    const out = await controller.retrieve(buildDto())
    expect(out.error).toBe('embeddings_not_configured')
    expect(embeddings.embed).not.toHaveBeenCalled()
  })

  it('surfaces the embed error when isFailure is true', async () => {
    embeddings.embed.mockResolvedValue({ isSuccess: false, isFailure: true, value: undefined, error: 'embedding_unavailable' })
    const out = await controller.retrieve(buildDto())
    expect(out.error).toBe('embedding_unavailable')
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('defaults the error to embedding_failed when isFailure with no error message', async () => {
    embeddings.embed.mockResolvedValue({ isSuccess: false, isFailure: true, value: undefined, error: undefined })
    const out = await controller.retrieve(buildDto())
    expect(out.error).toBe('embedding_failed')
  })

  it("returns segment hits via SQL when target='segments'", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { segmentId: 's1', meetingId: 'm1', meetingTitle: 'kickoff', speaker: 'PM', text: 'hello', similarity: '0.9' },
    ])

    const out = await controller.retrieve(buildDto({ target: 'segments' }))

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1)
    const [sql, literal, projectId, minSim, limit] = prisma.$queryRawUnsafe.mock.calls[0]
    expect(sql).toContain('TranscriptSegments')
    expect(literal).toBe('[1,0,0,0]')
    expect(projectId).toBe('p1')
    expect(minSim).toBe(0)
    expect(limit).toBe(10)
    expect(out.hits).toEqual([
      { segmentId: 's1', meetingId: 'm1', meetingTitle: 'kickoff', speaker: 'PM', text: 'hello', similarity: 0.9 },
    ])
    expect(out.error).toBeUndefined()
  })

  it('respects minSimilarity when provided for segments', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([])
    await controller.retrieve(buildDto({ target: 'segments', minSimilarity: 0.5 }))
    const [, , , minSim] = prisma.$queryRawUnsafe.mock.calls[0]
    expect(minSim).toBe(0.5)
  })

  it('clamps limit between 1 and 50', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([])
    await controller.retrieve(buildDto({ limit: 999 }))
    expect(prisma.$queryRawUnsafe.mock.calls[0][4]).toBe(50)
    prisma.$queryRawUnsafe.mockClear()
    await controller.retrieve(buildDto({ limit: 0 }))
    expect(prisma.$queryRawUnsafe.mock.calls[0][4]).toBe(1)
  })

  it("returns field-value hits via different SQL when target='field-values'", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { fieldValueId: 'v1', fieldLabel: 'Stack', value: 'PostgreSQL', similarity: '0.85' },
    ])

    const out = await controller.retrieve(buildDto({ target: 'field-values' }))

    const [sql, , projectId, limit] = prisma.$queryRawUnsafe.mock.calls[0]
    expect(sql).toContain('ProjectFieldValues')
    expect(projectId).toBe('p1')
    expect(limit).toBe(10)
    expect(out.hits).toEqual([
      { fieldValueId: 'v1', fieldLabel: 'Stack', value: 'PostgreSQL', similarity: 0.85 },
    ])
  })

  it('returns retrieval_failed when the SQL throws', async () => {
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('relation does not exist'))
    const out = await controller.retrieve(buildDto())
    expect(out.error).toBe('retrieval_failed')
    expect(out.hits).toEqual([])
  })

  // ─── batch ─────────────────────────────────────────────────────────────────

  it('batch processes each query and preserves order', async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ segmentId: 's1', meetingId: 'm', meetingTitle: 'a', speaker: 'PM', text: 'x', similarity: 0.9 }])
      .mockResolvedValueOnce([{ segmentId: 's2', meetingId: 'm', meetingTitle: 'b', speaker: 'PM', text: 'y', similarity: 0.8 }])

    const batchDto = new EvalBatchRetrieveDto()
    batchDto.queries = [buildDto({ query: 'first  query' }), buildDto({ query: 'second query' })]

    const out = await controller.batch(batchDto)

    expect(out).toHaveLength(2)
    expect((out[0].hits as { segmentId: string }[])[0].segmentId).toBe('s1')
    expect((out[1].hits as { segmentId: string }[])[0].segmentId).toBe('s2')
  })

  it('batch tolerates a per-query failure and continues', async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('boom'))
    const batchDto = new EvalBatchRetrieveDto()
    batchDto.queries = [buildDto({ query: 'q-one' }), buildDto({ query: 'q-two' })]
    const out = await controller.batch(batchDto)
    expect(out[0].error).toBeUndefined()
    expect(out[1].error).toBe('retrieval_failed')
  })
})
