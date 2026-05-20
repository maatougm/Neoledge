import { MeetingExtrasController } from './meeting-extras.controller.js'
import { BadRequestException } from '@nestjs/common'

function makeServices(): {
  agenda: Record<string, jest.Mock>
  attendees: Record<string, jest.Mock>
  outcomes: Record<string, jest.Mock>
} {
  return {
    agenda: { list: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), reorder: jest.fn() },
    attendees: { list: jest.fn(), add: jest.fn(), update: jest.fn(), remove: jest.fn(), bulkMarkPresent: jest.fn() },
    outcomes: { list: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), convertToWorkPackage: jest.fn() },
  }
}

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, error })

describe('MeetingExtrasController', () => {
  let ctrl: MeetingExtrasController
  let s: ReturnType<typeof makeServices>

  beforeEach(() => {
    s = makeServices()
    ctrl = new MeetingExtrasController(
      s.agenda as unknown as never,
      s.attendees as unknown as never,
      s.outcomes as unknown as never,
    )
  })

  // ─── Agenda ───────────────────────────────────────────────────────────────
  describe('agenda', () => {
    it('list happy + fail', async () => {
      s.agenda.list.mockResolvedValueOnce(ok([{ id: 'a1' }]))
      expect(await ctrl.listAgenda('m1')).toEqual([{ id: 'a1' }])
      s.agenda.list.mockResolvedValueOnce(fail('x'))
      await expect(ctrl.listAgenda('m1')).rejects.toThrow(BadRequestException)
    })

    it('add rejects empty title', async () => {
      await expect(ctrl.addAgenda('m1', { title: '   ' })).rejects.toThrow('Titre requis')
    })
    it('add happy + fail', async () => {
      s.agenda.create.mockResolvedValueOnce(ok({ id: 'a1', title: 'X' }))
      expect(await ctrl.addAgenda('m1', { title: 'X' })).toEqual({ id: 'a1', title: 'X' })
      s.agenda.create.mockResolvedValueOnce(fail('boom'))
      await expect(ctrl.addAgenda('m1', { title: 'Y' })).rejects.toThrow(BadRequestException)
    })

    it('update happy + fail', async () => {
      s.agenda.update.mockResolvedValueOnce(ok({ id: 'a1' }))
      expect(await ctrl.updateAgenda('a1', { title: 'X' })).toEqual({ id: 'a1' })
      s.agenda.update.mockResolvedValueOnce(fail('e'))
      await expect(ctrl.updateAgenda('a1', {})).rejects.toThrow(BadRequestException)
    })

    it('delete happy + fail', async () => {
      s.agenda.delete.mockResolvedValueOnce(ok(undefined))
      await expect(ctrl.deleteAgenda('a1')).resolves.toBeUndefined()
      s.agenda.delete.mockResolvedValueOnce(fail('gone'))
      await expect(ctrl.deleteAgenda('a1')).rejects.toThrow(BadRequestException)
    })

    it('reorder happy + fail', async () => {
      s.agenda.reorder.mockResolvedValueOnce(ok(undefined))
      expect(await ctrl.reorderAgenda('m1', { order: ['a', 'b'] })).toEqual({ success: true })
      s.agenda.reorder.mockResolvedValueOnce(fail('bad'))
      await expect(ctrl.reorderAgenda('m1', { order: [] })).rejects.toThrow(BadRequestException)
    })
  })

  // ─── Attendees ────────────────────────────────────────────────────────────
  describe('attendees', () => {
    it('list happy + fail', async () => {
      s.attendees.list.mockResolvedValueOnce(ok([]))
      expect(await ctrl.listAttendees('m1')).toEqual([])
      s.attendees.list.mockResolvedValueOnce(fail('x'))
      await expect(ctrl.listAttendees('m1')).rejects.toThrow(BadRequestException)
    })

    it('add happy + fail', async () => {
      s.attendees.add.mockResolvedValueOnce(ok({ id: 'at1' }))
      expect(await ctrl.addAttendee('m1', { userId: 'u1' })).toEqual({ id: 'at1' })
      s.attendees.add.mockResolvedValueOnce(fail('dup'))
      await expect(ctrl.addAttendee('m1', { userId: 'u1' })).rejects.toThrow(BadRequestException)
    })

    it('update happy + fail', async () => {
      s.attendees.update.mockResolvedValueOnce(ok({ id: 'at1', isPresent: true }))
      expect(await ctrl.updateAttendee('at1', { isPresent: true })).toEqual({ id: 'at1', isPresent: true })
      s.attendees.update.mockResolvedValueOnce(fail('x'))
      await expect(ctrl.updateAttendee('at1', {})).rejects.toThrow(BadRequestException)
    })

    it('remove happy + fail', async () => {
      s.attendees.remove.mockResolvedValueOnce(ok(undefined))
      await expect(ctrl.removeAttendee('at1')).resolves.toBeUndefined()
      s.attendees.remove.mockResolvedValueOnce(fail('gone'))
      await expect(ctrl.removeAttendee('at1')).rejects.toThrow(BadRequestException)
    })

    it('bulkMark happy + fail', async () => {
      s.attendees.bulkMarkPresent.mockResolvedValueOnce(ok(undefined))
      expect(await ctrl.bulkMark('m1', { ids: ['a', 'b'], isPresent: true })).toEqual({ success: true })
      s.attendees.bulkMarkPresent.mockResolvedValueOnce(fail('x'))
      await expect(ctrl.bulkMark('m1', { ids: [], isPresent: false })).rejects.toThrow(BadRequestException)
    })
  })

  // ─── Outcomes ─────────────────────────────────────────────────────────────
  describe('outcomes', () => {
    it('list passes optional type filter', async () => {
      s.outcomes.list.mockResolvedValue(ok([]))
      await ctrl.listOutcomes('m1', 'risk')
      expect(s.outcomes.list).toHaveBeenCalledWith('m1', 'risk')
      await ctrl.listOutcomes('m1')
      expect(s.outcomes.list).toHaveBeenLastCalledWith('m1', undefined)
    })

    it('list 400 on failure', async () => {
      s.outcomes.list.mockResolvedValueOnce(fail('x'))
      await expect(ctrl.listOutcomes('m1')).rejects.toThrow(BadRequestException)
    })

    it('add rejects missing fields', async () => {
      await expect(ctrl.addOutcome('m1', { type: 'risk', description: '  ' })).rejects.toThrow('Description')
      await expect(ctrl.addOutcome('m1', { type: '', description: 'X' })).rejects.toThrow('Type')
    })

    it('add happy + fail', async () => {
      s.outcomes.create.mockResolvedValueOnce(ok({ id: 'o1' }))
      expect(await ctrl.addOutcome('m1', { type: 'risk', description: 'X' })).toEqual({ id: 'o1' })
      s.outcomes.create.mockResolvedValueOnce(fail('y'))
      await expect(ctrl.addOutcome('m1', { type: 'risk', description: 'X' })).rejects.toThrow(BadRequestException)
    })

    it('update happy + fail', async () => {
      s.outcomes.update.mockResolvedValueOnce(ok({ id: 'o1', description: 'Y' }))
      expect(await ctrl.updateOutcome('o1', { description: 'Y' })).toEqual({ id: 'o1', description: 'Y' })
      s.outcomes.update.mockResolvedValueOnce(fail('x'))
      await expect(ctrl.updateOutcome('o1', {})).rejects.toThrow(BadRequestException)
    })

    it('remove happy + fail', async () => {
      s.outcomes.delete.mockResolvedValueOnce(ok(undefined))
      await expect(ctrl.removeOutcome('o1')).resolves.toBeUndefined()
      s.outcomes.delete.mockResolvedValueOnce(fail('gone'))
      await expect(ctrl.removeOutcome('o1')).rejects.toThrow(BadRequestException)
    })

    it('convertToWp passes projectId + userId', async () => {
      s.outcomes.convertToWorkPackage.mockResolvedValueOnce(ok({ wpId: 'wp1' }))
      const out = await ctrl.convertToWp('p1', 'o1', { userId: 'u-1' })
      expect(s.outcomes.convertToWorkPackage).toHaveBeenCalledWith('o1', 'p1', 'u-1')
      expect(out).toEqual({ wpId: 'wp1' })
    })

    it('convertToWp 400 on fail', async () => {
      s.outcomes.convertToWorkPackage.mockResolvedValueOnce(fail('boom'))
      await expect(ctrl.convertToWp('p1', 'o1', { userId: 'u-1' })).rejects.toThrow(BadRequestException)
    })
  })
})
