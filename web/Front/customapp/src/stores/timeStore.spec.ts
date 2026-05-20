import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useTimeStore } from './timeStore'

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const entry = (over: Partial<{ id: string; hours: number }> = {}) => ({
  id: 't1',
  userId: 'u1',
  projectId: 'p1',
  workPackageId: null,
  hours: 4,
  spentOn: '2026-01-01',
  activity: 'Dev',
  comment: null,
  isBillable: true,
  lockedAt: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...over,
})

beforeEach(() => {
  setActivePinia(createPinia())
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.patch.mockReset()
  mockedApi.delete.mockReset()
})

describe('timeStore', () => {
  it('initial state', () => {
    const s = useTimeStore()
    expect(s.myEntries).toEqual([])
    expect(s.projectEntries).toEqual([])
    expect(s.weekEntries).toEqual([])
    expect(s.summary).toBeNull()
  })

  it('fetchMy without filters', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [entry()] })
    const s = useTimeStore()
    await s.fetchMy()
    expect(mockedApi.get).toHaveBeenCalledWith('/api/time-entries')
    expect(s.myEntries).toHaveLength(1)
  })

  it('fetchMy appends filters to query string', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] })
    const s = useTimeStore()
    await s.fetchMy({ from: '2026-01-01', to: '2026-01-31', projectId: 'p1' })
    const url = mockedApi.get.mock.calls[0][0] as string
    expect(url).toContain('from=2026-01-01')
    expect(url).toContain('to=2026-01-31')
    expect(url).toContain('projectId=p1')
  })

  it('fetchMy writes error on rejection (no rethrow)', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('x'))
    const s = useTimeStore()
    await s.fetchMy()
    expect(s.error).toBe('x')
  })

  it('fetchProject stores rows and rethrows on error', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [entry()] })
    const s = useTimeStore()
    await s.fetchProject('p1')
    expect(s.projectEntries).toHaveLength(1)

    mockedApi.get.mockRejectedValueOnce(new Error('y'))
    await expect(s.fetchProject('p1')).rejects.toThrow('y')
  })

  it('create prepends to myEntries', async () => {
    const e = entry({ id: 'new' })
    mockedApi.post.mockResolvedValueOnce({ data: e })
    const s = useTimeStore()
    s.myEntries = [entry()] as never
    const out = await s.create({ projectId: 'p1', hours: 4, spentOn: '2026-01-01' })
    expect(out).toEqual(e)
    expect(s.myEntries[0].id).toBe('new')
    expect(s.myEntries).toHaveLength(2)
  })

  it('create rethrows on error', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('x'))
    const s = useTimeStore()
    await expect(s.create({ projectId: 'p1', hours: 1, spentOn: '2026-01-01' })).rejects.toThrow('x')
  })

  it('update replaces matching slot in myEntries', async () => {
    const e = entry()
    const patched = { ...e, hours: 8 }
    mockedApi.patch.mockResolvedValueOnce({ data: patched })
    const s = useTimeStore()
    s.myEntries = [e] as never
    const out = await s.update('t1', { hours: 8 })
    expect(out!.hours).toBe(8)
    expect(s.myEntries[0].hours).toBe(8)
  })

  it('remove filters out the row', async () => {
    mockedApi.delete.mockResolvedValueOnce({})
    const s = useTimeStore()
    s.myEntries = [entry(), entry({ id: 't2' })] as never
    await s.remove('t1')
    expect(s.myEntries.map((e: { id: string }) => e.id)).toEqual(['t2'])
  })

  it('fetchWeek stores entries array', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { start: '2026-01-01', entries: [entry()] } })
    const s = useTimeStore()
    await s.fetchWeek('2026-01-01')
    expect(s.weekEntries).toHaveLength(1)
  })

  it('fetchSummary stores summary', async () => {
    const sum = { total: 12, byUser: [], byActivity: [] }
    mockedApi.get.mockResolvedValueOnce({ data: sum })
    const s = useTimeStore()
    await s.fetchSummary('p1')
    expect(s.summary).toEqual(sum)
  })

  it('reset clears everything', () => {
    const s = useTimeStore()
    s.myEntries = [entry()] as never
    s.projectEntries = [entry()] as never
    s.weekEntries = [entry()] as never
    s.summary = { total: 1, byUser: [], byActivity: [] } as never
    s.error = 'x'
    s.reset()
    expect(s.myEntries).toEqual([])
    expect(s.projectEntries).toEqual([])
    expect(s.weekEntries).toEqual([])
    expect(s.summary).toBeNull()
    expect(s.error).toBeNull()
  })
})
