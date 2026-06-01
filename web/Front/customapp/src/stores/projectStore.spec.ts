import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useProjectStore, computeProgress } from './projectStore'
import { _clearHandlers } from './logoutBus'
import type { ProjectDetail } from '@/types/project.types'

const mockedApi = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>

import type { ProjectSummary, ProjectStatus } from '@/types/project.types'

function makeProject(id = 'p1', opts: Partial<{ name: string; status: string }> = {}): ProjectSummary {
  return { id, name: opts.name ?? 'Proj', clientName: 'ACME', status: (opts.status ?? 'Realisation') as ProjectStatus, projectManagerName: null, projectManagerEmail: null, startDate: '2026-01-01', endDate: '2026-12-31', createdAt: '2026-01-01T00:00:00Z' }
}
function makeDetail(id = 'p1'): ProjectDetail {
  return {
    id,
    name: 'Proj',
    clientName: 'ACME',
    status: 'Realisation',
    fields: [],
    fieldValues: [],
  } as unknown as ProjectDetail
}

beforeEach(() => {
  setActivePinia(createPinia())
  _clearHandlers()
  for (const m of Object.values(mockedApi)) m.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('computeProgress (pure helper)', () => {
  it('returns 100 when there are no required fields', () => {
    const p = { fields: [], fieldValues: [] } as unknown as ProjectDetail
    expect(computeProgress(p)).toBe(100)
  })

  it('returns the rounded fill % when some required fields are filled', () => {
    const p = {
      fields: [
        { id: 'f1', isRequired: true },
        { id: 'f2', isRequired: true },
        { id: 'f3', isRequired: false },
        { id: 'f4', isRequired: true },
      ],
      fieldValues: [
        { projectFieldId: 'f1', value: 'yes' },
        { projectFieldId: 'f2', value: '   ' },
        { projectFieldId: 'f4', value: 'yes' },
      ],
    } as unknown as ProjectDetail
    // 2 / 3 = 66.67 → 67
    expect(computeProgress(p)).toBe(67)
  })

  it('treats null + empty + whitespace as unfilled', () => {
    const p = {
      fields: [{ id: 'f1', isRequired: true }, { id: 'f2', isRequired: true }],
      fieldValues: [{ projectFieldId: 'f1', value: null }, { projectFieldId: 'f2', value: '  ' }],
    } as unknown as ProjectDetail
    expect(computeProgress(p)).toBe(0)
  })
})

describe('projectStore', () => {
  describe('fetchAll', () => {
    it('populates from envelope { items, total }', async () => {
      mockedApi.get.mockResolvedValue({ data: { items: [makeProject('p1'), makeProject('p2')], total: 2 } })
      const s = useProjectStore()
      await s.fetchAll()
      expect(s.projects).toHaveLength(2)
      expect(s.totalProjects).toBe(2)
    })

    it('captures error on failure', async () => {
      mockedApi.get.mockRejectedValue(new Error('500'))
      const s = useProjectStore()
      await s.fetchAll()
      expect(s.error).toBe('500')
    })
  })

  describe('searchProjects', () => {
    it('passes search + status to the URL', async () => {
      mockedApi.get.mockResolvedValue({ data: { items: [makeProject('p1')], total: 1 } })
      const s = useProjectStore()
      await s.searchProjects({ search: 'foo', status: 'Realisation' })
      expect(mockedApi.get).toHaveBeenCalledWith(
        expect.stringMatching(/^\/admin\/project\?.*search=foo.*status=Realisation|^\/admin\/project\?.*status=Realisation.*search=foo/),
        expect.any(Object),
      )
      expect(s.searchQuery).toBe('foo')
      expect(s.statusFilter).toBe('Realisation')
    })

    it('reverts filter refs on a non-aborted failure', async () => {
      const s = useProjectStore()
      s.searchQuery = 'prev'
      s.statusFilter = 'Draft'
      mockedApi.get.mockRejectedValue(new Error('500'))
      await s.searchProjects({ search: 'new', status: 'Realisation' })
      expect(s.searchQuery).toBe('prev')
      expect(s.statusFilter).toBe('Draft')
      expect(s.error).toBe('500')
    })

    it('ignores CanceledError silently (no error set)', async () => {
      const canceled = new Error('canceled')
      canceled.name = 'CanceledError'
      mockedApi.get.mockRejectedValue(canceled)
      const s = useProjectStore()
      await s.searchProjects({ search: 'foo' })
      expect(s.error).toBeNull()
    })
  })

  describe('fetchById', () => {
    it('populates currentProject + returns it', async () => {
      mockedApi.get.mockResolvedValue({ data: makeDetail('p1') })
      const s = useProjectStore()
      const r = await s.fetchById('p1')
      expect(r?.id).toBe('p1')
      expect(s.currentProject?.id).toBe('p1')
    })

    it('returns null on failure', async () => {
      mockedApi.get.mockRejectedValue(new Error('404'))
      const s = useProjectStore()
      const r = await s.fetchById('p1')
      expect(r).toBeNull()
      expect(s.error).toBe('404')
    })
  })

  describe('createProject', () => {
    it('sets currentProject + triggers fetchAll', async () => {
      mockedApi.post.mockResolvedValue({ data: makeDetail('p-new') })
      mockedApi.get.mockResolvedValue({ data: { items: [], total: 0 } })
      const s = useProjectStore()
      const r = await s.createProject({} as never)
      expect(r?.id).toBe('p-new')
      expect(s.currentProject?.id).toBe('p-new')
      expect(mockedApi.get).toHaveBeenCalled()
    })

    it('extracts axios response.data.message on failure', async () => {
      const err = new axios.AxiosError(
        'bad',
        undefined,
        undefined,
        undefined,
        { status: 400, data: { message: 'Nom requis' } } as never,
      )
      mockedApi.post.mockRejectedValue(err)
      const s = useProjectStore()
      const r = await s.createProject({} as never)
      expect(r).toBeNull()
      expect(s.error).toBe('Nom requis')
    })
  })

  describe('updateProject', () => {
    it('patches the summary row in place', async () => {
      const s = useProjectStore()
      s.projects = [makeProject('p1', { name: 'Old' }), makeProject('p2')]
      mockedApi.put.mockResolvedValue({ data: { ...makeDetail('p1'), name: 'New', status: 'Cloture' } })
      const r = await s.updateProject('p1', { name: 'New' } as never)
      expect(r?.name).toBe('New')
      expect(s.projects.find((p) => p.id === 'p1')?.name).toBe('New')
      expect(s.projects.find((p) => p.id === 'p2')?.name).toBe('Proj')
    })
  })

  describe('deleteProject', () => {
    it('removes the project + clears currentProject when it matches', async () => {
      mockedApi.delete.mockResolvedValue({ data: undefined })
      const s = useProjectStore()
      s.projects = [makeProject('p1'), makeProject('p2')]
      s.currentProject = makeDetail('p1')
      await s.deleteProject('p1')
      expect(s.projects.map((p) => p.id)).toEqual(['p2'])
      expect(s.currentProject).toBeNull()
    })
  })

  describe('updateStatus', () => {
    it('updates summary + currentProject when the id matches', async () => {
      mockedApi.post.mockResolvedValue({ data: undefined })
      const s = useProjectStore()
      s.projects = [makeProject('p1', { status: 'Realisation' })]
      s.currentProject = makeDetail('p1')
      await s.updateStatus('p1', 'Cloture' as never)
      expect(s.projects[0].status).toBe('Cloture')
      expect(s.currentProject?.status).toBe('Cloture')
    })
  })

  describe('addField / removeField', () => {
    it('appends a field to currentProject when ids match', async () => {
      const s = useProjectStore()
      s.currentProject = { ...makeDetail('p1'), fields: [] as never }
      const field = { id: 'f-new', label: 'Stack' } as never
      mockedApi.post.mockResolvedValue({ data: field })
      const r = await s.addField('p1', { label: 'Stack' } as never)
      expect(r).toEqual(field)
      expect(s.currentProject?.fields).toHaveLength(1)
    })

    it('removes a field from currentProject', async () => {
      const s = useProjectStore()
      s.currentProject = { ...makeDetail('p1'), fields: [{ id: 'f1' }, { id: 'f2' }] as never }
      mockedApi.delete.mockResolvedValue({ data: undefined })
      await s.removeField('p1', 'f1')
      expect(s.currentProject?.fields.map((f) => f.id)).toEqual(['f2'])
    })
  })

  describe('selection', () => {
    it('toggle, selectAll, clearSelection', () => {
      const s = useProjectStore()
      s.toggleSelection('p1')
      expect(s.selectedProjectIds).toEqual(['p1'])
      s.toggleSelection('p2')
      expect(s.selectedProjectIds).toEqual(['p1', 'p2'])
      s.toggleSelection('p1')
      expect(s.selectedProjectIds).toEqual(['p2'])
      s.selectAll(['a', 'b', 'c'])
      expect(s.selectedProjectIds).toEqual(['a', 'b', 'c'])
      s.clearSelection()
      expect(s.selectedProjectIds).toEqual([])
    })
  })

  describe('bulk actions', () => {
    it('bulkArchive POSTs ids then refetches', async () => {
      mockedApi.post.mockResolvedValue({ data: undefined })
      mockedApi.get.mockResolvedValue({ data: { items: [], total: 0 } })
      const s = useProjectStore()
      await s.bulkArchive(['p1', 'p2'])
      expect(mockedApi.post).toHaveBeenCalledWith('/admin/project/bulk-archive', { projectIds: ['p1', 'p2'] })
      expect(mockedApi.get).toHaveBeenCalled()
    })

    it('bulkUpdateStatus + bulkAssignManager wrap their endpoints', async () => {
      mockedApi.post.mockResolvedValue({ data: undefined })
      mockedApi.get.mockResolvedValue({ data: { items: [] } })
      const s = useProjectStore()
      await s.bulkUpdateStatus(['p1'], 'Cloture')
      await s.bulkAssignManager(['p1'], 'u-pm')
      expect(mockedApi.post).toHaveBeenNthCalledWith(1, '/admin/project/bulk-status', { projectIds: ['p1'], status: 'Cloture' })
      expect(mockedApi.post).toHaveBeenNthCalledWith(2, '/admin/project/bulk-assign-manager', { projectIds: ['p1'], managerId: 'u-pm' })
    })
  })

  describe('trash', () => {
    it('fetchDeletedProjects parses envelope or raw array', async () => {
      mockedApi.get
        .mockResolvedValueOnce({ data: { items: [{ id: 'p1' }] } })
        .mockResolvedValueOnce({ data: [{ id: 'p2' }] })
      const s = useProjectStore()
      await s.fetchDeletedProjects()
      expect(s.deletedProjects).toHaveLength(1)
      await s.fetchDeletedProjects()
      expect(s.deletedProjects).toHaveLength(1)
    })

    it('restoreProject removes from deletedProjects + refetches', async () => {
      mockedApi.post.mockResolvedValue({ data: undefined })
      mockedApi.get.mockResolvedValue({ data: { items: [], total: 0 } })
      const s = useProjectStore()
      s.deletedProjects = [{ id: 'p1' } as never, { id: 'p2' } as never]
      await s.restoreProject('p1')
      expect(s.deletedProjects.map((p) => p.id)).toEqual(['p2'])
    })

    it('purgeProject removes from deletedProjects', async () => {
      mockedApi.delete.mockResolvedValue({ data: undefined })
      const s = useProjectStore()
      s.deletedProjects = [{ id: 'p1' } as never]
      await s.purgeProject('p1')
      expect(s.deletedProjects).toEqual([])
    })
  })

  describe('getters', () => {
    it('draftProjects / activeProjects filter by status', () => {
      const s = useProjectStore()
      s.projects = [
        makeProject('p1', { status: 'Draft' }),
        makeProject('p2', { status: 'Realisation' }),
        makeProject('p3', { status: 'Cloture' }),
        makeProject('p4', { status: 'Archived' }),
      ]
      expect(s.draftProjects.map((p) => p.id)).toEqual(['p1'])
      expect(s.activeProjects.map((p) => p.id)).toEqual(['p2'])
    })
  })

  describe('templates', () => {
    it('fetchTemplates populates the list', async () => {
      mockedApi.get.mockResolvedValue({ data: [{ id: 't1' }] })
      const s = useProjectStore()
      await s.fetchTemplates()
      expect(s.templates).toHaveLength(1)
    })

    it('fetchTemplates resets to [] on failure', async () => {
      mockedApi.get.mockRejectedValue(new Error('500'))
      const s = useProjectStore()
      s.templates = [{ id: 'old' } as never]
      await s.fetchTemplates()
      expect(s.templates).toEqual([])
    })

    it('deleteTemplate filters in place', async () => {
      mockedApi.delete.mockResolvedValue({ data: undefined })
      const s = useProjectStore()
      s.templates = [{ id: 't1' } as never, { id: 't2' } as never]
      await s.deleteTemplate('t1')
      expect(s.templates.map((t) => t.id)).toEqual(['t2'])
    })
  })

  describe('reset', () => {
    it('wipes all per-user state', () => {
      const s = useProjectStore()
      s.projects = [makeProject('p1')]
      s.currentProject = makeDetail('p1')
      s.totalProjects = 1
      s.searchQuery = 'foo'
      s.statusFilter = 'Realisation'
      s.selectedProjectIds = ['p1']
      s.reset()
      expect(s.projects).toEqual([])
      expect(s.currentProject).toBeNull()
      expect(s.totalProjects).toBe(0)
      expect(s.searchQuery).toBe('')
      expect(s.statusFilter).toBe('')
      expect(s.selectedProjectIds).toEqual([])
    })
  })
})
