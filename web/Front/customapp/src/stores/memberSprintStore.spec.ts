import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useMemberSprintStore } from './memberSprintStore'
import { _clearHandlers } from './logoutBus'

const mockedApi = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>

interface RawWp {
  id: string
  status: string
  priority?: string
  type?: string
  dueDate?: string | null
  estimatedHours?: number | null
  project?: { id: string; name: string }
  title?: string
  assigneeId: string | null
  assignee?: { firstName?: string; lastName?: string } | null
  sprint?: { id: string; name: string; goal: string | null; status: string; startDate: string; endDate: string } | null
}

function wp(id: string, opts: Partial<RawWp>): RawWp {
  return {
    id,
    status: opts.status ?? 'InProgress',
    priority: 'Normal',
    type: 'Task',
    dueDate: null,
    estimatedHours: null,
    project: { id: 'p1', name: 'Proj' },
    title: 't',
    assigneeId: opts.assigneeId ?? null,
    assignee: opts.assignee,
    sprint: opts.sprint,
  }
}

const SPRINT = { id: 's1', name: 'Sprint 1', goal: 'goal', status: 'Active', startDate: '2026-05-01', endDate: '2026-05-14' }

beforeEach(() => {
  setActivePinia(createPinia())
  _clearHandlers()
  for (const m of Object.values(mockedApi)) m.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('memberSprintStore', () => {
  it('starts empty', () => {
    const s = useMemberSprintStore()
    expect(s.sprint).toBeNull()
    expect(s.myTasks).toEqual([])
    expect(s.teammates).toEqual([])
  })

  describe('load', () => {
    it('splits my tasks vs teammates + extracts sprint meta from first WP', async () => {
      mockedApi.get.mockResolvedValue({
        data: {
          items: [
            wp('w1', { assigneeId: 'me', sprint: SPRINT }),
            wp('w2', { assigneeId: 'me', sprint: SPRINT }),
            wp('w3', { assigneeId: 'other', assignee: { firstName: 'B', lastName: 'O' }, sprint: SPRINT }),
            wp('w4', { assigneeId: 'other', assignee: { firstName: 'B', lastName: 'O' }, sprint: SPRINT }),
            wp('w5', { assigneeId: 'another', assignee: { firstName: 'C', lastName: 'D' }, sprint: SPRINT }),
            wp('w6', { assigneeId: null, sprint: SPRINT }),
          ],
        },
      })
      const s = useMemberSprintStore()
      await s.load('p1', 's1', 'me')
      expect(s.sprint?.id).toBe('s1')
      expect(s.myTasks.map((t) => t.id)).toEqual(['w1', 'w2'])
      // teammates sorted by count desc
      expect(s.teammates.map((t) => `${t.userId}:${t.count}`)).toEqual(['other:2', 'another:1'])
      expect(s.teammates[0].fullName).toBe('B O')
    })

    it('falls back to fullName="Coéquipier" when assignee names are missing', async () => {
      mockedApi.get.mockResolvedValue({
        data: {
          items: [wp('w1', { assigneeId: 'other', assignee: null, sprint: SPRINT })],
        },
      })
      const s = useMemberSprintStore()
      await s.load('p1', 's1', 'me')
      expect(s.teammates).toEqual([{ userId: 'other', fullName: 'Coéquipier', count: 1 }])
    })

    it('leaves sprint null when no WP carries sprint metadata', async () => {
      mockedApi.get.mockResolvedValue({ data: { items: [wp('w1', { assigneeId: 'me' })] } })
      const s = useMemberSprintStore()
      await s.load('p1', 's1', 'me')
      expect(s.sprint).toBeNull()
    })

    it('captures error on failure', async () => {
      mockedApi.get.mockRejectedValue(new Error('500'))
      const s = useMemberSprintStore()
      await s.load('p1', 's1', 'me')
      expect(s.error).toBe('500')
    })
  })

  describe('transition', () => {
    it('returns false when the task is not in the store', async () => {
      const s = useMemberSprintStore()
      const r = await s.transition('p1', 'missing', 'Resolved')
      expect(r).toBe(false)
    })

    it('mutates status optimistically + persists on success', async () => {
      mockedApi.patch.mockResolvedValue({ data: undefined })
      const s = useMemberSprintStore()
      const task = wp('w1', { assigneeId: 'me' })
      s.myTasks = [task as never]
      const r = await s.transition('p1', 'w1', 'Resolved')
      expect(r).toBe(true)
      expect(s.myTasks[0].status).toBe('Resolved')
    })

    it('reverts on failure', async () => {
      mockedApi.patch.mockRejectedValue(new Error('forbidden'))
      const s = useMemberSprintStore()
      const task = wp('w1', { assigneeId: 'me', status: 'InProgress' })
      s.myTasks = [task as never]
      const r = await s.transition('p1', 'w1', 'Resolved')
      expect(r).toBe(false)
      expect(s.myTasks[0].status).toBe('InProgress')
    })
  })

  describe('reset', () => {
    it('wipes the store', () => {
      const s = useMemberSprintStore()
      s.sprint = SPRINT as never
      s.myTasks = [wp('w1', { assigneeId: 'me' }) as never]
      s.teammates = [{ userId: 'x', fullName: 'X', count: 1 }]
      s.error = 'x'
      s.reset()
      expect(s.sprint).toBeNull()
      expect(s.myTasks).toEqual([])
      expect(s.teammates).toEqual([])
      expect(s.error).toBeNull()
    })
  })
})
