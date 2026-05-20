import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useAgileStore } from './agileStore'

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

describe('agileStore', () => {
  it('starts with empty state', () => {
    const s = useAgileStore()
    expect(s.boards).toEqual([])
    expect(s.sprints).toEqual([])
    expect(s.currentBoard).toBeNull()
    expect(s.currentSprint).toBeNull()
    expect(s.burndown).toBeNull()
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('fetchBoards happy path', async () => {
    const boards = [{ id: 'b1', projectId: 'p1', name: 'Main', type: 'Kanban', isDefault: true }]
    mockedApi.get.mockResolvedValueOnce({ data: boards })
    const s = useAgileStore()
    await s.fetchBoards('p1')
    expect(mockedApi.get).toHaveBeenCalledWith('/pm/projects/p1/boards')
    expect(s.boards).toEqual(boards)
    expect(s.loading).toBe(false)
  })

  it('fetchBoards swallows error into store.error', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('boom'))
    const s = useAgileStore()
    await s.fetchBoards('p1')
    expect(s.error).toBe('boom')
    expect(s.boards).toEqual([])
  })

  it('fetchBoard sets currentBoard + returns the row', async () => {
    const board = { id: 'b1', projectId: 'p1', name: 'Main', type: 'Kanban', isDefault: true }
    mockedApi.get.mockResolvedValueOnce({ data: board })
    const s = useAgileStore()
    const out = await s.fetchBoard('p1', 'b1')
    expect(out).toEqual(board)
    expect(s.currentBoard).toEqual(board)
  })

  it('fetchBoard rethrows', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('nope'))
    const s = useAgileStore()
    await expect(s.fetchBoard('p1', 'b1')).rejects.toThrow('nope')
    expect(s.error).toBe('nope')
  })

  it('createBoard appends to boards', async () => {
    const created = { id: 'b2', projectId: 'p1', name: 'Sprints', type: 'Scrum', isDefault: false }
    mockedApi.post.mockResolvedValueOnce({ data: created })
    const s = useAgileStore()
    const out = await s.createBoard('p1', { name: 'Sprints' })
    expect(mockedApi.post).toHaveBeenCalledWith('/pm/projects/p1/boards', { name: 'Sprints' })
    expect(out).toEqual(created)
    expect(s.boards).toEqual([created])
  })

  it('createColumn returns the row', async () => {
    const col = { id: 'c1', boardId: 'b1', name: 'Todo', position: 0, wipLimit: null, mapStatus: null }
    mockedApi.post.mockResolvedValueOnce({ data: col })
    const s = useAgileStore()
    const out = await s.createColumn('p1', 'b1', { name: 'Todo' })
    expect(out).toEqual(col)
  })

  it('moveCard posts the patch and resolves', async () => {
    mockedApi.patch.mockResolvedValueOnce({ data: {} })
    const s = useAgileStore()
    await s.moveCard('p1', 'b1', 'wp1', 'c2', 3)
    expect(mockedApi.patch).toHaveBeenCalledWith(
      '/pm/projects/p1/boards/b1/cards/wp1/move',
      { columnId: 'c2', position: 3 },
    )
  })

  it('moveCard rethrows on error', async () => {
    mockedApi.patch.mockRejectedValueOnce(new Error('move-fail'))
    const s = useAgileStore()
    await expect(s.moveCard('p1', 'b1', 'wp1', 'c2')).rejects.toThrow('move-fail')
    expect(s.error).toBe('move-fail')
  })

  it('fetchSprints stores + returns rows', async () => {
    const rows = [{ id: 's1', boardId: 'b1', name: 'Sprint 1', goal: null, startDate: '', endDate: '', status: 'Active', capacity: null }]
    mockedApi.get.mockResolvedValueOnce({ data: rows })
    const s = useAgileStore()
    const out = await s.fetchSprints('p1', 'b1')
    expect(out).toEqual(rows)
    expect(s.sprints).toEqual(rows)
  })

  it('createSprint prepends to sprints', async () => {
    const newSprint = { id: 's2', boardId: 'b1', name: 'Sprint 2', goal: null, startDate: '', endDate: '', status: 'Planning', capacity: null }
    mockedApi.post.mockResolvedValueOnce({ data: newSprint })
    const s = useAgileStore()
    s.sprints = [{ id: 's1', boardId: 'b1', name: 'Sprint 1', goal: null, startDate: '', endDate: '', status: 'Active', capacity: null }] as never
    const out = await s.createSprint('p1', 'b1', { name: 'Sprint 2', startDate: '', endDate: '' })
    expect(out).toEqual(newSprint)
    expect(s.sprints[0]).toEqual(newSprint)
    expect(s.sprints).toHaveLength(2)
  })

  it('deleteSprint removes from sprints', async () => {
    mockedApi.delete.mockResolvedValueOnce({})
    const s = useAgileStore()
    s.sprints = [
      { id: 's1', boardId: 'b1', name: 'S1', goal: null, startDate: '', endDate: '', status: 'Active', capacity: null } as never,
      { id: 's2', boardId: 'b1', name: 'S2', goal: null, startDate: '', endDate: '', status: 'Planning', capacity: null } as never,
    ]
    await s.deleteSprint('p1', 's1')
    expect(s.sprints.map((x: { id: string }) => x.id)).toEqual(['s2'])
  })

  it('startSprint replaces the sprint slot', async () => {
    const started = { id: 's1', boardId: 'b1', name: 'S1', goal: null, startDate: '', endDate: '', status: 'Active', capacity: null }
    mockedApi.post.mockResolvedValueOnce({ data: started })
    const s = useAgileStore()
    s.sprints = [{ id: 's1', boardId: 'b1', name: 'S1', goal: null, startDate: '', endDate: '', status: 'Planning', capacity: null } as never]
    const out = await s.startSprint('p1', 's1')
    expect(out).toEqual(started)
    expect((s.sprints[0] as { status: string }).status).toBe('Active')
  })

  it('closeSprint replaces the slot with the closed sprint', async () => {
    const closed = { id: 's1', boardId: 'b1', name: 'S1', goal: null, startDate: '', endDate: '', status: 'Closed', capacity: null }
    mockedApi.post.mockResolvedValueOnce({ data: { sprint: closed, movedToNext: 1, movedToBacklog: 0, kept: 2 } })
    const s = useAgileStore()
    s.sprints = [{ id: 's1', boardId: 'b1', name: 'S1', goal: null, startDate: '', endDate: '', status: 'Active', capacity: null } as never]
    const out = await s.closeSprint('p1', 's1', { dispositions: [{ workPackageId: 'w1', disposition: 'next_sprint' }] })
    expect(out).toEqual(closed)
    expect((s.sprints[0] as { status: string }).status).toBe('Closed')
  })

  it('addWpsToSprint posts payload', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })
    const s = useAgileStore()
    await s.addWpsToSprint('p1', 's1', ['w1', 'w2'])
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/pm/projects/p1/sprints/s1/work-packages',
      { workPackageIds: ['w1', 'w2'] },
    )
  })

  it('fetchBurndown stores the response', async () => {
    const bd = { sprint: { id: 's1' } as never, days: [{ date: '2026-05-19', ideal: 10, remaining: 8 }] }
    mockedApi.get.mockResolvedValueOnce({ data: bd })
    const s = useAgileStore()
    await s.fetchBurndown('p1', 's1')
    expect(s.burndown).toEqual(bd)
  })

  it('reset clears every ref', () => {
    const s = useAgileStore()
    s.boards = [{ id: 'b' }] as never
    s.sprints = [{ id: 's' }] as never
    s.currentBoard = { id: 'b' } as never
    s.burndown = { sprint: {}, days: [] } as never
    s.error = 'x'
    s.reset()
    expect(s.boards).toEqual([])
    expect(s.sprints).toEqual([])
    expect(s.currentBoard).toBeNull()
    expect(s.burndown).toBeNull()
    expect(s.error).toBeNull()
  })
})
