import { CahierDesChargesController } from './cahier-des-charges.controller.js'
import type { CahierStreamEvent } from './cahier-des-charges.types.js'

interface MockResponse {
  set: jest.Mock
  setHeader: jest.Mock
  send: jest.Mock
  write: jest.Mock
  end: jest.Mock
  flushHeaders: jest.Mock
  writableEnded: boolean
}

function makeRes(): MockResponse {
  return {
    set: jest.fn(),
    setHeader: jest.fn(),
    send: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    flushHeaders: jest.fn(),
    writableEnded: false,
  }
}

function makeReq(): { on: jest.Mock; _close?: () => void } {
  let close: (() => void) | undefined
  const req = {
    on: jest.fn((evt: string, cb: () => void) => {
      if (evt === 'close') close = cb
    }),
    get _close() { return close },
  }
  return req as never
}

function makeService(): Record<string, jest.Mock> {
  return {
    generateDocx: jest.fn(),
    runPreflight: jest.fn(),
    gatherProjectData: jest.fn(),
    generateCahierContent: jest.fn(),
    streamCahierContent: jest.fn(),
    isSectionStreamingEnabled: jest.fn().mockReturnValue(true),
    savePersistedCahier: jest.fn(),
    listVersions: jest.fn(),
    getVersion: jest.fn(),
    editCahierContent: jest.fn(),
    getPersistedCahier: jest.fn(),
    getCahierStatus: jest.fn(),
    saveFeedback: jest.fn(),
    getPastFeedback: jest.fn(),
  }
}

describe('CahierDesChargesController', () => {
  let controller: CahierDesChargesController
  let service: ReturnType<typeof makeService>

  beforeEach(() => {
    service = makeService()
    controller = new CahierDesChargesController(service as unknown as never)
  })

  describe('generateCahier (docx download)', () => {
    it('returns the docx buffer with the correct headers', async () => {
      const buffer = Buffer.from('PKdocx')
      service.generateDocx.mockResolvedValue({ buffer, fileName: 'Cahier des charges.docx' })
      const res = makeRes()

      await controller.generateCahier('proj-1', res as never)

      const headers = res.set.mock.calls[0][0]
      expect(headers['Content-Type']).toContain('wordprocessingml.document')
      expect(headers['Content-Disposition']).toContain('Cahier')
      expect(headers['Content-Length']).toBe(String(buffer.length))
      expect(headers['Cache-Control']).toContain('no-store')
      expect(res.send).toHaveBeenCalledWith(buffer)
    })

    it('propagates service errors', async () => {
      service.generateDocx.mockRejectedValue(new Error('boom'))
      await expect(controller.generateCahier('proj-1', makeRes() as never)).rejects.toThrow('boom')
    })
  })

  describe('preflightCahier', () => {
    it('delegates to service.runPreflight', async () => {
      service.runPreflight.mockResolvedValue({ readinessScore: 0.5, missingFields: [], answeredFields: [], canGenerate: true, computedAt: 1, source: 'ai' })
      const out = await controller.preflightCahier('proj-1')
      expect(service.runPreflight).toHaveBeenCalledWith('proj-1')
      expect(out.readinessScore).toBe(0.5)
    })
  })

  describe('previewCahier', () => {
    it('gathers project data, generates content, and wraps it with a timestamp', async () => {
      service.gatherProjectData.mockResolvedValue({ formData: { projectName: 'p' }, transcripts: [{ title: 't' }] })
      service.generateCahierContent.mockResolvedValue({ objectifDocument: 'x' })
      const out = await controller.previewCahier('proj-1')
      expect(out.formData).toEqual({ projectName: 'p' })
      expect(out.aiContent).toEqual({ objectifDocument: 'x' })
      expect(out.transcriptCount).toBe(1)
      expect(out.generatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
    })
  })

  describe('previewStream (SSE)', () => {
    it('emits SSE headers, calls streamCahierContent, and forwards events in order', async () => {
      const events: CahierStreamEvent[] = [
        { type: 'started', totalGroups: 3, transcriptCount: 1 },
        { type: 'section', group: 'intro', partial: {}, latencyMs: 10 },
        { type: 'complete', aiContent: {} as never, durationMs: 30 },
      ]
      service.gatherProjectData.mockResolvedValue({ formData: {}, transcripts: [{ title: 't' }] })
      service.streamCahierContent.mockImplementation(async (
        _fd: unknown,
        _tx: unknown,
        _pid: string,
        onEvent: (e: CahierStreamEvent) => void,
      ) => {
        for (const e of events) onEvent(e)
      })

      const res = makeRes()
      const req = makeReq()

      await controller.previewStream('proj-1', req as never, res as never)

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8')
      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive')
      expect(res.flushHeaders).toHaveBeenCalled()
      // Each event becomes two writes (event line + data line).
      const writes = res.write.mock.calls.map((c) => c[0])
      expect(writes.filter((w: string) => w.startsWith('event: started'))).toHaveLength(1)
      expect(writes.filter((w: string) => w.startsWith('event: section'))).toHaveLength(1)
      expect(writes.filter((w: string) => w.startsWith('event: complete'))).toHaveLength(1)
      const data = writes.filter((w: string) => w.startsWith('data: '))
      // data lines are valid JSON
      for (const d of data) {
        expect(() => JSON.parse(d.replace(/^data: /, '').trimEnd())).not.toThrow()
      }
      expect(res.end).toHaveBeenCalled()
    })

    it('flag-off path emits started + single complete via /preview', async () => {
      service.isSectionStreamingEnabled.mockReturnValue(false)
      service.gatherProjectData.mockResolvedValue({ formData: {}, transcripts: [] })
      service.generateCahierContent.mockResolvedValue({ ok: true })

      const res = makeRes()
      await controller.previewStream('proj-1', makeReq() as never, res as never)

      expect(service.streamCahierContent).not.toHaveBeenCalled()
      const writes = res.write.mock.calls.map((c) => c[0])
      expect(writes.find((w: string) => w.startsWith('event: started'))).toBeDefined()
      expect(writes.find((w: string) => w.startsWith('event: complete'))).toBeDefined()
      expect(res.end).toHaveBeenCalled()
    })

    it('emits error event when the service throws', async () => {
      service.gatherProjectData.mockRejectedValue(new Error('oops'))
      const res = makeRes()
      await controller.previewStream('proj-1', makeReq() as never, res as never)
      const writes = res.write.mock.calls.map((c) => c[0])
      expect(writes.find((w: string) => w.startsWith('event: error'))).toBeDefined()
      expect(res.end).toHaveBeenCalled()
    })

    it('aborter fires when req emits close before stream completes', async () => {
      service.gatherProjectData.mockResolvedValue({ formData: {}, transcripts: [] })
      let capturedSignal: AbortSignal | undefined
      service.streamCahierContent.mockImplementation(async (
        _fd: unknown,
        _tx: unknown,
        _pid: string,
        _onEvent: (e: CahierStreamEvent) => void,
        signal?: AbortSignal,
      ) => {
        capturedSignal = signal
      })

      const res = makeRes()
      const req = makeReq()

      const promise = controller.previewStream('proj-1', req as never, res as never)

      // Fire the close event synchronously to confirm wiring.
      const closeCb = (req as unknown as { _close?: () => void })._close
      expect(typeof closeCb).toBe('function')
      closeCb?.()
      await promise

      expect(capturedSignal?.aborted).toBe(true)
    })

    it('does not write to ended responses', async () => {
      service.gatherProjectData.mockResolvedValue({ formData: {}, transcripts: [] })
      service.streamCahierContent.mockImplementation(async (
        _fd: unknown,
        _tx: unknown,
        _pid: string,
        onEvent: (e: CahierStreamEvent) => void,
      ) => {
        onEvent({ type: 'started', totalGroups: 3, transcriptCount: 0 })
      })

      const res = makeRes()
      res.writableEnded = true // simulate already-ended
      await controller.previewStream('proj-1', makeReq() as never, res as never)
      // No write should happen on writableEnded=true via the onEvent guard.
      expect(res.write).not.toHaveBeenCalled()
      // res.end is guarded too, so should not be called either.
      expect(res.end).not.toHaveBeenCalled()
    })
  })

  describe('saveCahier', () => {
    it('extracts userId from req and forwards body.aiContent', async () => {
      await controller.saveCahier('proj-1', { aiContent: { ok: true } }, { user: { userId: 'u-1' } } as never)
      expect(service.savePersistedCahier).toHaveBeenCalledWith('proj-1', { ok: true }, 'u-1')
    })

    it("defaults userId to null when req.user is missing", async () => {
      await controller.saveCahier('proj-1', { aiContent: {} }, {} as never)
      expect(service.savePersistedCahier).toHaveBeenCalledWith('proj-1', {}, null)
    })
  })

  describe('listVersions / getVersion', () => {
    it('listVersions wraps service.listVersions output', async () => {
      service.listVersions.mockResolvedValue([{ id: 'v1' }, { id: 'v2' }])
      const out = await controller.listVersions('proj-1')
      expect(out).toEqual({ versions: [{ id: 'v1' }, { id: 'v2' }] })
    })

    it('getVersion returns {aiContent:null} when service returns null', async () => {
      service.getVersion.mockResolvedValue(null)
      const out = await controller.getVersion('proj-1', 'v-x')
      expect(out).toEqual({ aiContent: null })
    })

    it('getVersion forwards the version when found', async () => {
      service.getVersion.mockResolvedValue({ id: 'v1', aiContent: { x: 1 } })
      const out = await controller.getVersion('proj-1', 'v1')
      expect(out).toEqual({ id: 'v1', aiContent: { x: 1 } })
    })
  })

  describe('editContent', () => {
    it('forwards userId from req and body.aiContent', async () => {
      await controller.editContent('proj-1', { aiContent: { x: 1 } }, { user: { userId: 'u-7' } } as never)
      expect(service.editCahierContent).toHaveBeenCalledWith('proj-1', { x: 1 }, 'u-7')
    })

    it("defaults userId to null when req.user is missing", async () => {
      await controller.editContent('proj-1', { aiContent: {} }, {} as never)
      expect(service.editCahierContent).toHaveBeenCalledWith('proj-1', {}, null)
    })
  })

  describe('getSavedCahier / getStatus', () => {
    it('getSavedCahier delegates', async () => {
      service.getPersistedCahier.mockResolvedValue({ aiContent: null, savedAt: null })
      await controller.getSavedCahier('proj-1')
      expect(service.getPersistedCahier).toHaveBeenCalledWith('proj-1')
    })

    it('getStatus delegates', async () => {
      service.getCahierStatus.mockResolvedValue({ status: 'none' })
      await controller.getStatus('proj-1')
      expect(service.getCahierStatus).toHaveBeenCalledWith('proj-1')
    })
  })

  describe('submitFeedback', () => {
    it('trims the comment, forwards args, and returns the rejected-message variant', async () => {
      const out = await controller.submitFeedback(
        'proj-1',
        { status: 'rejected', comment: '  trim me  ', section: 'contexte' } as never,
        { user: { userId: 'u-1' } } as never,
      )
      expect(service.saveFeedback).toHaveBeenCalledWith('proj-1', 'u-1', 'rejected', 'trim me', 'contexte')
      expect(out.success).toBe(true)
      expect(out.message).toMatch(/prochaine génération/)
    })

    it('returns the approved-message variant', async () => {
      const out = await controller.submitFeedback(
        'proj-1',
        { status: 'approved', comment: 'looks good' } as never,
        { user: { userId: 'u-1' } } as never,
      )
      expect(out.message).toMatch(/Approbation/)
    })

    it("defaults userId to '' when req.user is missing", async () => {
      await controller.submitFeedback(
        'proj-1',
        { status: 'approved', comment: 'x' } as never,
        {} as never,
      )
      expect(service.saveFeedback).toHaveBeenCalledWith('proj-1', '', 'approved', 'x', undefined)
    })
  })

  describe('getFeedback', () => {
    it('wraps the service output in { feedback }', async () => {
      service.getPastFeedback.mockResolvedValue(['a', 'b'])
      const out = await controller.getFeedback('proj-1')
      expect(out).toEqual({ feedback: ['a', 'b'] })
    })
  })
})
