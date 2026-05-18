import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useSavedFiltersStore } from './savedFiltersStore'

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const row = (over: Partial<{ id: string; name: string; isDefault: boolean }> = {}) => ({
  id: 'f1',
  name: 'My filter',
  filters: { status: ['Active'] },
  isDefault: false,
  ...over,
})

beforeEach(() => {
  setActivePinia(createPinia())
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.put.mockReset()
  mockedApi.patch.mockReset()
  mockedApi.delete.mockReset()
})

describe('savedFiltersStore', () => {
  it('initial state', () => {
    const s = useSavedFiltersStore()
    expect(s.filters).toEqual([])
    expect(s.activeFilter).toBeNull()
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('fetchAll stores rows', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [row()] })
    const s = useSavedFiltersStore()
    await s.fetchAll()
    expect(s.filters).toHaveLength(1)
    expect(s.loading).toBe(false)
  })

  it('fetchAll writes error on rejection', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('down'))
    const s = useSavedFiltersStore()
    await s.fetchAll()
    expect(s.error).toBe('down')
  })

  it('create returns the row and appends', async () => {
    const r = row({ id: 'f2', name: 'New' })
    mockedApi.post.mockResolvedValueOnce({ data: r })
    const s = useSavedFiltersStore()
    const out = await s.create('New', { status: [] } as never)
    expect(out).toEqual(r)
    expect(s.filters).toEqual([r])
  })

  it('create returns null on api error', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('x'))
    const s = useSavedFiltersStore()
    const out = await s.create('N', { status: [] } as never)
    expect(out).toBeNull()
    expect(s.error).toBe('x')
  })

  it('update replaces in filters AND activeFilter when it matches', async () => {
    const r = row({ name: 'old' })
    const patched = row({ name: 'new' })
    mockedApi.put.mockResolvedValueOnce({ data: patched })
    const s = useSavedFiltersStore()
    s.filters = [r] as never
    s.activeFilter = r as never
    await s.update('f1', { name: 'new' })
    expect(s.filters[0].name).toBe('new')
    expect(s.activeFilter!.name).toBe('new')
  })

  it('update returns null on api error', async () => {
    mockedApi.put.mockRejectedValueOnce(new Error('x'))
    const s = useSavedFiltersStore()
    const out = await s.update('f1', { name: 'new' })
    expect(out).toBeNull()
  })

  it('remove filters list AND clears activeFilter when it matches', async () => {
    const r = row()
    mockedApi.delete.mockResolvedValueOnce({})
    const s = useSavedFiltersStore()
    s.filters = [r] as never
    s.activeFilter = r as never
    await s.remove('f1')
    expect(s.filters).toEqual([])
    expect(s.activeFilter).toBeNull()
  })

  it('remove sets error on rejection', async () => {
    mockedApi.delete.mockRejectedValueOnce(new Error('x'))
    const s = useSavedFiltersStore()
    await s.remove('f1')
    expect(s.error).toBe('x')
  })

  it('setDefault toggles isDefault across the list', async () => {
    mockedApi.patch.mockResolvedValueOnce({})
    const s = useSavedFiltersStore()
    s.filters = [row({ id: 'a' }), row({ id: 'b', isDefault: true })] as never
    await s.setDefault('a')
    expect(s.filters.find((f: { id: string; isDefault: boolean }) => f.id === 'a')!.isDefault).toBe(true)
    expect(s.filters.find((f: { id: string; isDefault: boolean }) => f.id === 'b')!.isDefault).toBe(false)
  })

  it('applyFilter / clearActiveFilter', () => {
    const r = row()
    const s = useSavedFiltersStore()
    s.applyFilter(r as never)
    expect(s.activeFilter).toEqual(r)
    s.clearActiveFilter()
    expect(s.activeFilter).toBeNull()
  })

  it('reset wipes everything', () => {
    const s = useSavedFiltersStore()
    s.filters = [row()] as never
    s.activeFilter = row() as never
    s.error = 'x'
    s.reset()
    expect(s.filters).toEqual([])
    expect(s.activeFilter).toBeNull()
    expect(s.error).toBeNull()
  })
})
