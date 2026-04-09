import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'
import { computeProgress } from '../projectStore'
import type {
  ProjectSummary,
  ProjectDetail,
  ProjectField,
  ProjectStatus,
} from '@/types/project.types'

vi.mock('axios')
vi.mock('../useApp', () => ({
  useApp: () => ({
    apiUrl: 'http://test-api',
    jwt: 'fake-jwt-token',
  }),
}))

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
  status: 'InProgress',
}

const mockSummaryCompleted: ProjectSummary = {
  ...mockSummary,
  id: 'p3',
  name: 'Projet Gamma',
  status: 'Completed',
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

const headers = { headers: { Authorization: 'Bearer fake-jwt-token' } }

describe('useProjectStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(axios.get).mockReset()
    vi.mocked(axios.post).mockReset()
    vi.mocked(axios.put).mockReset()
    vi.mocked(axios.delete).mockReset()
    vi.mocked(axios.patch).mockReset()
  })

  const getStore = async () => {
    const { useProjectStore } = await import('../projectStore')
    return useProjectStore()
  }

  // ─── fetchAll ────────────────────────────────────────────────────────────────

  describe('fetchAll', () => {
    it('calls correct URL and sets projects state', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockSummary] })

      const store = await getStore()
      await store.fetchAll()

      expect(axios.get).toHaveBeenCalledWith('http://test-api/admin/Project', headers)
      expect(store.projects).toHaveLength(1)
      expect(store.projects[0]).toEqual(mockSummary)
      expect(store.loading).toBe(false)
    })

    it('sets error on failure', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Server down'))

      const store = await getStore()
      await store.fetchAll()

      expect(store.error).toBe('Server down')
      expect(store.loading).toBe(false)
    })
  })

  // ─── fetchById ───────────────────────────────────────────────────────────────

  describe('fetchById', () => {
    it('calls correct URL and sets currentProject', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockDetail })

      const store = await getStore()
      const result = await store.fetchById('p1')

      expect(axios.get).toHaveBeenCalledWith('http://test-api/admin/Project/p1', headers)
      expect(store.currentProject).toEqual(mockDetail)
      expect(result).toEqual(mockDetail)
    })
  })

  // ─── createProject ──────────────────────────────────────────────────────────

  describe('createProject', () => {
    it('posts payload and refreshes list', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: mockDetail })
      // fetchAll is called after create
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockSummary] })

      const store = await getStore()
      const payload = {
        name: 'Projet Alpha',
        clientName: 'Client A',
        startDate: '2026-04-01',
        endDate: '2026-06-01',
      }
      const result = await store.createProject(payload)

      expect(axios.post).toHaveBeenCalledWith('http://test-api/admin/Project', payload, headers)
      expect(result).toEqual(mockDetail)
      expect(store.currentProject).toEqual(mockDetail)
      // fetchAll was called
      expect(axios.get).toHaveBeenCalled()
    })
  })

  // ─── deleteProject ──────────────────────────────────────────────────────────

  describe('deleteProject', () => {
    it('removes from state and clears currentProject if matching', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockSummary, mockSummaryActive] })

      const store = await getStore()
      await store.fetchAll()

      // Set currentProject to the one we will delete
      store.currentProject = { ...mockDetail }

      vi.mocked(axios.delete).mockResolvedValueOnce({})
      await store.deleteProject('p1')

      expect(axios.delete).toHaveBeenCalledWith('http://test-api/admin/Project/p1', headers)
      expect(store.projects).toHaveLength(1)
      expect(store.projects[0].id).toBe('p2')
      expect(store.currentProject).toBeNull()
    })
  })

  // ─── assignManager ──────────────────────────────────────────────────────────

  describe('assignManager', () => {
    it('posts to correct URL and refreshes list', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({})
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockSummary] })

      const store = await getStore()
      await store.assignManager('p1', { projectManagerId: 'u2' })

      expect(axios.post).toHaveBeenCalledWith(
        'http://test-api/admin/Project/p1/assign-manager',
        { projectManagerId: 'u2' },
        headers,
      )
      // fetchAll was called to refresh
      expect(axios.get).toHaveBeenCalledWith('http://test-api/admin/Project', headers)
    })
  })

  // ─── updateStatus ───────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('updates project status in state immutably', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockSummary] })

      const store = await getStore()
      await store.fetchAll()
      const originalRef = store.projects

      vi.mocked(axios.post).mockResolvedValueOnce({})
      await store.updateStatus('p1', 'InProgress')

      expect(store.projects[0].status).toBe('InProgress')
      expect(store.projects).not.toBe(originalRef)
    })

    it('also updates currentProject if matching', async () => {
      const store = await getStore()
      store.currentProject = { ...mockDetail }

      vi.mocked(axios.post).mockResolvedValueOnce({})
      await store.updateStatus('p1', 'InProgress')

      expect(store.currentProject?.status).toBe('InProgress')
    })
  })

  // ─── archiveProject ─────────────────────────────────────────────────────────

  describe('archiveProject', () => {
    it('patches status to Archived in state immutably', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockSummary] })

      const store = await getStore()
      await store.fetchAll()
      const originalRef = store.projects

      vi.mocked(axios.patch).mockResolvedValueOnce({})
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
      vi.mocked(axios.post).mockResolvedValueOnce({ data: newField })

      const result = await store.addField('p1', {
        label: 'Code client',
        fieldType: 'Text',
        isRequired: true,
        options: null,
      })

      expect(result).toEqual(newField)
      expect(store.currentProject?.fields).toHaveLength(2)
      expect(store.currentProject?.fields[1]).toEqual(newField)
      // Immutability: new array reference
      expect(store.currentProject?.fields).not.toBe(originalFieldsRef)
    })
  })

  // ─── removeField ────────────────────────────────────────────────────────────

  describe('removeField', () => {
    it('removes field from currentProject.fields immutably', async () => {
      const store = await getStore()
      store.currentProject = { ...mockDetail, fields: [mockField] }
      const originalFieldsRef = store.currentProject.fields

      vi.mocked(axios.delete).mockResolvedValueOnce({})
      await store.removeField('p1', 'f1')

      expect(store.currentProject?.fields).toHaveLength(0)
      expect(store.currentProject?.fields).not.toBe(originalFieldsRef)
    })
  })

  // ─── Getters ─────────────────────────────────────────────────────────────────

  describe('draftProjects getter', () => {
    it('filters Draft status', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: [mockSummary, mockSummaryActive, mockSummaryCompleted],
      })

      const store = await getStore()
      await store.fetchAll()

      expect(store.draftProjects).toHaveLength(1)
      expect(store.draftProjects[0].status).toBe('Draft')
    })
  })

  describe('activeProjects getter', () => {
    it('excludes Draft and Completed', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: [mockSummary, mockSummaryActive, mockSummaryCompleted],
      })

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
