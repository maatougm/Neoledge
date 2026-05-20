jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn(),
}))

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import * as fs from 'fs'
import { MeetingsService } from './meetings.service'
import { PrismaService } from '../prisma/prisma.service'
import { AiService } from '../ai/ai.service'
import { AssemblyAiProvider } from './assemblyai.provider'
import { EmbeddingIndexerService } from '../ai/embeddings/embedding-indexer.service'

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

type Tx = {
  workPackage: { create: jest.Mock }
  meetingActionItem: { update: jest.Mock }
}

const mockPrisma = {
  meetingTranscript: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  transcriptSegment: {
    createMany: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  meetingActionItem: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  sprint: {
    findFirst: jest.fn(),
  },
  projectMember: {
    findMany: jest.fn(),
  },
  workPackage: {
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  // $transaction supports two call shapes: an array of pre-built ops, and
  // a callback receiving an interactive tx client. The mock handles both.
  $transaction: jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      const tx: Tx = {
        workPackage: { create: jest.fn().mockResolvedValue({ id: 'wp-new' }) },
        meetingActionItem: { update: jest.fn().mockResolvedValue({ id: 'a-1' }) },
      }
      // store on the mock so tests can introspect
      ;(mockPrisma.$transaction as unknown as { lastTx?: Tx }).lastTx = tx
      return (arg as (t: Tx) => Promise<unknown>)(tx)
    }
    return Promise.all(arg as Promise<unknown>[])
  }),
}

const mockConfig = {
  get: jest.fn(),
  getOrThrow: jest.fn(),
}

const mockAiService = {
  analyzeTranscript: jest.fn().mockResolvedValue(undefined),
}

const mockAssemblyAi = {
  isConfigured: jest.fn().mockReturnValue(false),
  transcribeWithDiarization: jest.fn(),
}

const mockEmbeddingIndexer = {
  indexAndStore: jest.fn().mockResolvedValue({ indexed: 0, failed: 0 }),
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeTranscriptionResponse(opts: Partial<{
  segments: Array<Record<string, unknown>>
  duration_seconds: number
  detected_languages: string[]
}> = {}) {
  return {
    segments: opts.segments ?? [
      { speaker: 'A', text: 'hello', start_time: 0, end_time: 5, language: 'fr', confidence: 0.9 },
      { speaker: 'B', text: 'world', start_time: 5, end_time: 10, language: 'fr', confidence: 0.95 },
    ],
    duration_seconds: opts.duration_seconds ?? 10,
    detected_languages: opts.detected_languages ?? ['fr'],
  }
}

function fetchOk(body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

function fetchFail(status: number, body = 'error'): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MeetingsService', () => {
  let service: MeetingsService
  let originalFetch: typeof global.fetch

  beforeAll(() => {
    originalFetch = global.fetch
  })
  afterAll(() => {
    global.fetch = originalFetch
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    // Default fs mock behaviour (each test can override).
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
    ;(fs.mkdirSync as jest.Mock).mockReturnValue(undefined)
    ;(fs.writeFileSync as jest.Mock).mockReturnValue(undefined)
    ;(fs.unlinkSync as jest.Mock).mockReturnValue(undefined)
    ;(fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('audio'))
    ;(fs.statSync as jest.Mock).mockReturnValue({ size: 1024 })

    mockConfig.getOrThrow.mockReturnValue('http://transcription:8000')
    mockConfig.get.mockImplementation((key: string, dflt?: unknown) => {
      if (key === 'AI_ENABLED') return 'false'
      if (key === 'TRANSCRIPTION_SECRET') return 'sekret'
      return dflt
    })

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AiService, useValue: mockAiService },
        { provide: AssemblyAiProvider, useValue: mockAssemblyAi },
        { provide: EmbeddingIndexerService, useValue: mockEmbeddingIndexer },
      ],
    }).compile()

    service = module.get<MeetingsService>(MeetingsService)
  })

  // ─── transcribe ────────────────────────────────────────────────────────────

  describe('transcribe', () => {
    it('returns failure when TRANSCRIPTION_URL has forbidden protocol', async () => {
      mockConfig.getOrThrow.mockReturnValueOnce('ftp://transcription:8000')
      const r = await service.transcribe('p1', Buffer.from('audio'), 'a.webm', 'Meeting')
      expect(r.isFailure).toBe(true)
      expect(r.error).toMatch(/Configuration/)
    })

    it('returns failure when TRANSCRIPTION_URL is not a valid URL', async () => {
      mockConfig.getOrThrow.mockReturnValueOnce('not a url')
      const r = await service.transcribe('p1', Buffer.from('audio'), 'a.webm', 'Meeting')
      expect(r.isFailure).toBe(true)
      expect(r.error).toMatch(/Configuration/)
    })

    it('persists transcript + fires indexer when local transcription succeeds', async () => {
      const body = makeTranscriptionResponse()
      global.fetch = fetchOk(body)
      mockPrisma.meetingTranscript.create.mockResolvedValue({ id: 't1', projectId: 'p1' })
      mockPrisma.transcriptSegment.createMany.mockResolvedValue({ count: 2 })
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({
        id: 't1', projectId: 'p1', title: 'Meeting', durationSeconds: 10,
        detectedLanguages: 'fr', recordedAt: new Date(), createdAt: new Date(),
        aiStatus: 'idle', audioPath: null, segments: [],
      })
      mockPrisma.transcriptSegment.findMany.mockResolvedValue([
        { id: 's1', text: 'hello' }, { id: 's2', text: 'world' },
      ])

      const r = await service.transcribe('p1', Buffer.from('audio'), 'a.webm', 'Meeting')

      expect(r.isSuccess).toBe(true)
      expect(mockPrisma.meetingTranscript.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ projectId: 'p1', title: 'Meeting', durationSeconds: 10, detectedLanguages: 'fr' }),
      })
      expect(mockPrisma.transcriptSegment.createMany).toHaveBeenCalled()
      // Allow the void-promise indexer trigger to settle.
      await new Promise((res) => setImmediate(res))
      expect(mockEmbeddingIndexer.indexAndStore).toHaveBeenCalledWith(
        'segment',
        [{ id: 's1', text: 'hello' }, { id: 's2', text: 'world' }],
        { projectId: 'p1' },
      )
    })

    it('does NOT fire indexer when zero segments', async () => {
      const body = makeTranscriptionResponse({ segments: [], duration_seconds: 0, detected_languages: [] })
      global.fetch = fetchOk(body)
      mockPrisma.meetingTranscript.create.mockResolvedValue({ id: 't1', projectId: 'p1' })
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({
        id: 't1', projectId: 'p1', title: 'X', durationSeconds: 0,
        detectedLanguages: '', recordedAt: new Date(), createdAt: new Date(),
        aiStatus: 'idle', audioPath: null, segments: [],
      })

      const r = await service.transcribe('p1', Buffer.from('audio'), 'a.webm', 'X')

      expect(r.isSuccess).toBe(true)
      expect(mockPrisma.transcriptSegment.createMany).not.toHaveBeenCalled()
      expect(mockEmbeddingIndexer.indexAndStore).not.toHaveBeenCalled()
    })

    it('fires AI analysis fire-and-forget when AI_ENABLED=true', async () => {
      mockConfig.get.mockImplementation((key: string, dflt?: unknown) => {
        if (key === 'AI_ENABLED') return 'true'
        if (key === 'TRANSCRIPTION_SECRET') return 'sekret'
        return dflt
      })
      global.fetch = fetchOk(makeTranscriptionResponse())
      mockPrisma.meetingTranscript.create.mockResolvedValue({ id: 't1', projectId: 'p1' })
      mockPrisma.transcriptSegment.createMany.mockResolvedValue({ count: 2 })
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({
        id: 't1', projectId: 'p1', title: 'M', durationSeconds: 10,
        detectedLanguages: 'fr', recordedAt: new Date(), createdAt: new Date(),
        aiStatus: 'idle', audioPath: null, segments: [],
      })
      mockPrisma.transcriptSegment.findMany.mockResolvedValue([])

      await service.transcribe('p1', Buffer.from('audio'), 'a.webm', 'M')

      await new Promise((res) => setImmediate(res))
      expect(mockAiService.analyzeTranscript).toHaveBeenCalledWith('t1')
    })

    it('does NOT fire AI analysis when AI_ENABLED is unset/false', async () => {
      global.fetch = fetchOk(makeTranscriptionResponse())
      mockPrisma.meetingTranscript.create.mockResolvedValue({ id: 't1', projectId: 'p1' })
      mockPrisma.transcriptSegment.createMany.mockResolvedValue({ count: 2 })
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({
        id: 't1', projectId: 'p1', title: 'M', durationSeconds: 10,
        detectedLanguages: 'fr', recordedAt: new Date(), createdAt: new Date(),
        aiStatus: 'idle', audioPath: null, segments: [],
      })
      mockPrisma.transcriptSegment.findMany.mockResolvedValue([])

      await service.transcribe('p1', Buffer.from('audio'), 'a.webm', 'M')

      await new Promise((res) => setImmediate(res))
      expect(mockAiService.analyzeTranscript).not.toHaveBeenCalled()
    })

    it('falls back to Whisper API when local transcription fails', async () => {
      mockConfig.get.mockImplementation((key: string, dflt?: unknown) => {
        if (key === 'AI_FALLBACK_API_KEY') return 'zai-key'
        if (key === 'WHISPER_FALLBACK_BASE_URL') return ''
        if (key === 'WHISPER_FALLBACK_MODEL') return 'glm-asr'
        if (key === 'AI_ENABLED') return 'false'
        if (key === 'TRANSCRIPTION_SECRET') return ''
        return dflt
      })

      // First fetch = local fails; second fetch = Whisper fallback succeeds.
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'down', json: async () => ({}) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            language: 'fr',
            duration: 12.5,
            segments: [
              { id: 0, start: 0, end: 6, text: 'bonjour', avg_logprob: -0.1 },
              { id: 1, start: 6, end: 12, text: 'monde' },
            ],
          }),
          text: async () => '',
        }) as unknown as typeof global.fetch

      mockPrisma.meetingTranscript.create.mockResolvedValue({ id: 't1', projectId: 'p1' })
      mockPrisma.transcriptSegment.createMany.mockResolvedValue({ count: 2 })
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({
        id: 't1', projectId: 'p1', title: 'M', durationSeconds: 12,
        detectedLanguages: 'fr', recordedAt: new Date(), createdAt: new Date(),
        aiStatus: 'idle', audioPath: null, segments: [],
      })
      mockPrisma.transcriptSegment.findMany.mockResolvedValue([])

      const r = await service.transcribe('p1', Buffer.from('audio'), 'a.webm', 'M')

      expect(r.isSuccess).toBe(true)
      expect(mockPrisma.meetingTranscript.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ durationSeconds: 13 }),
      })
    })

    it('returns failure when both local and fallback fail', async () => {
      mockConfig.get.mockImplementation((key: string, dflt?: unknown) => {
        if (key === 'AI_FALLBACK_API_KEY') return 'zai-key'
        if (key === 'WHISPER_FALLBACK_BASE_URL') return ''
        if (key === 'WHISPER_FALLBACK_MODEL') return 'glm-asr'
        return dflt
      })
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'down', json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'unavailable', json: async () => ({}) }) as unknown as typeof global.fetch

      const r = await service.transcribe('p1', Buffer.from('audio'), 'a.webm', 'M')
      expect(r.isFailure).toBe(true)
      expect(r.error).toMatch(/indisponible/i)
    })

    it('returns failure when Whisper fallback has no API key configured', async () => {
      mockConfig.get.mockImplementation((key: string, dflt?: unknown) => {
        if (key === 'AI_FALLBACK_API_KEY') return ''
        if (key === 'WHISPER_FALLBACK_API_KEY') return ''
        return dflt
      })
      global.fetch = fetchFail(500)

      const r = await service.transcribe('p1', Buffer.from('audio'), 'a.webm', 'M')
      expect(r.isFailure).toBe(true)
    })

    it('returns failure when persistence transaction fails', async () => {
      global.fetch = fetchOk(makeTranscriptionResponse())
      mockPrisma.meetingTranscript.create.mockRejectedValue(new Error('DB down'))

      const r = await service.transcribe('p1', Buffer.from('audio'), 'a.webm', 'M')
      expect(r.isFailure).toBe(true)
      expect(r.error).toMatch(/sauvegarde/i)
    })

    it('returns failure when transcription response is malformed JSON shape', async () => {
      // Response is a JSON array instead of object — validator should throw.
      global.fetch = fetchOk([1, 2, 3])
      mockConfig.get.mockImplementation((key: string, dflt?: unknown) => {
        if (key === 'AI_FALLBACK_API_KEY') return ''
        return dflt
      })

      const r = await service.transcribe('p1', Buffer.from('audio'), 'a.webm', 'M')
      expect(r.isFailure).toBe(true)
    })
  })

  // ─── getByProject ───────────────────────────────────────────────────────────

  describe('getByProject', () => {
    it('returns mapped transcript list ordered desc', async () => {
      mockPrisma.meetingTranscript.findMany.mockResolvedValue([
        {
          id: 't2', title: 'B', durationSeconds: 30, detectedLanguages: 'fr',
          recordedAt: new Date('2026-02-02'), createdAt: new Date('2026-02-02'),
          aiStatus: 'completed', _count: { segments: 5 },
        },
        {
          id: 't1', title: 'A', durationSeconds: 10, detectedLanguages: 'fr,en',
          recordedAt: new Date('2026-01-01'), createdAt: new Date('2026-01-01'),
          aiStatus: 'idle', _count: { segments: 2 },
        },
      ])

      const r = await service.getByProject('p1')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toHaveLength(2)
      expect(r.value?.[0]).toMatchObject({ id: 't2', segmentCount: 5, aiStatus: 'completed' })
      expect(mockPrisma.meetingTranscript.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: 'p1' }, orderBy: { createdAt: 'desc' } }),
      )
    })
  })

  // ─── getById ────────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns mapped transcript with hasAudio flag and ordered segments', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({
        id: 't1', projectId: 'p1', title: 'X', durationSeconds: 10,
        detectedLanguages: 'fr', recordedAt: new Date(), createdAt: new Date(),
        aiStatus: 'idle', audioPath: '/x/y.webm',
        segments: [
          { id: 's1', speaker: 'A', text: 'hello', startTime: 0, endTime: 5, language: 'fr', confidence: 0.9 },
        ],
      })

      const r = await service.getById('t1')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toMatchObject({ id: 't1', hasAudio: true, segments: [expect.objectContaining({ id: 's1' })] })
      expect(mockPrisma.meetingTranscript.findUnique).toHaveBeenCalledWith({
        where: { id: 't1' },
        include: { segments: { orderBy: { startTime: 'asc' } } },
      })
    })

    it('returns failure when transcript missing', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue(null)
      const r = await service.getById('missing')
      expect(r.isFailure).toBe(true)
      expect(r.error).toMatch(/non trouvée/i)
    })
  })

  // ─── deleteTranscript ───────────────────────────────────────────────────────

  describe('deleteTranscript', () => {
    it('deletes both file and DB row on happy path', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1', audioPath: '/x/audio.webm' })
      mockPrisma.meetingTranscript.delete.mockResolvedValue({ id: 't1' })

      const r = await service.deleteTranscript('t1')
      expect(r.isSuccess).toBe(true)
      expect(fs.unlinkSync).toHaveBeenCalledWith('/x/audio.webm')
      expect(mockPrisma.meetingTranscript.delete).toHaveBeenCalledWith({ where: { id: 't1' } })
    })

    it('still deletes DB row when file already missing', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1', audioPath: '/x/gone.webm' })
      mockPrisma.meetingTranscript.delete.mockResolvedValue({ id: 't1' })
      ;(fs.unlinkSync as jest.Mock).mockImplementationOnce(() => { throw new Error('ENOENT') })

      const r = await service.deleteTranscript('t1')
      expect(r.isSuccess).toBe(true)
      expect(mockPrisma.meetingTranscript.delete).toHaveBeenCalled()
    })

    it('returns failure when transcript not found', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue(null)
      const r = await service.deleteTranscript('missing')
      expect(r.isFailure).toBe(true)
    })

    it('skips fs.unlinkSync when transcript has no audioPath', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1', audioPath: null })
      mockPrisma.meetingTranscript.delete.mockResolvedValue({ id: 't1' })

      const r = await service.deleteTranscript('t1')
      expect(r.isSuccess).toBe(true)
      expect(fs.unlinkSync).not.toHaveBeenCalled()
    })
  })

  // ─── attachAudio ────────────────────────────────────────────────────────────

  describe('attachAudio', () => {
    it('returns failure when transcript not found', async () => {
      mockPrisma.meetingTranscript.findFirst.mockResolvedValue(null)
      const r = await service.attachAudio('p1', 't-missing', Buffer.from('x'), 'audio/webm')
      expect(r.isFailure).toBe(true)
    })

    it('rejects unsupported MIME types', async () => {
      mockPrisma.meetingTranscript.findFirst.mockResolvedValue({ id: 't1', audioPath: null })
      const r = await service.attachAudio('p1', 't1', Buffer.from('x'), 'application/zip')
      expect(r.isFailure).toBe(true)
      expect(r.error).toMatch(/non supporté/i)
    })

    it('writes file + updates DB on happy path and removes prior audio', async () => {
      mockPrisma.meetingTranscript.findFirst.mockResolvedValue({ id: 't1', audioPath: '/prior.webm' })
      mockPrisma.meetingTranscript.update.mockResolvedValue({ id: 't1' })

      const r = await service.attachAudio('p1', 't1', Buffer.from('blob'), 'audio/webm')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toEqual({ audioSize: 4 })
      expect(fs.writeFileSync).toHaveBeenCalled()
      // Prior audio cleaned up
      expect(fs.unlinkSync).toHaveBeenCalledWith('/prior.webm')
      expect(mockPrisma.meetingTranscript.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: expect.objectContaining({ audioMimeType: 'audio/webm', audioSize: 4 }),
      })
    })

    it('creates the project upload directory when it does not exist', async () => {
      mockPrisma.meetingTranscript.findFirst.mockResolvedValue({ id: 't1', audioPath: null })
      mockPrisma.meetingTranscript.update.mockResolvedValue({ id: 't1' })
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const r = await service.attachAudio('p1', 't1', Buffer.from('blob'), 'audio/webm')
      expect(r.isSuccess).toBe(true)
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true })
    })

    it('handles MIME with codec suffix (audio/webm;codecs=opus → cleaned)', async () => {
      mockPrisma.meetingTranscript.findFirst.mockResolvedValue({ id: 't1', audioPath: null })
      mockPrisma.meetingTranscript.update.mockResolvedValue({ id: 't1' })

      const r = await service.attachAudio('p1', 't1', Buffer.from('x'), 'audio/webm;codecs=opus')
      expect(r.isSuccess).toBe(true)
      expect(mockPrisma.meetingTranscript.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: expect.objectContaining({ audioMimeType: 'audio/webm' }),
      })
    })
  })

  // ─── redoDiarization ────────────────────────────────────────────────────────

  describe('redoDiarization', () => {
    it('returns failure when audio not yet attached', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1', audioPath: null, audioMimeType: null })
      const r = await service.redoDiarization('t1')
      expect(r.isFailure).toBe(true)
    })

    it('returns failure when audio file missing from disk', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1', audioPath: '/x.webm', audioMimeType: 'audio/webm' })
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const r = await service.redoDiarization('t1')
      expect(r.isFailure).toBe(true)
      expect(r.error).toMatch(/introuvable/i)
    })

    it('uses AssemblyAI when configured and rewrites segments', async () => {
      mockAssemblyAi.isConfigured.mockReturnValue(true)
      mockAssemblyAi.transcribeWithDiarization.mockResolvedValue(makeTranscriptionResponse())
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1', audioPath: '/x.webm', audioMimeType: 'audio/webm' })

      const r = await service.redoDiarization('t1')
      expect(r.isSuccess).toBe(true)
      expect(r.value?.provider).toBe('assemblyai')
      expect(r.value?.speakers).toBe(2)
      expect(mockPrisma.$transaction).toHaveBeenCalled()

      mockAssemblyAi.isConfigured.mockReturnValue(false)
    })

    it('falls back to local when AssemblyAI throws', async () => {
      mockAssemblyAi.isConfigured.mockReturnValue(true)
      mockAssemblyAi.transcribeWithDiarization.mockRejectedValue(new Error('aai down'))
      global.fetch = fetchOk(makeTranscriptionResponse({
        segments: [{ speaker: 'A', text: 'x', start_time: 0, end_time: 5, language: 'fr', confidence: 0.9 }],
      }))
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1', audioPath: '/x.webm', audioMimeType: 'audio/webm' })

      const r = await service.redoDiarization('t1')
      expect(r.isSuccess).toBe(true)
      expect(r.value?.provider).toBe('local-whisper')

      mockAssemblyAi.isConfigured.mockReturnValue(false)
    })

    it('uses local directly when AssemblyAI is not configured', async () => {
      mockAssemblyAi.isConfigured.mockReturnValue(false)
      global.fetch = fetchOk(makeTranscriptionResponse())
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1', audioPath: '/x.webm', audioMimeType: 'audio/webm' })

      const r = await service.redoDiarization('t1')
      expect(r.isSuccess).toBe(true)
      expect(r.value?.provider).toBe('local-whisper')
    })

    it('returns failure when local-whisper fallback also fails (after AssemblyAI fail)', async () => {
      mockAssemblyAi.isConfigured.mockReturnValue(true)
      mockAssemblyAi.transcribeWithDiarization.mockRejectedValue(new Error('aai down'))
      global.fetch = fetchFail(500, 'unavailable')
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1', audioPath: '/x.webm', audioMimeType: 'audio/webm' })

      const r = await service.redoDiarization('t1')
      expect(r.isFailure).toBe(true)

      mockAssemblyAi.isConfigured.mockReturnValue(false)
    })
  })

  // ─── setAudioPreserved ──────────────────────────────────────────────────────

  describe('setAudioPreserved', () => {
    it('flips the preserved flag', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1' })
      mockPrisma.meetingTranscript.update.mockResolvedValue({ id: 't1' })

      const r = await service.setAudioPreserved('t1', true)
      expect(r.isSuccess).toBe(true)
      expect(r.value).toEqual({ preserved: true })
      expect(mockPrisma.meetingTranscript.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { audioPreserved: true },
      })
    })

    it('returns failure when transcript missing', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue(null)
      const r = await service.setAudioPreserved('missing', true)
      expect(r.isFailure).toBe(true)
    })
  })

  // ─── getAudioFile ───────────────────────────────────────────────────────────

  describe('getAudioFile', () => {
    it('returns audio path + mime + size when present', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({
        audioPath: '/x.webm', audioMimeType: 'audio/webm', audioSize: 1024,
      })

      const r = await service.getAudioFile('t1')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toEqual({ path: '/x.webm', mimeType: 'audio/webm', size: 1024 })
    })

    it('falls back to fs.statSync when audioSize is null', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({
        audioPath: '/x.webm', audioMimeType: null, audioSize: null,
      })
      ;(fs.statSync as jest.Mock).mockReturnValue({ size: 4096 })

      const r = await service.getAudioFile('t1')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toEqual({ path: '/x.webm', mimeType: 'audio/webm', size: 4096 })
    })

    it('returns failure when no audio path persisted', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ audioPath: null })
      const r = await service.getAudioFile('t1')
      expect(r.isFailure).toBe(true)
    })

    it('returns failure when file no longer exists on disk', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({
        audioPath: '/x.webm', audioMimeType: 'audio/webm', audioSize: 1024,
      })
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)
      const r = await service.getAudioFile('t1')
      expect(r.isFailure).toBe(true)
    })
  })

  // ─── renameSpeaker ──────────────────────────────────────────────────────────

  describe('renameSpeaker', () => {
    it('renames all matching segments and writes an audit log', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1' })
      mockPrisma.transcriptSegment.updateMany.mockResolvedValue({ count: 3 })
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-1' })

      const r = await service.renameSpeaker('t1', 'A', 'Alice', 'user-1')
      expect(r.isSuccess).toBe(true)
      expect(mockPrisma.transcriptSegment.updateMany).toHaveBeenCalledWith({
        where: { transcriptId: 't1', speaker: 'A' },
        data: { speaker: 'Alice' },
      })
      expect(mockPrisma.auditLog.create).toHaveBeenCalled()
    })

    it('returns failure when transcript missing', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue(null)
      const r = await service.renameSpeaker('missing', 'A', 'Alice', 'u-1')
      expect(r.isFailure).toBe(true)
    })

    it('still succeeds when audit log write fails', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1' })
      mockPrisma.transcriptSegment.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.auditLog.create.mockRejectedValue(new Error('audit DB down'))

      const r = await service.renameSpeaker('t1', 'A', 'Alice', 'u-1')
      expect(r.isSuccess).toBe(true)
    })
  })

  // ─── triggerAiAnalysis ──────────────────────────────────────────────────────

  describe('triggerAiAnalysis', () => {
    it('fires analyzeTranscript fire-and-forget', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1', aiStatus: 'idle' })

      const r = await service.triggerAiAnalysis('t1')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toEqual({ aiStatus: 'processing' })
      await new Promise((res) => setImmediate(res))
      expect(mockAiService.analyzeTranscript).toHaveBeenCalledWith('t1')
    })

    it('rejects when already processing', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({ id: 't1', aiStatus: 'processing' })
      const r = await service.triggerAiAnalysis('t1')
      expect(r.isFailure).toBe(true)
      expect(r.error).toMatch(/déjà en cours/i)
      expect(mockAiService.analyzeTranscript).not.toHaveBeenCalled()
    })

    it('returns failure when transcript missing', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue(null)
      const r = await service.triggerAiAnalysis('missing')
      expect(r.isFailure).toBe(true)
    })
  })

  // ─── getAiResults ───────────────────────────────────────────────────────────

  describe('getAiResults', () => {
    it('returns mapped AI results', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue({
        aiStatus: 'completed',
        aiSummary: 'summary',
        aiError: null,
        aiModel: 'glm-4.5-air',
        aiProcessedAt: new Date(),
        actionItems: [
          { id: 'a1', description: 'do x', assigneeName: 'Alice', dueDate: null, isCompleted: false },
        ],
        decisions: [
          { id: 'd1', description: 'use postgres', category: 'decision' },
        ],
      })

      const r = await service.getAiResults('t1')
      expect(r.isSuccess).toBe(true)
      expect(r.value?.aiStatus).toBe('completed')
      expect(r.value?.actionItems).toHaveLength(1)
      expect(r.value?.decisions).toHaveLength(1)
    })

    it('returns failure when transcript missing', async () => {
      mockPrisma.meetingTranscript.findUnique.mockResolvedValue(null)
      const r = await service.getAiResults('missing')
      expect(r.isFailure).toBe(true)
    })
  })

  // ─── convertActionItemsToWPs ────────────────────────────────────────────────

  describe('convertActionItemsToWPs', () => {
    it('rejects empty selection', async () => {
      const r = await service.convertActionItemsToWPs('p1', 'm1', [], 'u1', null)
      expect(r.isFailure).toBe(true)
    })

    it('rejects when meeting is not on the project', async () => {
      mockPrisma.meetingTranscript.findFirst.mockResolvedValue(null)
      const r = await service.convertActionItemsToWPs('p1', 'm-foreign', ['a1'], 'u1', null)
      expect(r.isFailure).toBe(true)
      expect(r.error).toMatch(/Réunion/)
    })

    it('rejects when no action items match', async () => {
      mockPrisma.meetingTranscript.findFirst.mockResolvedValue({ id: 'm1' })
      mockPrisma.meetingActionItem.findMany.mockResolvedValue([])
      const r = await service.convertActionItemsToWPs('p1', 'm1', ['a1'], 'u1', null)
      expect(r.isFailure).toBe(true)
    })

    it('fuzzy-matches assignee by full name + skips unknown sprint', async () => {
      mockPrisma.meetingTranscript.findFirst.mockResolvedValue({ id: 'm1' })
      mockPrisma.meetingActionItem.findMany.mockResolvedValue([
        { id: 'a1', description: 'Alice should do X', assigneeName: 'Alice', dueDate: null },
        { id: 'a2', description: 'a'.repeat(250), assigneeName: 'Unknown', dueDate: null },
      ])
      // Sprint provided but not on this project → safeSprintId stays null.
      mockPrisma.sprint.findFirst.mockResolvedValue(null)
      mockPrisma.projectMember.findMany.mockResolvedValue([
        { userId: 'u-alice', user: { id: 'u-alice', firstName: 'Alice', lastName: 'Smith' } },
      ])

      const r = await service.convertActionItemsToWPs('p1', 'm1', ['a1', 'a2'], 'u-author', 'sprint-other')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toEqual({ created: 2, skipped: 0 })

      // Inspect the captured tx client.
      const tx = (mockPrisma.$transaction as unknown as { lastTx: Tx }).lastTx
      expect(tx.workPackage.create).toHaveBeenCalledTimes(2)
      const calls = tx.workPackage.create.mock.calls

      // a1 → assigned to Alice, full description preserved
      expect(calls[0][0].data).toMatchObject({
        projectId: 'p1',
        authorId: 'u-author',
        type: 'Task',
        status: 'New',
        priority: 'Normal',
        assigneeId: 'u-alice',
        aiGeneratedFrom: 'meeting-actions:m1',
        sprintId: null,
      })

      // a2 → no assignee match (Unknown), title truncated to 200 chars with ellipsis
      expect(calls[1][0].data.assigneeId).toBeNull()
      expect(calls[1][0].data.title.length).toBe(200)
      expect(calls[1][0].data.title.endsWith('...')).toBe(true)
      expect(calls[1][0].data.description.length).toBe(250)

      expect(tx.meetingActionItem.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { isCompleted: true },
      })
    })

    it('uses safeSprintId when the sprint belongs to the project', async () => {
      mockPrisma.meetingTranscript.findFirst.mockResolvedValue({ id: 'm1' })
      mockPrisma.meetingActionItem.findMany.mockResolvedValue([
        { id: 'a1', description: 'do x', assigneeName: null, dueDate: null },
      ])
      mockPrisma.sprint.findFirst.mockResolvedValue({ id: 'sprint-1' })
      mockPrisma.projectMember.findMany.mockResolvedValue([])

      const r = await service.convertActionItemsToWPs('p1', 'm1', ['a1'], 'u-author', 'sprint-1')
      expect(r.isSuccess).toBe(true)
      const tx = (mockPrisma.$transaction as unknown as { lastTx: Tx }).lastTx
      expect(tx.workPackage.create.mock.calls[0][0].data.sprintId).toBe('sprint-1')
    })
  })
})
