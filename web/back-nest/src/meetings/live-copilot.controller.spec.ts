import { LiveCopilotController } from './live-copilot.controller.js'
import { BadRequestException, NotFoundException } from '@nestjs/common'

function makeDeps() {
  return {
    service: {
      startSession: jest.fn(),
      appendTranscript: jest.fn(),
      fire: jest.fn(),
      recordItemAction: jest.fn(),
      getState: jest.fn(),
      endSession: jest.fn().mockResolvedValue(undefined),
    },
    gateway: {
      emitFireSkipped: jest.fn(),
      emitMeetingState: jest.fn(),
      emitCoverage: jest.fn(),
    },
    config: { get: jest.fn().mockReturnValue('on') },
    prisma: { projectField: { findMany: jest.fn().mockResolvedValue([]) } },
  }
}

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, error })

describe('LiveCopilotController', () => {
  let ctrl: LiveCopilotController
  let d: ReturnType<typeof makeDeps>

  beforeEach(() => {
    d = makeDeps()
    ctrl = new LiveCopilotController(
      d.service as unknown as never,
      d.gateway as unknown as never,
      d.config as unknown as never,
      d.prisma as unknown as never,
    )
  })

  describe('feature flag gate', () => {
    it('every route 404s when LIVE_MEETING_COPILOT is off', async () => {
      d.config.get.mockReturnValue('off')
      await expect(ctrl.listDrivers('p1')).rejects.toThrow(NotFoundException)
      await expect(
        ctrl.startSession('p1', { liveSessionId: 's', meetingType: undefined } as never, { userId: 'u', role: 'PM' }),
      ).rejects.toThrow(NotFoundException)
      await expect(ctrl.append('p1', { liveSessionId: 's', chunk: 'x' } as never)).rejects.toThrow(NotFoundException)
      await expect(ctrl.fire('p1', { liveSessionId: 's' } as never)).rejects.toThrow(NotFoundException)
      await expect(
        ctrl.askItem('p1', 'i1', { liveSessionId: 's', itemId: 'i1' } as never),
      ).rejects.toThrow(NotFoundException)
      await expect(
        ctrl.dismissItem('p1', 'i1', { liveSessionId: 's', itemId: 'i1' } as never),
      ).rejects.toThrow(NotFoundException)
      await expect(ctrl.endSession({ liveSessionId: 's' } as never)).rejects.toThrow(NotFoundException)
    })
  })

  describe('listDrivers', () => {
    it('returns driver field snapshot', async () => {
      d.prisma.projectField.findMany.mockResolvedValue([
        { label: 'Stack', values: [{ value: 'NestJS' }], isBacklogDriver: true },
        { label: 'Budget', values: [], isBacklogDriver: true },
      ])
      const out = await ctrl.listDrivers('p1')
      expect(out.items).toEqual([
        { label: 'Stack', value: 'NestJS', isBacklogDriver: true },
        { label: 'Budget', value: null, isBacklogDriver: true },
      ])
    })
  })

  describe('startSession', () => {
    it('returns liveSessionId on success', async () => {
      d.service.startSession.mockReturnValue(ok({ meetingType: 'kickoff' }))
      const out = await ctrl.startSession('p1', { liveSessionId: 's1', meetingType: 'kickoff' } as never, { userId: 'u-1', role: 'PM' })
      expect(d.service.startSession).toHaveBeenCalledWith('p1', 's1', 'u-1', 'kickoff')
      expect(out).toEqual({ liveSessionId: 's1', started: true, meetingType: 'kickoff' })
    })

    it('throws 400 on Result.fail', async () => {
      d.service.startSession.mockReturnValue(fail('busy'))
      await expect(
        ctrl.startSession('p1', { liveSessionId: 's1', meetingType: undefined } as never, { userId: 'u-1', role: 'PM' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('append', () => {
    it('forwards args and returns service value', async () => {
      d.service.appendTranscript.mockReturnValue(ok({ buffered: 100 }))
      const out = await ctrl.append('p1', { liveSessionId: 's', chunk: 'hello' } as never)
      expect(d.service.appendTranscript).toHaveBeenCalledWith('s', 'hello')
      expect(out).toEqual({ buffered: 100 })
    })

    it('400 on fail', async () => {
      d.service.appendTranscript.mockReturnValue(fail('no session'))
      await expect(ctrl.append('p1', { liveSessionId: 's', chunk: 'x' } as never)).rejects.toThrow(BadRequestException)
    })
  })

  describe('fire (async, non-blocking)', () => {
    it('returns 202 immediately and emits meeting state on success', async () => {
      d.service.fire.mockResolvedValue(
        ok({
          skipped: false,
          checklist: [
            { itemId: 'i1', status: 'covered', section: 'contexte' },
            { itemId: 'i2', status: 'missing', section: 'budget' },
          ],
          hint: 'go',
          readyForCahier: false,
        }),
      )
      const out = await ctrl.fire('p1', { liveSessionId: 's1' } as never)
      expect(out).toEqual({ accepted: true })
      // Wait one microtask cycle so the .then() chain runs.
      await new Promise((r) => setImmediate(r))
      expect(d.gateway.emitMeetingState).toHaveBeenCalledWith('p1', 's1', expect.objectContaining({ hint: 'go' }))
      expect(d.gateway.emitCoverage).toHaveBeenCalledWith('p1', 's1', ['contexte'])
    })

    it('emits skipped when service returns skipped:true', async () => {
      d.service.fire.mockResolvedValue(ok({ skipped: true, skipReason: 'cooldown', checklist: [] }))
      await ctrl.fire('p1', { liveSessionId: 's1' } as never)
      await new Promise((r) => setImmediate(r))
      expect(d.gateway.emitFireSkipped).toHaveBeenCalledWith('p1', 's1', 'cooldown')
      expect(d.gateway.emitMeetingState).not.toHaveBeenCalled()
    })

    it("emits 'provider' skip when service rejects", async () => {
      d.service.fire.mockRejectedValue(new Error('429'))
      await ctrl.fire('p1', { liveSessionId: 's1' } as never)
      await new Promise((r) => setImmediate(r))
      expect(d.gateway.emitFireSkipped).toHaveBeenCalledWith('p1', 's1', 'provider')
    })

    it('does nothing further when service returns Result.fail', async () => {
      d.service.fire.mockResolvedValue(fail('no session'))
      await ctrl.fire('p1', { liveSessionId: 's1' } as never)
      await new Promise((r) => setImmediate(r))
      expect(d.gateway.emitMeetingState).not.toHaveBeenCalled()
      expect(d.gateway.emitCoverage).not.toHaveBeenCalled()
      expect(d.gateway.emitFireSkipped).not.toHaveBeenCalled()
    })

    it("skips emitCoverage when checklist has only 'missing' items", async () => {
      d.service.fire.mockResolvedValue(
        ok({ skipped: false, checklist: [{ itemId: 'i', status: 'missing', section: 'x' }], hint: null, readyForCahier: false }),
      )
      await ctrl.fire('p1', { liveSessionId: 's1' } as never)
      await new Promise((r) => setImmediate(r))
      expect(d.gateway.emitMeetingState).toHaveBeenCalled()
      expect(d.gateway.emitCoverage).not.toHaveBeenCalled()
    })
  })

  describe('askItem / dismissItem', () => {
    it('rejects when itemId param mismatches body.itemId', async () => {
      await expect(
        ctrl.askItem('p1', 'real', { liveSessionId: 's', itemId: 'spoof' } as never),
      ).rejects.toThrow(BadRequestException)
      await expect(
        ctrl.dismissItem('p1', 'real', { liveSessionId: 's', itemId: 'spoof' } as never),
      ).rejects.toThrow(BadRequestException)
    })

    it('happy path emits meeting state and returns ok', async () => {
      d.service.recordItemAction.mockResolvedValue(
        ok({ checklist: [{ itemId: 'i1', status: 'asked', section: 'c' }] }),
      )
      d.service.getState.mockReturnValue({ hint: 'h', readyForCahier: true })
      const out = await ctrl.askItem('p1', 'i1', { liveSessionId: 's', itemId: 'i1' } as never)
      expect(d.service.recordItemAction).toHaveBeenCalledWith('s', 'i1', 'asked')
      expect(d.gateway.emitMeetingState).toHaveBeenCalledWith('p1', 's', {
        checklist: [{ itemId: 'i1', status: 'asked', section: 'c' }],
        hint: 'h',
        readyForCahier: true,
      })
      expect(out).toEqual({ ok: true })
    })

    it("doesn't emit when state is missing on getState (null fallback)", async () => {
      d.service.recordItemAction.mockResolvedValue(ok({ checklist: [] }))
      d.service.getState.mockReturnValue(undefined)
      await ctrl.askItem('p1', 'i1', { liveSessionId: 's', itemId: 'i1' } as never)
      const callArgs = d.gateway.emitMeetingState.mock.calls[0][2]
      expect(callArgs.hint).toBeNull()
      expect(callArgs.readyForCahier).toBe(false)
    })

    it('404 on service failure', async () => {
      d.service.recordItemAction.mockResolvedValue(fail('not found'))
      await expect(
        ctrl.askItem('p1', 'i1', { liveSessionId: 's', itemId: 'i1' } as never),
      ).rejects.toThrow(NotFoundException)
      await expect(
        ctrl.dismissItem('p1', 'i1', { liveSessionId: 's', itemId: 'i1' } as never),
      ).rejects.toThrow(NotFoundException)
    })

    it("doesn't emit state when service returns r.value=null", async () => {
      d.service.recordItemAction.mockResolvedValue(ok(null))
      const out = await ctrl.dismissItem('p1', 'i1', { liveSessionId: 's', itemId: 'i1' } as never)
      expect(d.gateway.emitMeetingState).not.toHaveBeenCalled()
      expect(out).toEqual({ ok: true })
    })
  })

  describe('endSession', () => {
    it('delegates with the optional meetingTranscriptId', async () => {
      await ctrl.endSession({ liveSessionId: 's1', meetingTranscriptId: 't1' } as never)
      expect(d.service.endSession).toHaveBeenCalledWith('s1', 't1')
    })

    it('defaults meetingTranscriptId to null', async () => {
      await ctrl.endSession({ liveSessionId: 's1' } as never)
      expect(d.service.endSession).toHaveBeenCalledWith('s1', null)
    })
  })
})
