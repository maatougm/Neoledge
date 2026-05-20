import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useTeamPlannerStore } from './teamPlannerStore'

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockedApi.get.mockReset()
  mockedApi.patch.mockReset()
})

describe('teamPlannerStore', () => {
  it('initial state empty', () => {
    const s = useTeamPlannerStore()
    expect(s.assignments).toEqual([])
    expect(s.capacity).toEqual([])
    expect(s.conflicts).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('fetchAssignments builds query string + stores rows', async () => {
    const rows = [{ user: { id: 'u1' }, items: [] }]
    mockedApi.get.mockResolvedValueOnce({ data: rows })
    const s = useTeamPlannerStore()
    await s.fetchAssignments('2026-01-01', '2026-02-01', ['u1', 'u2'], ['p1'])
    const url = mockedApi.get.mock.calls[0][0] as string
    expect(url).toMatch(/^\/pm\/team-planner\?/)
    expect(url).toContain('from=2026-01-01')
    expect(url).toContain('to=2026-02-01')
    expect(url).toContain('userIds=u1%2Cu2')
    expect(url).toContain('projectIds=p1')
    expect(s.assignments).toEqual(rows)
  })

  it('fetchAssignments without optional ids', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] })
    const s = useTeamPlannerStore()
    await s.fetchAssignments('2026-01-01', '2026-02-01')
    const url = mockedApi.get.mock.calls[0][0] as string
    expect(url).not.toContain('userIds=')
    expect(url).not.toContain('projectIds=')
  })

  it('fetchAssignments swallows error into store.error (no rethrow)', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('boom'))
    const s = useTeamPlannerStore()
    await s.fetchAssignments('2026-01-01', '2026-02-01')
    expect(s.error).toBe('boom')
  })

  it('fetchCapacity stores rows and rethrows on error', async () => {
    const rows = [{ user: { id: 'u1' }, capacityHours: 40, allocatedHours: 30, utilizationPercent: 75 }]
    mockedApi.get.mockResolvedValueOnce({ data: rows })
    const s = useTeamPlannerStore()
    await s.fetchCapacity('a', 'b')
    expect(s.capacity).toEqual(rows)

    mockedApi.get.mockRejectedValueOnce(new Error('x'))
    await expect(s.fetchCapacity('a', 'b')).rejects.toThrow('x')
    expect(s.error).toBe('x')
  })

  it('fetchConflicts stores rows', async () => {
    const rows = [{ userId: 'u1', wp1: { id: 'a' }, wp2: { id: 'b' } }]
    mockedApi.get.mockResolvedValueOnce({ data: rows })
    const s = useTeamPlannerStore()
    await s.fetchConflicts('x', 'y')
    expect(s.conflicts).toEqual(rows)
  })

  it('reassign patches and resolves', async () => {
    mockedApi.patch.mockResolvedValueOnce({})
    const s = useTeamPlannerStore()
    await s.reassign('wp1', 'u2', '2026-03-01', '2026-03-15')
    expect(mockedApi.patch).toHaveBeenCalledWith(
      '/pm/team-planner/work-packages/wp1/reassign',
      { assigneeId: 'u2', startDate: '2026-03-01', dueDate: '2026-03-15' },
    )
  })

  it('reassign rethrows on error', async () => {
    mockedApi.patch.mockRejectedValueOnce(new Error('x'))
    const s = useTeamPlannerStore()
    await expect(s.reassign('wp1', 'u2')).rejects.toThrow('x')
    expect(s.error).toBe('x')
  })

  it('reset clears every collection', () => {
    const s = useTeamPlannerStore()
    s.assignments = [{} as never]
    s.capacity = [{} as never]
    s.conflicts = [{} as never]
    s.error = 'x'
    s.reset()
    expect(s.assignments).toEqual([])
    expect(s.capacity).toEqual([])
    expect(s.conflicts).toEqual([])
    expect(s.error).toBeNull()
  })
})
