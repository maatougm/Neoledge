import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'
import type { ProjectSummary, ProjectDetail } from '@/types/project.types'
import type { ProjectValidation } from '@/types/pm.types'

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
  status: 'InProgress',
  startDate: '2026-04-01',
  endDate: '2026-06-01',
  createdAt: '2026-03-26T00:00:00Z',
}

const mockDetail: ProjectDetail = {
  id: 'p1',
  name: 'Projet Alpha',
  clientName: 'Client A',
  status: 'InProgress',
  allowManagerCustomFields: false,
  startDate: '2026-04-01',
  endDate: '2026-06-01',
  createdAt: '2026-03-26T00:00:00Z',
  updatedAt: '2026-03-26T00:00:00Z',
  projectManager: null,
  fields: [],
  fieldValues: [],
}

const mockValidation: ProjectValidation = {
  id: 'v1',
  projectId: 'p1',
  validatedByRole: 'ProjectManager',
  validatedByName: 'Marie Martin',
  phase: 'SpecificationValidation',
  isApproved: true,
  comment: 'Looks good',
  validatedAt: '2026-04-01T10:00:00Z',
}

const headers = { headers: { Authorization: 'Bearer fake-jwt-token' } }

describe('usePmStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(axios.get).mockReset()
    vi.mocked(axios.post).mockReset()
    vi.mocked(axios.patch).mockReset()
  })

  const getStore = async () => {
    const { usePmStore } = await import('../pmStore')
    return usePmStore()
  }

  // ─── fetchMyProjects ─────────────────────────────────────────────────────────

  describe('fetchMyProjects', () => {
    it('calls /pm/projects and sets state', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockSummary] })

      const store = await getStore()
      await store.fetchMyProjects()

      expect(axios.get).toHaveBeenCalledWith('http://test-api/pm/projects', headers)
      expect(store.projects).toHaveLength(1)
      expect(store.projects[0]).toEqual(mockSummary)
      expect(store.loading).toBe(false)
    })

    it('sets error on failure', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Forbidden'))

      const store = await getStore()
      await store.fetchMyProjects()

      expect(store.error).toBe('Forbidden')
      expect(store.loading).toBe(false)
    })
  })

  // ─── fetchProject ───────────────────────────────────────────────────────────

  describe('fetchProject', () => {
    it('calls both project detail and validations in parallel', async () => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: mockDetail })
        .mockResolvedValueOnce({ data: [mockValidation] })

      const store = await getStore()
      await store.fetchProject('p1')

      expect(axios.get).toHaveBeenCalledWith('http://test-api/pm/projects/p1', headers)
      expect(axios.get).toHaveBeenCalledWith(
        'http://test-api/pm/projects/p1/validations',
        headers,
      )
      expect(store.currentProject).toEqual(mockDetail)
      expect(store.validations).toHaveLength(1)
      expect(store.validations[0]).toEqual(mockValidation)
    })

    it('sets error on failure', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Not found'))

      const store = await getStore()
      await store.fetchProject('p1')

      expect(store.error).toBe('Not found')
      expect(store.loading).toBe(false)
    })
  })

  // ─── saveQuestionnaire ──────────────────────────────────────────────────────

  describe('saveQuestionnaire', () => {
    it('patches field values and returns true on success', async () => {
      vi.mocked(axios.patch).mockResolvedValueOnce({})

      const store = await getStore()
      const payload = {
        fieldValues: [{ projectFieldId: 'f1', value: 'Acme Corp' }],
      }
      const result = await store.saveQuestionnaire('p1', payload)

      expect(axios.patch).toHaveBeenCalledWith(
        'http://test-api/pm/projects/p1/field-values',
        payload,
        headers,
      )
      expect(result).toBe(true)
      expect(store.saving).toBe(false)
    })

    it('sets error on failure and returns false', async () => {
      vi.mocked(axios.patch).mockRejectedValueOnce(new Error('Save failed'))

      const store = await getStore()
      const result = await store.saveQuestionnaire('p1', { fieldValues: [] })

      expect(result).toBe(false)
      expect(store.error).toBe('Save failed')
    })
  })

  // ─── addCustomField ─────────────────────────────────────────────────────────

  describe('addCustomField', () => {
    it('posts field and refreshes project', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({})
      // fetchProject will call two GETs in parallel
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: mockDetail })
        .mockResolvedValueOnce({ data: [] })

      const store = await getStore()
      const payload = {
        label: 'Custom note',
        fieldType: 'Text' as const,
        isRequired: false,
        options: null,
      }
      const result = await store.addCustomField('p1', payload)

      expect(axios.post).toHaveBeenCalledWith(
        'http://test-api/pm/projects/p1/fields',
        payload,
        headers,
      )
      expect(result).toBe(true)
    })

    it('sets error on failure and returns false', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Field error'))

      const store = await getStore()
      const result = await store.addCustomField('p1', {
        label: 'X',
        fieldType: 'Text',
        isRequired: false,
        options: null,
      })

      expect(result).toBe(false)
      expect(store.error).toBe('Field error')
    })
  })

  // ─── submitValidation ───────────────────────────────────────────────────────

  describe('submitValidation', () => {
    it('posts validation and prepends to validations state', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: mockValidation })

      const store = await getStore()
      // Pre-populate with an existing validation
      const existingValidation: ProjectValidation = {
        ...mockValidation,
        id: 'v0',
        comment: 'Old one',
      }
      store.validations = [existingValidation]

      const result = await store.submitValidation('p1', {
        isApproved: true,
        comment: 'Looks good',
      })

      expect(axios.post).toHaveBeenCalledWith(
        'http://test-api/pm/projects/p1/validations',
        { isApproved: true, comment: 'Looks good' },
        headers,
      )
      expect(result).toBe(true)
      expect(store.validations).toHaveLength(2)
      // New validation is prepended
      expect(store.validations[0].id).toBe('v1')
      expect(store.validations[1].id).toBe('v0')
    })

    it('sets error on failure and returns false', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Submit error'))

      const store = await getStore()
      const result = await store.submitValidation('p1', {
        isApproved: false,
        comment: null,
      })

      expect(result).toBe(false)
      expect(store.error).toBe('Submit error')
    })
  })
})
