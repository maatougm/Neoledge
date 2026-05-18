import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useWorkPackageStore } from './workPackageStore'

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const wp = (over: Partial<{ id: string; title: string }> = {}) => ({
  id: 'w1',
  title: 'Task A',
  status: 'Open',
  priority: 'Normal',
  type: 'Task',
  ...over,
})

beforeEach(() => {
  setActivePinia(createPinia())
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.patch.mockReset()
  mockedApi.put.mockReset()
  mockedApi.delete.mockReset()
})

describe('workPackageStore', () => {
  it('initial state', () => {
    const s = useWorkPackageStore()
    expect(s.items).toEqual([])
    expect(s.total).toBe(0)
    expect(s.currentWp).toBeNull()
    expect(s.customFields).toEqual([])
    expect(s.loading).toBe(false)
  })

  it('fetchAll stores items + total + builds query string', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { items: [wp()], total: 1 } })
    const s = useWorkPackageStore()
    await s.fetchAll('p1', { status: 'Open', page: 0, limit: 20, blank: '' })
    const url = mockedApi.get.mock.calls[0][0] as string
    expect(url).toContain('status=Open')
    expect(url).toContain('page=0')
    expect(url).toContain('limit=20')
    expect(url).not.toContain('blank=')
    expect(s.items).toHaveLength(1)
    expect(s.total).toBe(1)
  })

  it('fetchAll without filters omits query string', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { items: [], total: 0 } })
    const s = useWorkPackageStore()
    await s.fetchAll('p1')
    expect(mockedApi.get.mock.calls[0][0]).toBe('/pm/projects/p1/work-packages')
  })

  it('fetchAll error sets error.value', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('x'))
    const s = useWorkPackageStore()
    await s.fetchAll('p1')
    expect(s.error).toBe('x')
  })

  it('fetchOne returns row + sets currentWp', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: wp() })
    const s = useWorkPackageStore()
    const out = await s.fetchOne('p1', 'w1')
    expect(out).toEqual(wp())
    expect(s.currentWp).toEqual(wp())
  })

  it('fetchOne returns null on error', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('nope'))
    const s = useWorkPackageStore()
    expect(await s.fetchOne('p1', 'w1')).toBeNull()
  })

  it('create prepends to items', async () => {
    const w = wp({ id: 'new' })
    mockedApi.post.mockResolvedValueOnce({ data: w })
    const s = useWorkPackageStore()
    s.items = [wp()] as never
    const out = await s.create('p1', { title: 'New' } as never)
    expect(out).toEqual(w)
    expect(s.items[0].id).toBe('new')
  })

  it('create returns null on error', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('x'))
    const s = useWorkPackageStore()
    expect(await s.create('p1', {} as never)).toBeNull()
  })

  it('update replaces in items + spreads into currentWp when it matches', async () => {
    const patched = { ...wp(), title: 'Renamed' }
    mockedApi.patch.mockResolvedValueOnce({ data: patched })
    const s = useWorkPackageStore()
    s.items = [wp()] as never
    s.currentWp = wp() as never
    await s.update('p1', 'w1', { title: 'Renamed' } as never)
    expect(s.items[0].title).toBe('Renamed')
    expect(s.currentWp!.title).toBe('Renamed')
  })

  it('remove filters items + clears currentWp when matching', async () => {
    mockedApi.delete.mockResolvedValueOnce({})
    const s = useWorkPackageStore()
    s.items = [wp(), wp({ id: 'w2' })] as never
    s.currentWp = wp() as never
    expect(await s.remove('p1', 'w1')).toBe(true)
    expect(s.items.map((w: { id: string }) => w.id)).toEqual(['w2'])
    expect(s.currentWp).toBeNull()
  })

  it('remove returns false on error', async () => {
    mockedApi.delete.mockRejectedValueOnce(new Error('x'))
    const s = useWorkPackageStore()
    expect(await s.remove('p1', 'w1')).toBe(false)
  })

  it('moveCard / addWatcher / removeWatcher return true on success, false on error', async () => {
    mockedApi.patch.mockResolvedValueOnce({})
    const s = useWorkPackageStore()
    expect(await s.moveCard('p1', 'w1', { boardColumnId: 'c1' })).toBe(true)

    mockedApi.patch.mockRejectedValueOnce(new Error('x'))
    expect(await s.moveCard('p1', 'w1', { boardColumnId: 'c1' })).toBe(false)

    mockedApi.post.mockResolvedValueOnce({})
    expect(await s.addWatcher('p1', 'w1', 'u1')).toBe(true)

    mockedApi.delete.mockResolvedValueOnce({})
    expect(await s.removeWatcher('p1', 'w1', 'u1')).toBe(true)
  })

  it('addDependency / removeDependency return true on success', async () => {
    mockedApi.post.mockResolvedValueOnce({})
    const s = useWorkPackageStore()
    expect(await s.addDependency('p1', 'w1', 'w2')).toBe(true)
    mockedApi.delete.mockResolvedValueOnce({})
    expect(await s.removeDependency('p1', 'w1', 'd1')).toBe(true)
  })

  it('fetchCustomFields populates customFields', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [{ id: 'f1', name: 'Severity', fieldType: 'Text' }] })
    const s = useWorkPackageStore()
    await s.fetchCustomFields('p1')
    expect(s.customFields).toHaveLength(1)
  })

  it('fetchCustomFields clears + sets error on rejection', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('x'))
    const s = useWorkPackageStore()
    s.customFields = [{ id: 'old' }] as never
    await s.fetchCustomFields('p1')
    expect(s.customFields).toEqual([])
    expect(s.error).toBe('x')
  })

  it('createCustomField calls list refresh', async () => {
    mockedApi.post.mockResolvedValueOnce({})
    mockedApi.get.mockResolvedValueOnce({ data: [{ id: 'f1' }] })
    const s = useWorkPackageStore()
    await s.createCustomField('p1', 'X', 'Text')
    expect(s.customFields).toEqual([{ id: 'f1' }])
  })

  it('createCustomField rethrows on error', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('x'))
    const s = useWorkPackageStore()
    await expect(s.createCustomField('p1', 'X', 'Text')).rejects.toThrow('x')
  })

  it('deleteCustomField calls list refresh', async () => {
    mockedApi.delete.mockResolvedValueOnce({})
    mockedApi.get.mockResolvedValueOnce({ data: [] })
    const s = useWorkPackageStore()
    await s.deleteCustomField('p1', 'f1')
    expect(s.customFields).toEqual([])
  })

  it('upsertCustomValues puts payload + rethrows on error', async () => {
    mockedApi.put.mockResolvedValueOnce({})
    const s = useWorkPackageStore()
    await s.upsertCustomValues('p1', 'w1', [{ customFieldId: 'f1', value: 'x' }])
    expect(mockedApi.put).toHaveBeenCalledWith(
      '/pm/projects/p1/work-packages/w1/custom-values',
      { values: [{ customFieldId: 'f1', value: 'x' }] },
    )

    mockedApi.put.mockRejectedValueOnce(new Error('x'))
    await expect(s.upsertCustomValues('p1', 'w1', [])).rejects.toThrow('x')
  })

  it('reset clears everything', () => {
    const s = useWorkPackageStore()
    s.items = [wp()] as never
    s.total = 5
    s.currentWp = wp() as never
    s.customFields = [{ id: 'f1' }] as never
    s.error = 'x'
    s.reset()
    expect(s.items).toEqual([])
    expect(s.total).toBe(0)
    expect(s.currentWp).toBeNull()
    expect(s.customFields).toEqual([])
    expect(s.error).toBeNull()
  })
})
