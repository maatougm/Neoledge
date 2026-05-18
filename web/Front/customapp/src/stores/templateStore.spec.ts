import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useTemplateStore } from './templateStore'

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.delete.mockReset()
})

const summary = (over: Partial<{ id: string; name: string }> = {}) => ({
  id: 't1',
  name: 'Default',
  description: null,
  ...over,
})

describe('templateStore', () => {
  it('initial state', () => {
    const s = useTemplateStore()
    expect(s.templates).toEqual([])
    expect(s.currentTemplate).toBeNull()
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('fetchTemplates stores rows', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [summary()] })
    const s = useTemplateStore()
    await s.fetchTemplates()
    expect(s.templates).toHaveLength(1)
  })

  it('fetchTemplates clears list + writes error on rejection', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('down'))
    const s = useTemplateStore()
    s.templates = [summary()] as never
    await s.fetchTemplates()
    expect(s.templates).toEqual([])
    expect(s.error).toBe('down')
  })

  it('fetchTemplate stores currentTemplate', async () => {
    const t = { ...summary(), fields: [] }
    mockedApi.get.mockResolvedValueOnce({ data: t })
    const s = useTemplateStore()
    const out = await s.fetchTemplate('t1')
    expect(out).toEqual(t)
    expect(s.currentTemplate).toEqual(t)
  })

  it('fetchTemplate returns null on error', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('x'))
    const s = useTemplateStore()
    const out = await s.fetchTemplate('t1')
    expect(out).toBeNull()
    expect(s.error).toBe('x')
  })

  it('createTemplate calls list refresh + returns the new row', async () => {
    const t = summary({ id: 'new', name: 'New' })
    mockedApi.post.mockResolvedValueOnce({ data: t })
    mockedApi.get.mockResolvedValueOnce({ data: [t] })
    const s = useTemplateStore()
    const out = await s.createTemplate({ name: 'New' } as never)
    expect(out).toEqual(t)
    expect(s.templates).toEqual([t])
  })

  it('createTemplate returns null on error', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('x'))
    const s = useTemplateStore()
    const out = await s.createTemplate({ name: 'x' } as never)
    expect(out).toBeNull()
  })

  it('deleteTemplate filters list', async () => {
    mockedApi.delete.mockResolvedValueOnce({})
    const s = useTemplateStore()
    s.templates = [summary({ id: 'a' }), summary({ id: 'b' })] as never
    await s.deleteTemplate('a')
    expect(s.templates.map((t: { id: string }) => t.id)).toEqual(['b'])
  })

  it('applyToProject rethrows on error', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('x'))
    const s = useTemplateStore()
    await expect(s.applyToProject('t1', 'p1')).rejects.toThrow('x')
    expect(s.error).toBe('x')
  })

  it('applyToProject happy path resolves', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })
    const s = useTemplateStore()
    await s.applyToProject('t1', 'p1')
    expect(s.error).toBeNull()
  })

  it('createFromProject returns new + refreshes', async () => {
    const t = summary({ id: 'from-proj' })
    mockedApi.post.mockResolvedValueOnce({ data: t })
    mockedApi.get.mockResolvedValueOnce({ data: [t] })
    const s = useTemplateStore()
    const out = await s.createFromProject('p1', { name: 'From' } as never)
    expect(out).toEqual(t)
    expect(s.templates).toEqual([t])
  })

  it('createFromProject returns null on error', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('x'))
    const s = useTemplateStore()
    const out = await s.createFromProject('p1', {} as never)
    expect(out).toBeNull()
  })

  it('reset wipes state', () => {
    const s = useTemplateStore()
    s.templates = [summary()] as never
    s.currentTemplate = summary() as never
    s.error = 'x'
    s.reset()
    expect(s.templates).toEqual([])
    expect(s.currentTemplate).toBeNull()
    expect(s.error).toBeNull()
  })
})
