import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useMeetingExtrasStore } from './meetingExtrasStore'

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.patch.mockReset()
  mockedApi.delete.mockReset()
})

const agendaRow = { id: 'a1', meetingId: 'm1', title: 'Intro', duration: 5, responsibleId: null, position: 0, notes: null }
const attendeeRow = { id: 't1', meetingId: 'm1', userId: 'u1', externalName: null, externalEmail: null, isPresent: true, role: 'PM' }
const outcomeRow = { id: 'o1', meetingId: 'm1', type: 'Decision' as const, description: 'Go', ownerId: null, dueDate: null, workPackageId: null }

describe('meetingExtrasStore', () => {
  it('initial state empty', () => {
    const s = useMeetingExtrasStore()
    expect(s.agenda).toEqual([])
    expect(s.attendees).toEqual([])
    expect(s.outcomes).toEqual([])
    expect(s.error).toBeNull()
  })

  it('fetchAgenda stores rows', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [agendaRow] })
    const s = useMeetingExtrasStore()
    await s.fetchAgenda('p1', 'm1')
    expect(s.agenda).toEqual([agendaRow])
  })

  it('fetchAgenda rethrows on error', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('x'))
    const s = useMeetingExtrasStore()
    await expect(s.fetchAgenda('p1', 'm1')).rejects.toThrow('x')
    expect(s.error).toBe('x')
  })

  it('addAgenda appends the row', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: agendaRow })
    const s = useMeetingExtrasStore()
    await s.addAgenda('p1', 'm1', { title: 'Intro' })
    expect(s.agenda).toEqual([agendaRow])
  })

  it('updateAgenda replaces the matching slot', async () => {
    const patched = { ...agendaRow, title: 'Updated' }
    mockedApi.patch.mockResolvedValueOnce({ data: patched })
    const s = useMeetingExtrasStore()
    s.agenda = [agendaRow] as never
    await s.updateAgenda('p1', 'm1', 'a1', { title: 'Updated' })
    expect(s.agenda[0].title).toBe('Updated')
  })

  it('deleteAgenda filters out the row', async () => {
    mockedApi.delete.mockResolvedValueOnce({})
    const s = useMeetingExtrasStore()
    s.agenda = [agendaRow, { ...agendaRow, id: 'a2' }] as never
    await s.deleteAgenda('p1', 'm1', 'a1')
    expect(s.agenda.map((a: { id: string }) => a.id)).toEqual(['a2'])
  })

  it('fetchAttendees / addAttendee / updateAttendee / removeAttendee', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [attendeeRow] })
    const s = useMeetingExtrasStore()
    await s.fetchAttendees('p1', 'm1')
    expect(s.attendees).toEqual([attendeeRow])

    mockedApi.post.mockResolvedValueOnce({ data: { ...attendeeRow, id: 't2' } })
    await s.addAttendee('p1', 'm1', { userId: 'u2' })
    expect(s.attendees).toHaveLength(2)

    mockedApi.patch.mockResolvedValueOnce({ data: { ...attendeeRow, isPresent: false } })
    await s.updateAttendee('p1', 'm1', 't1', { isPresent: false })
    expect(s.attendees[0].isPresent).toBe(false)

    mockedApi.delete.mockResolvedValueOnce({})
    await s.removeAttendee('p1', 'm1', 't1')
    expect(s.attendees.map((a: { id: string }) => a.id)).toEqual(['t2'])
  })

  it('outcomes flow + convertToWp refreshes', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [outcomeRow] })
    const s = useMeetingExtrasStore()
    await s.fetchOutcomes('p1', 'm1')
    expect(s.outcomes).toEqual([outcomeRow])

    mockedApi.post.mockResolvedValueOnce({ data: { ...outcomeRow, id: 'o2' } })
    await s.addOutcome('p1', 'm1', { type: 'Action', description: 'Do X' })
    expect(s.outcomes).toHaveLength(2)

    mockedApi.delete.mockResolvedValueOnce({})
    await s.deleteOutcome('p1', 'm1', 'o1')
    expect(s.outcomes.map((o: { id: string }) => o.id)).toEqual(['o2'])

    mockedApi.post.mockResolvedValueOnce({ data: { wpId: 'wp-new' } })
    mockedApi.get.mockResolvedValueOnce({ data: [outcomeRow] })
    const out = await s.convertToWp('p1', 'm1', 'o2')
    expect(out).toEqual({ wpId: 'wp-new' })
    expect(s.outcomes).toEqual([outcomeRow])
  })

  it('reset clears every list', () => {
    const s = useMeetingExtrasStore()
    s.agenda = [agendaRow] as never
    s.attendees = [attendeeRow] as never
    s.outcomes = [outcomeRow] as never
    s.error = 'x'
    s.reset()
    expect(s.agenda).toEqual([])
    expect(s.attendees).toEqual([])
    expect(s.outcomes).toEqual([])
    expect(s.error).toBeNull()
  })
})
