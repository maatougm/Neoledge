import { LiveMeetingController } from './live-meeting.controller.js'
import { BadRequestException } from '@nestjs/common'

describe('LiveMeetingController', () => {
  let controller: LiveMeetingController
  let service: { transcribeChunk: jest.Mock; saveLiveTranscript: jest.Mock }

  beforeEach(() => {
    service = { transcribeChunk: jest.fn(), saveLiveTranscript: jest.fn() }
    controller = new LiveMeetingController(service as unknown as never)
  })

  describe('transcribeChunk', () => {
    it('rejects empty audio', async () => {
      await expect(controller.transcribeChunk(undefined as never)).rejects.toThrow(BadRequestException)
    })

    it('rejects an audio file with zero bytes', async () => {
      const audio = { buffer: Buffer.alloc(0), mimetype: 'audio/webm' } as Express.Multer.File
      await expect(controller.transcribeChunk(audio)).rejects.toThrow(BadRequestException)
    })

    it('forwards buffer + mimetype to service', async () => {
      const audio = { buffer: Buffer.from('abc'), mimetype: 'audio/ogg' } as Express.Multer.File
      service.transcribeChunk.mockResolvedValue({ text: 'hi', language: 'fr' })
      const out = await controller.transcribeChunk(audio)
      expect(service.transcribeChunk).toHaveBeenCalledWith(audio.buffer, 'audio/ogg')
      expect(out).toEqual({ text: 'hi', language: 'fr' })
    })

    it("defaults mimetype to audio/webm when missing", async () => {
      const audio = { buffer: Buffer.from('abc') } as Express.Multer.File
      service.transcribeChunk.mockResolvedValue({ text: '', language: null })
      await controller.transcribeChunk(audio)
      expect(service.transcribeChunk).toHaveBeenCalledWith(audio.buffer, 'audio/webm')
    })
  })

  describe('save', () => {
    it('forwards trimmed-string + numeric defaults', async () => {
      service.saveLiveTranscript.mockResolvedValue({ transcriptId: 't1' })
      const out = await controller.save('p1', {
        title: 'My Meeting',
        transcript: 'a long transcript more than 20 chars please',
        durationSeconds: 600,
        meetingType: 'kickoff',
        detectedLanguages: ['fr', 'en'],
      })
      expect(service.saveLiveTranscript).toHaveBeenCalledWith(
        'p1', 'My Meeting',
        'a long transcript more than 20 chars please',
        600, 'kickoff', ['fr', 'en'],
      )
      expect(out).toEqual({ transcriptId: 't1' })
    })

    it('coerces missing body fields to sensible defaults', async () => {
      service.saveLiveTranscript.mockResolvedValue({ transcriptId: 't2' })
      await controller.save('p1', {})
      expect(service.saveLiveTranscript).toHaveBeenCalledWith(
        'p1', 'Réunion en direct', '', 0, undefined, undefined,
      )
    })

    it('rejects non-string title via fallback', async () => {
      service.saveLiveTranscript.mockResolvedValue({ transcriptId: 't3' })
      await controller.save('p1', { title: 123 as unknown as string })
      expect(service.saveLiveTranscript).toHaveBeenCalledWith(
        'p1', 'Réunion en direct', '', 0, undefined, undefined,
      )
    })

    it('rejects non-array detectedLanguages via fallback', async () => {
      service.saveLiveTranscript.mockResolvedValue({ transcriptId: 't4' })
      await controller.save('p1', { detectedLanguages: 'fr' as unknown as string[] })
      const last = service.saveLiveTranscript.mock.calls[0]
      expect(last[5]).toBeUndefined()
    })
  })
})
