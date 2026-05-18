import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useGanttStore } from './ganttStore'

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

const milestone = { id: 'm1', projectId: 'p1', workPackageId: null, title: 'Kickoff', description: null, date: '2026-01-01', isReached: false, color: null, position: 0 }

describe('ganttStore', () => {
  it('initial state', () => {
    const s = useGanttStore()
    expect(s.workPackages).toEqual([])
    expect(s.milestones).toEqual([])
    expect(s.dependencies).toEqual([])
    expect(s.baselines).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('fetchGantt populates workPackages, milestones, dependencies', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { workPackages: [{ id: 'w1' }], milestones: [milestone], dependencies: [{ fromWpId: 'w1', toWpId: 'w2', type: 'FS' }] },
    })
    const s = useGanttStore()
    await s.fetchGantt('p1')
    expect(s.workPackages).toHaveLength(1)
    expect(s.milestones).toHaveLength(1)
    expect(s.dependencies).toHaveLength(1)
  })

  it('fetchGantt swallows error into store.error', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('net'))
    const s = useGanttStore()
    await s.fetchGantt('p1')
    expect(s.error).toBe('net')
  })

  it('createMilestone appends and returns the row', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: milestone })
    const s = useGanttStore()
    const out = await s.createMilestone('p1', { title: 'Kickoff', date: '2026-01-01' })
    expect(out).toEqual(milestone)
    expect(s.milestones).toEqual([milestone])
  })

  it('updateMilestone replaces the slot in the array', async () => {
    const patched = { ...milestone, title: 'Kickoff v2' }
    mockedApi.patch.mockResolvedValueOnce({ data: patched })
    const s = useGanttStore()
    s.milestones = [milestone] as never
    const out = await s.updateMilestone('p1', 'm1', { title: 'Kickoff v2' })
    expect(out).toEqual(patched)
    expect(s.milestones[0].title).toBe('Kickoff v2')
  })

  it('deleteMilestone filters out the row', async () => {
    mockedApi.delete.mockResolvedValueOnce({})
    const s = useGanttStore()
    s.milestones = [milestone, { ...milestone, id: 'm2' }] as never
    await s.deleteMilestone('p1', 'm1')
    expect(s.milestones.map((m: { id: string }) => m.id)).toEqual(['m2'])
  })

  it('fetchBaselines stores rows', async () => {
    const rows = [{ snapshotName: 'v1', capturedAt: '2026-05-19', wpCount: 12 }]
    mockedApi.get.mockResolvedValueOnce({ data: rows })
    const s = useGanttStore()
    await s.fetchBaselines('p1')
    expect(s.baselines).toEqual(rows)
  })

  it('captureBaseline returns the response AND refreshes baselines', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { snapshotName: 'v2', count: 8 } })
    mockedApi.get.mockResolvedValueOnce({ data: [{ snapshotName: 'v2', capturedAt: 'x', wpCount: 8 }] })
    const s = useGanttStore()
    const out = await s.captureBaseline('p1', 'v2')
    expect(out).toEqual({ snapshotName: 'v2', count: 8 })
    expect(s.baselines).toHaveLength(1)
  })

  it('compareBaseline returns the diff response untouched', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { diff: { added: 1 } } })
    const s = useGanttStore()
    const out = await s.compareBaseline('p1', 'v1')
    expect(out).toEqual({ diff: { added: 1 } })
  })

  it('patchWorkPackage is no-op when wp id is unknown', () => {
    const s = useGanttStore()
    s.workPackages = [{ id: 'w1', title: 'A' }] as never
    s.patchWorkPackage('NOPE', { title: 'B' } as never)
    expect((s.workPackages[0] as { title: string }).title).toBe('A')
  })

  it('patchWorkPackage replaces the slot with a new spread copy', () => {
    const s = useGanttStore()
    const before = [{ id: 'w1', title: 'A' }] as never[]
    s.workPackages = before
    s.patchWorkPackage('w1', { title: 'B' } as never)
    expect((s.workPackages[0] as { title: string }).title).toBe('B')
    expect(s.workPackages).not.toBe(before)
  })

  it('reset clears every collection', () => {
    const s = useGanttStore()
    s.workPackages = [{ id: 'w1' }] as never
    s.milestones = [milestone] as never
    s.dependencies = [{} as never]
    s.baselines = [{} as never]
    s.error = 'x'
    s.reset()
    expect(s.workPackages).toEqual([])
    expect(s.milestones).toEqual([])
    expect(s.dependencies).toEqual([])
    expect(s.baselines).toEqual([])
    expect(s.error).toBeNull()
  })
})
