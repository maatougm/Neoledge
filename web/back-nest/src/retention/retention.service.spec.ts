import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import * as fs from 'fs'
import { RetentionService } from './retention.service'
import { PrismaService } from '../prisma/prisma.service'

jest.mock('fs')

const mockPrisma = {
  meetingTranscript: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
}

describe('RetentionService', () => {
  let service: RetentionService
  let configGet: jest.Mock

  beforeEach(async () => {
    jest.clearAllMocks()

    configGet = jest.fn()
    const mockConfig = { get: configGet } as Partial<ConfigService>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()

    service = module.get<RetentionService>(RetentionService)
  })

  // ── retentionDays getter ──────────────────────────────────────────────────

  describe('retentionDays getter', () => {
    it('defaults to 90 when MEETING_AUDIO_RETENTION_DAYS is undefined', async () => {
      configGet.mockReturnValue(undefined)
      mockPrisma.meetingTranscript.findMany.mockResolvedValue([])
      await service.purgeExpiredAudio()
      const callArg = mockPrisma.meetingTranscript.findMany.mock.calls[0][0] as {
        where: { createdAt: { lt: Date } }
      }
      const cutoff = callArg.where.createdAt.lt
      const expectedMs = Date.now() - 90 * 24 * 60 * 60 * 1000
      expect(Math.abs(cutoff.getTime() - expectedMs)).toBeLessThan(5_000)
    })

    it('defaults to 90 on empty string', async () => {
      configGet.mockReturnValue('')
      mockPrisma.meetingTranscript.findMany.mockResolvedValue([])
      await service.purgeExpiredAudio()
      expect(mockPrisma.meetingTranscript.findMany).toHaveBeenCalled()
    })

    it('defaults to 90 on non-numeric value', async () => {
      configGet.mockReturnValue('not-a-number')
      mockPrisma.meetingTranscript.findMany.mockResolvedValue([])
      await service.purgeExpiredAudio()
      const callArg = mockPrisma.meetingTranscript.findMany.mock.calls[0][0] as {
        where: { createdAt: { lt: Date } }
      }
      const cutoff = callArg.where.createdAt.lt
      const expectedMs = Date.now() - 90 * 24 * 60 * 60 * 1000
      expect(Math.abs(cutoff.getTime() - expectedMs)).toBeLessThan(5_000)
    })

    it('defaults to 90 on negative value', async () => {
      configGet.mockReturnValue('-10')
      mockPrisma.meetingTranscript.findMany.mockResolvedValue([])
      await service.purgeExpiredAudio()
      expect(mockPrisma.meetingTranscript.findMany).toHaveBeenCalled()
    })

    it('accepts a positive override', async () => {
      configGet.mockReturnValue('30')
      mockPrisma.meetingTranscript.findMany.mockResolvedValue([])
      await service.purgeExpiredAudio()
      const callArg = mockPrisma.meetingTranscript.findMany.mock.calls[0][0] as {
        where: { createdAt: { lt: Date } }
      }
      const cutoff = callArg.where.createdAt.lt
      const expectedMs = Date.now() - 30 * 24 * 60 * 60 * 1000
      expect(Math.abs(cutoff.getTime() - expectedMs)).toBeLessThan(5_000)
    })
  })

  // ── purgeExpiredAudio ─────────────────────────────────────────────────────

  describe('purgeExpiredAudio', () => {
    it('is a no-op when MEETING_AUDIO_RETENTION_DAYS=0 (retention disabled)', async () => {
      configGet.mockReturnValue('0')
      await service.purgeExpiredAudio()
      expect(mockPrisma.meetingTranscript.findMany).not.toHaveBeenCalled()
      expect(mockPrisma.meetingTranscript.updateMany).not.toHaveBeenCalled()
    })

    it('logs and returns when no expired rows are found', async () => {
      configGet.mockReturnValue('90')
      mockPrisma.meetingTranscript.findMany.mockResolvedValue([])
      await service.purgeExpiredAudio()
      expect(mockPrisma.meetingTranscript.findMany).toHaveBeenCalledTimes(1)
      expect(mockPrisma.meetingTranscript.updateMany).not.toHaveBeenCalled()
      expect(fs.unlinkSync).not.toHaveBeenCalled()
    })

    it('selects only rows with audioPath set, audioPreserved=false, older than cutoff', async () => {
      configGet.mockReturnValue('90')
      mockPrisma.meetingTranscript.findMany.mockResolvedValue([])
      await service.purgeExpiredAudio()
      const where = (mockPrisma.meetingTranscript.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>
      }).where
      expect(where.audioPath).toEqual({ not: null })
      expect(where.audioPreserved).toBe(false)
      expect(where.createdAt).toHaveProperty('lt')
    })

    it('deletes audio files on disk for each expired row', async () => {
      configGet.mockReturnValue('90')
      const expired = [
        { id: 't1', audioPath: '/uploads/t1.webm' },
        { id: 't2', audioPath: '/uploads/t2.webm' },
      ]
      mockPrisma.meetingTranscript.findMany.mockResolvedValue(expired)
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      mockPrisma.meetingTranscript.updateMany.mockResolvedValue({ count: 2 })

      await service.purgeExpiredAudio()

      expect(fs.existsSync).toHaveBeenCalledWith('/uploads/t1.webm')
      expect(fs.existsSync).toHaveBeenCalledWith('/uploads/t2.webm')
      expect(fs.unlinkSync).toHaveBeenCalledWith('/uploads/t1.webm')
      expect(fs.unlinkSync).toHaveBeenCalledWith('/uploads/t2.webm')
    })

    it('skips fs.unlinkSync when the file no longer exists on disk', async () => {
      configGet.mockReturnValue('90')
      mockPrisma.meetingTranscript.findMany.mockResolvedValue([{ id: 't1', audioPath: '/uploads/t1.webm' }])
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)
      mockPrisma.meetingTranscript.updateMany.mockResolvedValue({ count: 1 })

      await service.purgeExpiredAudio()

      expect(fs.existsSync).toHaveBeenCalled()
      expect(fs.unlinkSync).not.toHaveBeenCalled()
    })

    it('swallows fs.unlinkSync errors (file already gone)', async () => {
      configGet.mockReturnValue('90')
      mockPrisma.meetingTranscript.findMany.mockResolvedValue([{ id: 't1', audioPath: '/uploads/t1.webm' }])
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.unlinkSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT')
      })
      mockPrisma.meetingTranscript.updateMany.mockResolvedValue({ count: 1 })

      await expect(service.purgeExpiredAudio()).resolves.toBeUndefined()
      expect(mockPrisma.meetingTranscript.updateMany).toHaveBeenCalled()
    })

    it('skips fs operations when audioPath is null on the row', async () => {
      // Defensive: select filter already excludes null paths, but the loop
      // still guards with `if (t.audioPath && ...)`.
      configGet.mockReturnValue('90')
      mockPrisma.meetingTranscript.findMany.mockResolvedValue([{ id: 't1', audioPath: null }])
      mockPrisma.meetingTranscript.updateMany.mockResolvedValue({ count: 1 })

      await service.purgeExpiredAudio()

      expect(fs.existsSync).not.toHaveBeenCalled()
      expect(fs.unlinkSync).not.toHaveBeenCalled()
    })

    it('nulls audioPath/audioMimeType/audioSize on every expired row in ONE updateMany', async () => {
      configGet.mockReturnValue('90')
      const expired = [
        { id: 't1', audioPath: '/uploads/t1.webm' },
        { id: 't2', audioPath: '/uploads/t2.webm' },
        { id: 't3', audioPath: '/uploads/t3.webm' },
      ]
      mockPrisma.meetingTranscript.findMany.mockResolvedValue(expired)
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      mockPrisma.meetingTranscript.updateMany.mockResolvedValue({ count: 3 })

      await service.purgeExpiredAudio()

      expect(mockPrisma.meetingTranscript.updateMany).toHaveBeenCalledTimes(1)
      expect(mockPrisma.meetingTranscript.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['t1', 't2', 't3'] } },
        data: { audioPath: null, audioMimeType: null, audioSize: null },
      })
    })
  })
})
