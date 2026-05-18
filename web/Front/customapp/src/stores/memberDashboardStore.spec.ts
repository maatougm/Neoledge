import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useMemberDashboardStore, type MemberTaskCard } from './memberDashboardStore'
import { _clearHandlers } from './logoutBus'

const mockedApi = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>

function makeTask(id: string, status = 'InProgress'): MemberTaskCard {
  return {
    id, title: 't', status, priority: 'Normal', type: 'Task',
    dueDate: null, estimatedHours: null,
    project: { id: 'p1', name: 'Proj' }, sprint: null,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  _clearHandlers()
  for (const m of Object.values(mockedApi)) m.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('memberDashboardStore', () => {
  it('starts empty', () => {
    const s = useMemberDashboardStore()
    expect(s.todayTasks).toEqual([])
    expect(s.activeSprints).toEqual([])
    expect(s.myProjects).toEqual([])
    expect(s.weeklyTotals).toBeNull()
  })

  describe('fetchAll', () => {
    it('populates all four lists from 4 parallel calls', async () => {
      mockedApi.get
        .mockResolvedValueOnce({ data: { items: [makeTask('t1')] } })        // /pm/my-tasks/today
        .mockResolvedValueOnce({ data: { items: [{ projectId: 'p1' }] } })   // /pm/my-sprints
        .mockResolvedValueOnce({ data: { items: [{ id: 'p1' }] } })          // /pm/my-projects
        .mockResolvedValueOnce({ data: { weekStart: '2026-05-12', totalHours: 35, byDay: [] } })
      const s = useMemberDashboardStore()
      await s.fetchAll()
      expect(s.todayTasks).toHaveLength(1)
      expect(s.activeSprints).toHaveLength(1)
      expect(s.myProjects).toHaveLength(1)
      expect(s.weeklyTotals?.totalHours).toBe(35)
    })

    it('treats weekly totals 404 as null', async () => {
      mockedApi.get
        .mockResolvedValueOnce({ data: { items: [] } })
        .mockResolvedValueOnce({ data: { items: [] } })
        .mockResolvedValueOnce({ data: { items: [] } })
        .mockRejectedValueOnce(new Error('no week endpoint'))
      const s = useMemberDashboardStore()
      await s.fetchAll()
      expect(s.weeklyTotals).toBeNull()
    })

    it('captures error on parent failure', async () => {
      mockedApi.get.mockRejectedValue(new Error('500'))
      const s = useMemberDashboardStore()
      await s.fetchAll()
      expect(s.error).toBe('500')
    })
  })

  describe('transitionTask', () => {
    it('mutates the task optimistically + drops it on Resolved/Closed', async () => {
      mockedApi.patch.mockResolvedValue({ data: undefined })
      const s = useMemberDashboardStore()
      const t1 = makeTask('t1')
      const t2 = makeTask('t2')
      s.todayTasks = [t1, t2]
      const r = await s.transitionTask(t1, 'Resolved')
      expect(r).toBe(true)
      expect(s.todayTasks.map((t) => t.id)).toEqual(['t2'])
    })

    it('keeps the task on a non-terminal transition', async () => {
      mockedApi.patch.mockResolvedValue({ data: undefined })
      const s = useMemberDashboardStore()
      const t1 = makeTask('t1', 'New')
      s.todayTasks = [t1]
      const r = await s.transitionTask(t1, 'InProgress')
      expect(r).toBe(true)
      expect(s.todayTasks).toHaveLength(1)
      expect(s.todayTasks[0].status).toBe('InProgress')
    })

    it('reverts status on failure', async () => {
      mockedApi.patch.mockRejectedValue(new Error('forbidden'))
      const s = useMemberDashboardStore()
      const t1 = makeTask('t1', 'New')
      s.todayTasks = [t1]
      const r = await s.transitionTask(t1, 'Resolved')
      expect(r).toBe(false)
      expect(s.todayTasks[0].status).toBe('New')
    })
  })

  describe('reset', () => {
    it('wipes per-user state', () => {
      const s = useMemberDashboardStore()
      s.todayTasks = [makeTask('t1')]
      s.activeSprints = [{ projectId: 'p1' } as never]
      s.myProjects = [{ id: 'p1' } as never]
      s.weeklyTotals = { weekStart: '2026-05-12', totalHours: 1, byDay: [] }
      s.error = 'x'
      s.reset()
      expect(s.todayTasks).toEqual([])
      expect(s.activeSprints).toEqual([])
      expect(s.myProjects).toEqual([])
      expect(s.weeklyTotals).toBeNull()
      expect(s.error).toBeNull()
    })
  })
})
