import { MeetingsController } from './meetings.controller.js'
import { BadRequestException, NotFoundException, StreamableFile } from '@nestjs/common'

// Stub the fs read-stream so getAudioFile doesn't actually open a file.
jest.mock('fs', () => ({ createReadStream: jest.fn(() => 'mock-stream') }))

function makeService(): Record<string, jest.Mock> {
  return {
    transcribe: jest.fn(),
    getByProject: jest.fn(),
    getById: jest.fn(),
    deleteTranscript: jest.fn(),
    renameSpeaker: jest.fn(),
    triggerAiAnalysis: jest.fn(),
    getAiResults: jest.fn(),
    attachAudio: jest.fn(),
    redoDiarization: jest.fn().mockResolvedValue({ isSuccess: true, value: undefined }),
    setAudioPreserved: jest.fn(),
    getAudioFile: jest.fn(),
    convertActionItemsToWPs: jest.fn(),
  }
}

// Real ID3 magic + zero padding so isAudioBuffer accepts it.
function validAudioBuffer(): Buffer {
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33]), Buffer.alloc(32)])
}

describe('MeetingsController', () => {
  let controller: MeetingsController
  let service: ReturnType<typeof makeService>

  beforeEach(() => {
    service = makeService()
    controller = new MeetingsController(service as unknown as never)
  })

  describe('upload', () => {
    it('rejects empty audio', async () => {
      await expect(controller.upload('p1', undefined as never, 'meeting')).rejects.toThrow(BadRequestException)
    })

    it('rejects bogus audio buffer (non-magic)', async () => {
      const bad = { buffer: Buffer.from('not audio bytes here at all xx') } as Express.Multer.File
      await expect(controller.upload('p1', bad, 'meeting')).rejects.toThrow('Format audio non supporté')
    })

    it('rejects empty title', async () => {
      const good = { buffer: validAudioBuffer() } as Express.Multer.File
      await expect(controller.upload('p1', good, '   ')).rejects.toThrow('Le titre')
    })

    it('rejects too-long title', async () => {
      const good = { buffer: validAudioBuffer() } as Express.Multer.File
      await expect(controller.upload('p1', good, 'x'.repeat(201))).rejects.toThrow('dépasser 200')
    })

    it('forwards to service.transcribe on the happy path and returns value', async () => {
      const good = { buffer: validAudioBuffer(), originalname: 'meeting.mp3' } as Express.Multer.File
      service.transcribe.mockResolvedValue({ isSuccess: true, isFailure: false, value: { transcriptId: 't1' } })
      const out = await controller.upload('p1', good, 'Kickoff')
      expect(service.transcribe).toHaveBeenCalledWith('p1', good.buffer, 'meeting.mp3', 'Kickoff')
      expect(out).toEqual({ transcriptId: 't1' })
    })

    it('throws BadRequest when service returns Result.fail', async () => {
      const good = { buffer: validAudioBuffer(), originalname: 'm.mp3' } as Express.Multer.File
      service.transcribe.mockResolvedValue({ isSuccess: false, isFailure: true, error: 'STT broken' })
      await expect(controller.upload('p1', good, 'Kickoff')).rejects.toThrow('STT broken')
    })
  })

  describe('getByProject / getById', () => {
    it('returns value from service.getByProject', async () => {
      service.getByProject.mockResolvedValue({ value: [{ id: 'm1' }] })
      const out = await controller.getByProject('p1')
      expect(out).toEqual([{ id: 'm1' }])
    })

    it('getById throws NotFound on failure', async () => {
      service.getById.mockResolvedValue({ isSuccess: false, isFailure: true, error: 'not found' })
      await expect(controller.getById('m1')).rejects.toThrow(NotFoundException)
    })

    it('getById returns value on success', async () => {
      service.getById.mockResolvedValue({ isSuccess: true, isFailure: false, value: { id: 'm1' } })
      expect(await controller.getById('m1')).toEqual({ id: 'm1' })
    })
  })

  describe('delete', () => {
    it('succeeds when service returns Result.ok', async () => {
      service.deleteTranscript.mockResolvedValue({ isSuccess: true, isFailure: false })
      await expect(controller.delete('m1')).resolves.toBeUndefined()
    })
    it('throws NotFound on Result.fail', async () => {
      service.deleteTranscript.mockResolvedValue({ isSuccess: false, isFailure: true, error: 'missing' })
      await expect(controller.delete('m1')).rejects.toThrow(NotFoundException)
    })
  })

  describe('renameSpeaker', () => {
    it('rejects when names are missing/empty', async () => {
      await expect(controller.renameSpeaker('m1', { oldName: '', newName: 'X' }, { userId: 'u' } as never)).rejects.toThrow(BadRequestException)
      await expect(controller.renameSpeaker('m1', { oldName: 'X', newName: '' }, { userId: 'u' } as never)).rejects.toThrow(BadRequestException)
    })

    it('rejects newName > 100 chars', async () => {
      await expect(controller.renameSpeaker('m1', { oldName: 'A', newName: 'x'.repeat(101) }, { userId: 'u' } as never)).rejects.toThrow('100')
    })

    it('forwards on happy path', async () => {
      service.renameSpeaker.mockResolvedValue({ isSuccess: true, isFailure: false })
      await controller.renameSpeaker('m1', { oldName: 'A', newName: 'B' }, { userId: 'u-1' } as never)
      expect(service.renameSpeaker).toHaveBeenCalledWith('m1', 'A', 'B', 'u-1')
    })

    it('throws NotFound on failure', async () => {
      service.renameSpeaker.mockResolvedValue({ isSuccess: false, isFailure: true, error: 'missing' })
      await expect(controller.renameSpeaker('m1', { oldName: 'A', newName: 'B' }, { userId: 'u' } as never)).rejects.toThrow(NotFoundException)
    })
  })

  describe('aiAnalyze / getAiResults', () => {
    it('aiAnalyze returns value on success', async () => {
      service.triggerAiAnalysis.mockResolvedValue({ isSuccess: true, isFailure: false, value: { status: 'processing' } })
      expect(await controller.aiAnalyze('m1')).toEqual({ status: 'processing' })
    })
    it('aiAnalyze 404 on failure', async () => {
      service.triggerAiAnalysis.mockResolvedValue({ isSuccess: false, isFailure: true, error: 'gone' })
      await expect(controller.aiAnalyze('m1')).rejects.toThrow(NotFoundException)
    })
    it('getAiResults success path', async () => {
      service.getAiResults.mockResolvedValue({ isSuccess: true, isFailure: false, value: { summary: 'X' } })
      expect(await controller.getAiResults('m1')).toEqual({ summary: 'X' })
    })
    it('getAiResults 404 on failure', async () => {
      service.getAiResults.mockResolvedValue({ isSuccess: false, isFailure: true, error: 'gone' })
      await expect(controller.getAiResults('m1')).rejects.toThrow(NotFoundException)
    })
  })

  describe('attachAudio', () => {
    it('rejects empty audio', async () => {
      await expect(controller.attachAudio('p1', 'm1', undefined as never)).rejects.toThrow(BadRequestException)
    })

    it('happy path: calls service.attachAudio + fire-and-forget redoDiarization', async () => {
      service.attachAudio.mockResolvedValue({ isSuccess: true, isFailure: false, value: { ok: true } })
      const audio = { buffer: validAudioBuffer(), mimetype: 'audio/webm' } as Express.Multer.File
      const out = await controller.attachAudio('p1', 'm1', audio)
      expect(service.attachAudio).toHaveBeenCalledWith('p1', 'm1', audio.buffer, 'audio/webm')
      expect(service.redoDiarization).toHaveBeenCalledWith('m1')
      expect(out).toEqual({ ok: true })
    })

    it('defaults mimetype when missing', async () => {
      service.attachAudio.mockResolvedValue({ isSuccess: true, isFailure: false, value: { ok: true } })
      const audio = { buffer: validAudioBuffer() } as Express.Multer.File
      await controller.attachAudio('p1', 'm1', audio)
      expect(service.attachAudio).toHaveBeenCalledWith('p1', 'm1', audio.buffer, 'audio/webm')
    })

    it('400 on service failure', async () => {
      service.attachAudio.mockResolvedValue({ isSuccess: false, isFailure: true, error: 'fs full' })
      const audio = { buffer: validAudioBuffer(), mimetype: 'audio/webm' } as Express.Multer.File
      await expect(controller.attachAudio('p1', 'm1', audio)).rejects.toThrow('fs full')
    })

    it('silently swallows a redoDiarization rejection', async () => {
      service.attachAudio.mockResolvedValue({ isSuccess: true, isFailure: false, value: { ok: true } })
      service.redoDiarization.mockRejectedValue(new Error('whisper down'))
      const audio = { buffer: validAudioBuffer(), mimetype: 'audio/webm' } as Express.Multer.File
      await expect(controller.attachAudio('p1', 'm1', audio)).resolves.toEqual({ ok: true })
    })
  })

  describe('setPreserve', () => {
    it('coerces missing body to false and forwards', async () => {
      service.setAudioPreserved.mockResolvedValue({ isSuccess: true, isFailure: false, value: { preserved: false } })
      await controller.setPreserve('m1', {})
      expect(service.setAudioPreserved).toHaveBeenCalledWith('m1', false)
    })
    it('coerces truthy body and forwards', async () => {
      service.setAudioPreserved.mockResolvedValue({ isSuccess: true, isFailure: false, value: { preserved: true } })
      await controller.setPreserve('m1', { preserved: true })
      expect(service.setAudioPreserved).toHaveBeenCalledWith('m1', true)
    })
    it('404 on failure', async () => {
      service.setAudioPreserved.mockResolvedValue({ isSuccess: false, isFailure: true, error: 'gone' })
      await expect(controller.setPreserve('m1', {})).rejects.toThrow(NotFoundException)
    })
  })

  describe('streamAudio', () => {
    it('returns a StreamableFile with content headers', async () => {
      service.getAudioFile.mockResolvedValue({
        isSuccess: true, isFailure: false,
        value: { path: '/x.mp3', mimeType: 'audio/mpeg', size: 12345 },
      })
      const res = { set: jest.fn() }
      const out = await controller.streamAudio('m1', res as never)
      const headers = res.set.mock.calls[0][0]
      expect(headers['Content-Type']).toBe('audio/mpeg')
      expect(headers['Content-Length']).toBe('12345')
      expect(out).toBeInstanceOf(StreamableFile)
    })

    it('404 when audio missing', async () => {
      service.getAudioFile.mockResolvedValue({ isSuccess: false, isFailure: true, error: 'gone' })
      const res = { set: jest.fn() }
      await expect(controller.streamAudio('m1', res as never)).rejects.toThrow(NotFoundException)
    })
  })

  describe('convertActionItems', () => {
    it('rejects empty list', async () => {
      await expect(
        controller.convertActionItems('p1', 'm1', { actionItemIds: [] }, { userId: 'u-1' }),
      ).rejects.toThrow('Aucun élément')
    })

    it('caps to 50 ids and forwards null sprintId', async () => {
      service.convertActionItemsToWPs.mockResolvedValue({ isSuccess: true, isFailure: false, value: { created: 3 } })
      const ids = Array.from({ length: 100 }, (_, i) => `a-${i}`)
      await controller.convertActionItems('p1', 'm1', { actionItemIds: ids }, { userId: 'u-1' })
      const [, , passedIds, , sprintId] = service.convertActionItemsToWPs.mock.calls[0]
      expect((passedIds as string[]).length).toBe(50)
      expect(sprintId).toBeNull()
    })

    it('forwards sprintId when provided', async () => {
      service.convertActionItemsToWPs.mockResolvedValue({ isSuccess: true, isFailure: false, value: { created: 1 } })
      await controller.convertActionItems('p1', 'm1', { actionItemIds: ['a1'], sprintId: 's-7' }, { userId: 'u' })
      expect(service.convertActionItemsToWPs.mock.calls[0][4]).toBe('s-7')
    })

    it('400 on service failure', async () => {
      service.convertActionItemsToWPs.mockResolvedValue({ isSuccess: false, isFailure: true, error: 'invalid' })
      await expect(
        controller.convertActionItems('p1', 'm1', { actionItemIds: ['a1'] }, { userId: 'u' }),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
