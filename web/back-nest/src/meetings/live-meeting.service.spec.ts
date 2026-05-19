/**
 * @file live-meeting.service.spec.ts — unit tests for the live meeting
 *   pipeline. Mocks global fetch for the FastAPI /transcribe call,
 *   PrismaService for the persistence path, and EmbeddingIndexerService
 *   for the fire-and-forget Phase 4 hook.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common'
import { LiveMeetingService } from './live-meeting.service'
import { PrismaService } from '../prisma/prisma.service'
import { EmbeddingIndexerService } from '../ai/embeddings/embedding-indexer.service'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPrisma = {
  project: {
    findUnique: jest.fn(),
  },
  meetingTranscript: {
    create: jest.fn(),
  },
  transcriptSegment: {
    create: jest.fn(),
  },
}

const mockIndexer = {
  indexAndStore: jest.fn(),
}

const mockConfig = {
  get: jest.fn(),
}

const originalFetch = global.fetch

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status })
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('LiveMeetingService', () => {
  let service: LiveMeetingService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockIndexer.indexAndStore.mockResolvedValue({ indexed: 1, failed: 0 })
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'TRANSCRIPTION_URL') return 'http://transcription:8000'
      if (key === 'TRANSCRIPTION_SECRET') return 'shared-secret'
      return undefined
    })

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveMeetingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EmbeddingIndexerService, useValue: mockIndexer },
      ],
    }).compile()

    service = module.get<LiveMeetingService>(LiveMeetingService)
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  // ── transcribeChunk ───────────────────────────────────────────────────────

  describe('transcribeChunk', () => {
    it('rejects empty buffer', async () => {
      await expect(service.transcribeChunk(Buffer.alloc(0), 'audio/webm')).rejects.toThrow(BadRequestException)
    })

    it('rejects buffers over 25 MB', async () => {
      const huge = Buffer.alloc(26 * 1024 * 1024)
      await expect(service.transcribeChunk(huge, 'audio/webm')).rejects.toThrow(BadRequestException)
    })

    it('throws BadGateway when TRANSCRIPTION_URL is not configured', async () => {
      mockConfig.get.mockImplementation((key: string) => (key === 'TRANSCRIPTION_URL' ? undefined : 'secret'))
      await expect(service.transcribeChunk(Buffer.from('audio'), 'audio/webm')).rejects.toThrow(BadGatewayException)
    })

    it('returns text + dominant language on a 200 response', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse(200, {
          segments: [
            { text: 'bonjour', language: 'fr' },
            { text: 'tout le monde', language: 'fr' },
            { text: 'hello', language: 'en' },
          ],
        }),
      ) as unknown as typeof fetch

      const out = await service.transcribeChunk(Buffer.from('audio'), 'audio/webm')

      expect(out.text).toBe('bonjour tout le monde hello')
      // fr appears 2x, en 1x → dominant is fr.
      expect(out.language).toBe('fr')
    })

    it('falls back to detected_languages[0] when no per-segment language', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse(200, {
          segments: [{ text: 'bonjour' }],
          detected_languages: ['fr', 'en'],
        }),
      ) as unknown as typeof fetch

      const out = await service.transcribeChunk(Buffer.from('audio'), 'audio/webm')
      expect(out.text).toBe('bonjour')
      expect(out.language).toBe('fr')
    })

    it('reports status=service_unavailable on a 503 (model loading)', async () => {
      global.fetch = jest.fn().mockResolvedValue(textResponse(503, 'service unavailable')) as unknown as typeof fetch

      const out = await service.transcribeChunk(Buffer.from('audio'), 'audio/webm')
      expect(out).toEqual({ text: '', language: null, status: 'service_unavailable' })
    })

    it('reports status=transient_failure on a generic 5xx', async () => {
      global.fetch = jest.fn().mockResolvedValue(textResponse(500, 'boom')) as unknown as typeof fetch

      const out = await service.transcribeChunk(Buffer.from('audio'), 'audio/webm')
      expect(out).toEqual({ text: '', language: null, status: 'transient_failure' })
    })

    it('reports status=transient_failure on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch

      const out = await service.transcribeChunk(Buffer.from('audio'), 'audio/webm')
      expect(out).toEqual({ text: '', language: null, status: 'transient_failure' })
    })

    it('reports status=ok on a successful transcription', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse(200, { segments: [{ text: 'hi', language: 'en' }] }),
      ) as unknown as typeof fetch

      const out = await service.transcribeChunk(Buffer.from('audio'), 'audio/webm')
      expect(out.status).toBe('ok')
      expect(out.text).toBe('hi')
    })

    it('attaches x-transcription-secret header when configured', async () => {
      const fetchSpy = jest.fn().mockResolvedValue(jsonResponse(200, { segments: [] }))
      global.fetch = fetchSpy as unknown as typeof fetch

      await service.transcribeChunk(Buffer.from('audio'), 'audio/webm')

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers['x-transcription-secret']).toBe('shared-secret')
    })

    it('omits the secret header when TRANSCRIPTION_SECRET is empty', async () => {
      mockConfig.get.mockImplementation((key: string, fallback?: string) => {
        if (key === 'TRANSCRIPTION_URL') return 'http://transcription:8000'
        if (key === 'TRANSCRIPTION_SECRET') return fallback ?? ''
        return undefined
      })
      const fetchSpy = jest.fn().mockResolvedValue(jsonResponse(200, { segments: [] }))
      global.fetch = fetchSpy as unknown as typeof fetch

      await service.transcribeChunk(Buffer.from('audio'), 'audio/webm')

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers['x-transcription-secret']).toBeUndefined()
    })

    it('returns empty language when no segment language and no detected_languages', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse(200, { segments: [{ text: 'hello' }] }),
      ) as unknown as typeof fetch

      const out = await service.transcribeChunk(Buffer.from('audio'), 'audio/webm')
      expect(out.text).toBe('hello')
      expect(out.language).toBeNull()
    })
  })

  // ── saveLiveTranscript ────────────────────────────────────────────────────

  describe('saveLiveTranscript', () => {
    function setupHappyPath(): void {
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'p1' })
      mockPrisma.meetingTranscript.create.mockResolvedValue({ id: 'mt-1', projectId: 'p1' })
      mockPrisma.transcriptSegment.create.mockResolvedValue({ id: 'seg-1', transcriptId: 'mt-1' })
    }

    it('throws NotFound when the project is missing or deleted', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null)
      await expect(
        service.saveLiveTranscript('p1', 'Title', 'Ceci est une transcription assez longue.', 600),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws BadRequest when the transcript is shorter than 20 chars after trim', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'p1' })
      await expect(service.saveLiveTranscript('p1', 'Title', '   tiny   ', 60)).rejects.toThrow(BadRequestException)
    })

    it('persists transcript + segment and returns the id (happy path)', async () => {
      setupHappyPath()
      const out = await service.saveLiveTranscript(
        'p1',
        'Réunion test',
        'Ceci est une transcription qui dépasse 20 caractères.',
        1800,
        'kickoff',
        ['FR', 'en', 'ar'],
      )

      expect(out).toEqual({ transcriptId: 'mt-1' })

      const mtCall = mockPrisma.meetingTranscript.create.mock.calls[0][0]
      expect(mtCall.data.projectId).toBe('p1')
      expect(mtCall.data.title).toBe('Réunion test')
      expect(mtCall.data.durationSeconds).toBe(1800)
      expect(mtCall.data.meetingType).toBe('kickoff')
      // Order of items in the cleanLangs derives from input order — fr,en,ar.
      expect(mtCall.data.detectedLanguages).toBe('fr,en,ar')

      const segCall = mockPrisma.transcriptSegment.create.mock.calls[0][0]
      expect(segCall.data.transcriptId).toBe('mt-1')
      expect(segCall.data.language).toBe('fr')
      expect(segCall.data.speaker).toBe('PM + invités')
      expect(segCall.data.endTime).toBe(1800)
    })

    it('sanitises invalid meetingType to null', async () => {
      setupHappyPath()
      await service.saveLiveTranscript('p1', 'Title', 'Une transcription valide ici.', 60, 'bogus-type')

      const mtCall = mockPrisma.meetingTranscript.create.mock.calls[0][0]
      expect(mtCall.data.meetingType).toBeNull()
    })

    it("falls back to 'fr' when no valid detected languages arrived", async () => {
      setupHappyPath()
      await service.saveLiveTranscript('p1', 'Title', 'Une transcription valide ici.', 60, undefined, ['xx', 'yy', ''])

      const mtCall = mockPrisma.meetingTranscript.create.mock.calls[0][0]
      expect(mtCall.data.detectedLanguages).toBe('fr')
      const segCall = mockPrisma.transcriptSegment.create.mock.calls[0][0]
      expect(segCall.data.language).toBe('fr')
    })

    it('trims transcript over 100k chars before persisting', async () => {
      setupHappyPath()
      const big = 'x'.repeat(120_000)
      await service.saveLiveTranscript('p1', 'Title', big, 60)

      const segCall = mockPrisma.transcriptSegment.create.mock.calls[0][0]
      expect(segCall.data.text.length).toBe(100_000)
    })

    it("falls back to 'Réunion en direct' when title is empty", async () => {
      setupHappyPath()
      await service.saveLiveTranscript('p1', '', 'Une transcription valide ici.', 60)

      const mtCall = mockPrisma.meetingTranscript.create.mock.calls[0][0]
      expect(mtCall.data.title).toBe('Réunion en direct')
    })

    it('truncates title to 200 chars', async () => {
      setupHappyPath()
      const longTitle = 't'.repeat(300)
      await service.saveLiveTranscript('p1', longTitle, 'Une transcription valide ici.', 60)

      const mtCall = mockPrisma.meetingTranscript.create.mock.calls[0][0]
      expect(mtCall.data.title.length).toBe(200)
    })

    it('rounds and clamps duration to a non-negative integer', async () => {
      setupHappyPath()
      await service.saveLiveTranscript('p1', 'Title', 'Une transcription valide ici.', -42.7)

      const mtCall = mockPrisma.meetingTranscript.create.mock.calls[0][0]
      expect(mtCall.data.durationSeconds).toBe(0)
      const segCall = mockPrisma.transcriptSegment.create.mock.calls[0][0]
      expect(segCall.data.endTime).toBe(0)
    })

    it('fires the embedding hook with the segment id and trimmed text', async () => {
      setupHappyPath()
      await service.saveLiveTranscript('p1', 'Title', 'Une transcription valide ici.', 60)

      // Fire-and-forget — give the microtask queue a tick to drain.
      await new Promise((r) => setImmediate(r))

      expect(mockIndexer.indexAndStore).toHaveBeenCalledWith(
        'segment',
        [{ id: 'seg-1', text: 'Une transcription valide ici.' }],
        { projectId: 'p1' },
      )
    })

    it('embedding-hook failure is swallowed and does not break the save', async () => {
      setupHappyPath()
      mockIndexer.indexAndStore.mockRejectedValue(new Error('embed down'))

      await expect(
        service.saveLiveTranscript('p1', 'Title', 'Une transcription valide ici.', 60),
      ).resolves.toEqual({ transcriptId: 'mt-1' })

      // Drain microtasks so the .catch handler runs (and is observed not to throw).
      await new Promise((r) => setImmediate(r))
    })

    it('dedupes repeated languages in the detected list', async () => {
      setupHappyPath()
      await service.saveLiveTranscript('p1', 'T', 'Une transcription valide ici.', 60, undefined, ['fr', 'fr', 'FR', 'en'])

      const mtCall = mockPrisma.meetingTranscript.create.mock.calls[0][0]
      expect(mtCall.data.detectedLanguages).toBe('fr,en')
    })
  })
})
