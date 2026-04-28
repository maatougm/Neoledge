import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { computeProgress } from '../projectStore'
import type {
  ProjectSummary,
  ProjectDetail,
  ProjectField,
} from '@/types/project.types'

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from '@/lib/api'

const mockSummary: ProjectSummary = {
  id: 'p1',
  name: 'Projet Alpha',
  clientName: 'Client A',
  projectManagerName: 'Marie Martin',
  projectManagerEmail: 'marie@test.com',
  status: 'Draft',
  startDate: '2026-04-01',
  endDate: '2026-06-01',
  createdAt: '2026-03-26T00:00:00Z',
}

const mockSummaryActive: ProjectSummary = {
  ...mockSummary,
  id: 'p2',
  name: 'Projet Beta',
  status: 'Kickoff',
}

const mockSummaryCompleted: ProjectSummary = {
  ...mockSummary,
  id: 'p3',
  name: 'Projet Gamma',
  status: 'Cloture',
}

const mockField: ProjectField = {
  id: 'f1',
  label: 'Societe',
  fieldType: 'Text',
  isRequired: true,
  defaultValue: null,
  orderIndex: 1,
  fieldCategory: 'Static',
  options: null,
}

const mockDetail: ProjectDetail = {
  id: 'p1',
  name: 'Projet Alpha',
  clientName: 'Client A',
  status: 'Draft',
  allowManagerCustomFields: false,
  startDate: '2026-04-01',
  endDate: '2026-06-01',
  createdAt: '2026-03-26T00:00:00Z',
  updatedAt: '2026-03-26T00:00:00Z',
  projectManager: null,
  fields: [mockField],
  fieldValues: [],
}

// Helper to build the envelope shape the current store expects
const envelope = (items: ProjectSummary[]) => ({ data: { items, total: items.length } })

describe('useProjectStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(api.get).mockReset()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.put).mockReset()
    vi.mocked(api.delete).mockReset()
    vi.mocked(api.patch).mockReset()
  })

  const getStore = async () => {
    const { useProjectStore } = await import('../projectStore')
    return useProjectStore()
  }

  // ─── fetchAll ────────────────────────────────────────────────────────────────

  describe('fetchAll', () => {
    it('calls correct URL and sets projects state', async () => {
      vi.mocked(api.get).mockResolvedValueOnce(envelope([mockSummary]) as never)

      const store = await getStore()
      await store.fetchAll()

      expect(api.get).toHaveBeenCalledWith('/admin/project')
      expect(store.projects).toHaveLength(1)
      expect(store.projects[0]).toEqual(mockSummary)
      expect(store.loading).toBe(false)
    })

    it('accepts a plain array response for backward compat', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockSummary] } as never)

      const store = await getStore()
      await store.fetchAll()

      expect(store.projects).toHaveLength(1)
    })

    it('sets error on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Server down'))

      const store = await getStore()
      await store.fetchAll()

      expect(store.error).toBe('Server down')
      expect(store.loading).toBe(false)
    })
  })

  // ─── fetchById ───────────────────────────────────────────────────────────────

  describe('fetchById', () => {
    it('calls correct URL and sets currentProject', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: mockDetail } as never)

      const store = await getStore()
      const result = await store.fetchById('p1')

      expect(api.get).toHaveBeenCalledWith('/admin/project/p1')
      expect(store.currentProject).toEqual(mockDetail)
      expect(result).toEqual(mockDetail)
    })
  })

  // ─── createProject ──────────────────────────────────────────────────────────

  describe('createProject', () => {
    it('posts payload and refreshes list', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ data: mockDetail } as never)
      vi.mocked(api.get).mockResolvedValueOnce(envelope([mockSummary]) as never)

      const store = await getStore()
      const payload = {
        name: 'Projet Alpha',
        clientName: 'Client A',
        startDate: '2026-04-01',
        endDate: '2026-06-01',
        projectManagerId: '11111111-1111-1111-1111-111111111111',
      }
      const result = await store.createProject(payload)

      expect(api.post).toHaveBeenCalledWith('/admin/project', payload)
      expect(result).toEqual(mockDetail)
      expect(store.currentProject).toEqual(mockDetail)
      expect(api.get).toHaveBeenCalled()
    })
  })

  // ─── deleteProject ──────────────────────────────────────────────────────────

  describe('deleteProject', () => {
    it('removes from state and clears currentProject if matching', async () => {
      vi.mocked(api.get).mockResolvedValueOnce(envelope([mockSummary, mockSummaryActive]) as never)

      const store = await getStore()
      await store.fetchAll()

      store.currentProject = { ...mockDetail }

      vi.mocked(api.delete).mockResolvedValueOnce({ data: undefined } as never)
      await store.deleteProject('p1')

      expect(api.delete).toHaveBeenCalledWith('/admin/project/p1')
      expect(store.projects).toHaveLength(1)
      expect(store.projects[0].id).toBe('p2')
      expect(store.currentProject).toBeNull()
    })
  })

  // ─── assignManager ──────────────────────────────────────────────────────────

  describe('assignManager', () => {
    it('posts to correct URL and refreshes list', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ data: undefined } as never)
      vi.mocked(api.get).mockResolvedValueOnce(envelope([mockSummary]) as never)

      const store = await getStore()
      await store.assignManager('p1', { projectManagerId: 'u2' })

      expect(api.post).toHaveBeenCalledWith('/admin/project/p1/assign-manager', {
        projectManagerId: 'u2',
      })
      expect(api.get).toHaveBeenCalledWith('/admin/project')
    })
  })

  // ─── updateStatus ───────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('updates project status in state immutably', async () => {
      vi.mocked(api.get).mockResolvedValueOnce(envelope([mockSummary]) as never)

      const store = await getStore()
      await store.fetchAll()
      const originalRef = store.projects

      vi.mocked(api.post).mockResolvedValueOnce({ data: undefined } as never)
      await store.updateStatus('p1', 'Kickoff')

      expect(store.projects[0].status).toBe('Kickoff')
      expect(store.projects).not.toBe(originalRef)
    })

    it('also updates currentProject if matching', async () => {
      const store = await getStore()
      store.currentProject = { ...mockDetail }

      vi.mocked(api.post).mockResolvedValueOnce({ data: undefined } as never)
      await store.updateStatus('p1', 'Kickoff')

      expect(store.currentProject?.status).toBe('InProgress')
    })
  })

  // ─── archiveProject ─────────────────────────────────────────────────────────

  describe('archiveProject', () => {
    it('patches status to Archived in state immutably', async () => {
      vi.mocked(api.get).mockResolvedValueOnce(envelope([mockSummary]) as never)

      const store = await getStore()
      await store.fetchAll()
      const originalRef = store.projects

      vi.mocked(api.patch).mockResolvedValueOnce({ data: undefined } as never)
      await store.archiveProject('p1')

      expect(store.projects[0].status).toBe('Archived')
      expect(store.projects).not.toBe(originalRef)
    })
  })

  // ─── addField ───────────────────────────────────────────────────────────────

  describe('addField', () => {
    it('adds field to currentProject.fields immutably', async () => {
      const store = await getStore()
      store.currentProject = { ...mockDetail, fields: [mockField] }
      const originalFieldsRef = store.currentProject.fields

      const newField: ProjectField = {
        id: 'f2',
        label: 'Code client',
        fieldType: 'Text',
        isRequired: true,
        defaultValue: null,
        orderIndex: 2,
        fieldCategory: 'Static',
        options: null,
      }
      vi.mocked(api.post).mockResolvedValueOnce({ data: newField } as never)

      const result = await store.addField('p1', {
        label: 'Code client',
        fieldType: 'Text',
        isRequired: true,
        options: null,
      })

      expect(result).toEqual(newField)
      expect(store.currentProject?.fields).toHaveLength(2)
      expect(store.currentProject?.fields[1]).toEqual(newField)
      expect(store.currentProject?.fields).not.toBe(originalFieldsRef)
    })
  })

  // ─── removeField ────────────────────────────────────────────────────────────

  describe('removeField', () => {
    it('removes field from currentProject.fields immutably', async () => {
      const store = await getStore()
      store.currentProject = { ...mockDetail, fields: [mockField] }
      const originalFieldsRef = store.currentProject.fields

      vi.mocked(api.delete).mockResolvedValueOnce({ data: undefined } as never)
      await store.removeField('p1', 'f1')

      expect(store.currentProject?.fields).toHaveLength(0)
      expect(store.currentProject?.fields).not.toBe(originalFieldsRef)
    })
  })

  // ─── Getters ─────────────────────────────────────────────────────────────────

  describe('draftProjects getter', () => {
    it('filters Draft status', async () => {
      vi.mocked(api.get).mockResolvedValueOnce(
        envelope([mockSummary, mockSummaryActive, mockSummaryCompleted]) as never,
      )

      const store = await getStore()
      await store.fetchAll()

      expect(store.draftProjects).toHaveLength(1)
      expect(store.draftProjects[0].status).toBe('Draft')
    })
  })

  describe('activeProjects getter', () => {
    it('excludes Draft and Completed', async () => {
      vi.mocked(api.get).mockResolvedValueOnce(
        envelope([mockSummary, mockSummaryActive, mockSummaryCompleted]) as never,
      )

      const store = await getStore()
      await store.fetchAll()

      expect(store.activeProjects).toHaveLength(1)
      expect(store.activeProjects[0].status).toBe('InProgress')
    })
  })
})

// ─── computeProgress — pure function tests ────────────────────────────────────

function makeRequiredField(id: string): ProjectField {
  return {
    id,
    label: `Field ${id}`,
    fieldType: 'Text',
    isRequired: true,
    defaultValue: null,
    orderIndex: 0,
    fieldCategory: 'Static',
    options: null,
  }
}

function makeOptionalField(id: string): ProjectField {
  return { ...makeRequiredField(id), isRequired: false }
}

function makeProjectDetail(
  fields: ProjectField[],
  values: Array<{ projectFieldId: string; value: string | null }>,
): ProjectDetail {
  return {
    id: 'test',
    name: 'Test',
    clientName: 'Client',
    status: 'Draft',
    allowManagerCustomFields: false,
    startDate: '',
    endDate: '',
    createdAt: '',
    updatedAt: '',
    projectManager: null,
    fields,
    fieldValues: values.map((v) => ({ ...v, label: `Field ${v.projectFieldId}` })),
  }
}

describe('computeProgress', () => {
  it('returns 100 when there are no required fields', () => {
    const project = makeProjectDetail([makeOptionalField('f1')], [])
    expect(computeProgress(project)).toBe(100)
  })

  it('returns 100 when there are no fields at all', () => {
    const project = makeProjectDetail([], [])
    expect(computeProgress(project)).toBe(100)
  })

  it('returns 50 when 1 of 2 required fields is filled', () => {
    const project = makeProjectDetail(
      [makeRequiredField('f1'), makeRequiredField('f2')],
      [{ projectFieldId: 'f1', value: 'filled' }],
    )
    expect(computeProgress(project)).toBe(50)
  })

  it('returns 0 when no required fields are filled', () => {
    const project = makeProjectDetail(
      [makeRequiredField('f1'), makeRequiredField('f2')],
      [],
    )
    expect(computeProgress(project)).toBe(0)
  })

  it('returns 100 when all required fields are filled', () => {
    const project = makeProjectDetail(
      [makeRequiredField('f1'), makeRequiredField('f2')],
      [
        { projectFieldId: 'f1', value: 'v1' },
        { projectFieldId: 'f2', value: 'v2' },
      ],
    )
    expect(computeProgress(project)).toBe(100)
  })

  it('treats whitespace-only value as not filled', () => {
    const project = makeProjectDetail(
      [makeRequiredField('f1')],
      [{ projectFieldId: 'f1', value: '   ' }],
    )
    expect(computeProgress(project)).toBe(0)
  })

  it('treats null value as not filled', () => {
    const project = makeProjectDetail(
      [makeRequiredField('f1')],
      [{ projectFieldId: 'f1', value: null }],
    )
    expect(computeProgress(project)).toBe(0)
  })

  it('ignores non-required fields when computing progress', () => {
    const project = makeProjectDetail(
      [makeRequiredField('req'), makeOptionalField('opt')],
      [{ projectFieldId: 'req', value: 'filled' }],
    )
    expect(computeProgress(project)).toBe(100)
  })
})
