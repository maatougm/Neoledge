import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  extractErrorMessage: (e: unknown) =>
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? null,
}))

import api from '@/lib/api'
import { useMemberTasksStore, type TaskTab } from './memberTasksStore'
import { _clearHandlers } from './logoutBus'
import type { MemberTaskCard } from './memberDashboardStore'

const mockedApi = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>

function task(id: string, opts: Partial<{ status: string; priority: string; dueDate: string | null; projectId: string }> = {}): MemberTaskCard {
  return {
    id,
    title: `Task ${id}`,
    status: opts.status ?? 'New',
    priority: opts.priority ?? 'Normal',
    type: 'Task',
    dueDate: opts.dueDate ?? null,
    estimatedHours: null,
    project: { id: opts.projectId ?? 'p1', name: 'Proj' },
    sprint: null,
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

describe('memberTasksStore', () => {
  it('starts empty with tab=todo', () => {
    const s = useMemberTasksStore()
    expect(s.items).toEqual([])
    expect(s.total).toBe(0)
    expect(s.filters.tab).toBe('todo')
    expect(s.selectedIds.size).toBe(0)
  })

  describe('setFilter', () => {
    it('updates a filter and clears selection', () => {
      const s = useMemberTasksStore()
      s.toggleSelect('t1')
      expect(s.selectedIds.size).toBe(1)
      s.setFilter('tab', 'review' as TaskTab)
      expect(s.filters.tab).toBe('review')
      expect(s.selectedIds.size).toBe(0)
    })
  })

  describe('fetchAll', () => {
    it('todo tab fans out to New + InProgress and merges', async () => {
      mockedApi.get
        .mockResolvedValueOnce({ data: { items: [task('t1', { status: 'New' })], total: 1 } })
        .mockResolvedValueOnce({ data: { items: [task('t2', { status: 'InProgress' })], total: 1 } })
      const s = useMemberTasksStore()
      await s.fetchAll()
      expect(s.items.map((t) => t.id).sort()).toEqual(['t1', 't2'])
      expect(s.total).toBe(2)
      expect(mockedApi.get).toHaveBeenCalledTimes(2)
      const [url1] = mockedApi.get.mock.calls[0]
      const [url2] = mockedApi.get.mock.calls[1]
      expect(url1).toContain('status=New')
      expect(url2).toContain('status=InProgress')
    })

    it('done tab fans out to Resolved + Closed', async () => {
      mockedApi.get
        .mockResolvedValueOnce({ data: { items: [], total: 0 } })
        .mockResolvedValueOnce({ data: { items: [], total: 0 } })
      const s = useMemberTasksStore()
      s.setFilter('tab', 'done')
      await s.fetchAll()
      expect(mockedApi.get.mock.calls[0][0]).toContain('status=Resolved')
      expect(mockedApi.get.mock.calls[1][0]).toContain('status=Closed')
    })

    it('review tab queries only AwaitingReview', async () => {
      mockedApi.get.mockResolvedValueOnce({ data: { items: [], total: 0 } })
      const s = useMemberTasksStore()
      s.setFilter('tab', 'review')
      await s.fetchAll()
      expect(mockedApi.get).toHaveBeenCalledTimes(1)
      expect(mockedApi.get.mock.calls[0][0]).toContain('status=AwaitingReview')
    })

    it('all tab omits the status param', async () => {
      mockedApi.get.mockResolvedValueOnce({ data: { items: [task('t1')], total: 1 } })
      const s = useMemberTasksStore()
      s.setFilter('tab', 'all')
      await s.fetchAll()
      expect(mockedApi.get).toHaveBeenCalledTimes(1)
      expect(mockedApi.get.mock.calls[0][0]).not.toContain('status=')
    })

    it('sorts by due-asc then priority-desc', async () => {
      mockedApi.get
        .mockResolvedValueOnce({
          data: {
            items: [
              task('t1', { status: 'New',        priority: 'Low',      dueDate: '2026-06-01' }),
              task('t2', { status: 'New',        priority: 'Critical', dueDate: '2026-06-01' }),
              task('t3', { status: 'New',        priority: 'Normal',   dueDate: null }),
              task('t4', { status: 'New',        priority: 'High',     dueDate: '2026-05-20' }),
            ], total: 4,
          },
        })
        .mockResolvedValueOnce({ data: { items: [], total: 0 } })
      const s = useMemberTasksStore()
      await s.fetchAll()
      expect(s.items.map((t) => t.id)).toEqual(['t4', 't2', 't1', 't3'])
    })

    it('captures error on failure', async () => {
      mockedApi.get.mockRejectedValue(new Error('500'))
      const s = useMemberTasksStore()
      await s.fetchAll()
      expect(s.error).toBe('500')
    })
  })

  describe('selection', () => {
    it('toggleSelect, selectAllVisible, clearSelection', () => {
      const s = useMemberTasksStore()
      s.items = [task('t1'), task('t2'), task('t3')]
      s.toggleSelect('t1')
      s.toggleSelect('t2')
      expect(s.selectedIds.size).toBe(2)
      s.toggleSelect('t1')
      expect(s.selectedIds.has('t1')).toBe(false)
      s.selectAllVisible()
      expect(s.selectedIds.size).toBe(3)
      s.clearSelection()
      expect(s.selectedIds.size).toBe(0)
    })
  })

  describe('transitionOne', () => {
    it('updates the task on success', async () => {
      mockedApi.patch.mockResolvedValue({ data: undefined })
      const s = useMemberTasksStore()
      s.items = [task('t1')]
      const r = await s.transitionOne('t1', 'InProgress')
      expect(r).toBe(true)
      expect(s.items[0].status).toBe('InProgress')
    })

    it('returns false when task missing', async () => {
      const s = useMemberTasksStore()
      const r = await s.transitionOne('missing', 'InProgress')
      expect(r).toBe(false)
    })

    it('reverts on failure', async () => {
      mockedApi.patch.mockRejectedValue(new Error('500'))
      const s = useMemberTasksStore()
      s.items = [task('t1', { status: 'New' })]
      const r = await s.transitionOne('t1', 'InProgress')
      expect(r).toBe(false)
      expect(s.items[0].status).toBe('New')
    })
  })

  describe('bulkTransition', () => {
    it('returns {0,0} when nothing selected', async () => {
      const s = useMemberTasksStore()
      const r = await s.bulkTransition('Resolved')
      expect(r).toEqual({ updated: 0, failed: 0 })
    })

    it('counts updates + failures across the batch and clears selection', async () => {
      mockedApi.patch
        .mockResolvedValueOnce({ data: undefined })
        .mockRejectedValueOnce(new Error('forbidden'))
        .mockResolvedValueOnce({ data: undefined })
      const s = useMemberTasksStore()
      s.items = [task('t1'), task('t2'), task('t3')]
      s.toggleSelect('t1')
      s.toggleSelect('t2')
      s.toggleSelect('t3')
      const r = await s.bulkTransition('Resolved')
      expect(r.updated + r.failed).toBe(3)
      expect(s.selectedIds.size).toBe(0)
    })
  })

  describe('reset', () => {
    it('wipes state + restores tab=todo', () => {
      const s = useMemberTasksStore()
      s.items = [task('t1')]
      s.total = 5
      s.filters.tab = 'done'
      s.filters.projectId = 'p1'
      s.toggleSelect('t1')
      s.error = 'x'
      s.reset()
      expect(s.items).toEqual([])
      expect(s.total).toBe(0)
      expect(s.filters.tab).toBe('todo')
      expect(s.filters.projectId).toBeUndefined()
      expect(s.selectedIds.size).toBe(0)
      expect(s.error).toBeNull()
    })
  })
})
