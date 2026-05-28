import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { ProjectTemplateSummary, CreateTemplatePayload } from '@/types/project.types'

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

const mockTemplate: ProjectTemplateSummary = {
  id: 'tpl-1',
  name: 'Modèle Standard',
  description: 'Champs NeoLeadge standard',
  fieldCount: 3,
  createdAt: '2026-04-01T00:00:00Z',
}

const mockTemplate2: ProjectTemplateSummary = {
  id: 'tpl-2',
  name: 'Modèle Express',
  description: null,
  fieldCount: 1,
  createdAt: '2026-04-02T00:00:00Z',
}

const createPayload: CreateTemplatePayload = {
  name: 'Modèle Standard',
  description: 'Champs NeoLeadge standard',
  fields: [
    { label: 'Société', type: 'Text', category: 'Custom', isRequired: true, displayOrder: 0, options: null },
  ],
}

describe('useTemplateStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(api.get).mockReset()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.delete).mockReset()
  })

  const getStore = async () => {
    const { useTemplateStore } = await import('../templateStore')
    return useTemplateStore()
  }

  // ─── fetchTemplates ────────────────────────────────────────────────────────

  describe('fetchTemplates', () => {
    it('calls correct URL and populates templates state', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockTemplate, mockTemplate2] } as never)

      const store = await getStore()
      await store.fetchTemplates()

      expect(api.get).toHaveBeenCalledWith('/pm/templates')
      expect(store.templates).toHaveLength(2)
      expect(store.templates[0]).toEqual(mockTemplate)
      expect(store.loading).toBe(false)
      expect(store.error).toBeNull()
    })

    it('sets empty state and error on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'))

      const store = await getStore()
      await store.fetchTemplates()

      expect(store.templates).toHaveLength(0)
      expect(store.error).toBe('Network error')
      expect(store.loading).toBe(false)
    })

    it('populates state immutably (new array reference each call)', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockTemplate] } as never)

      const store = await getStore()
      await store.fetchTemplates()
      const firstRef = store.templates

      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockTemplate, mockTemplate2] } as never)
      await store.fetchTemplates()

      expect(store.templates).not.toBe(firstRef)
      expect(store.templates).toHaveLength(2)
    })
  })

  // ─── fetchTemplate ─────────────────────────────────────────────────────────

  describe('fetchTemplate', () => {
    it('fetches a single template and sets currentTemplate', async () => {
      const detail = { ...mockTemplate, fields: [{ id: 'f1', label: 'Société', type: 'Text', category: 'Custom', isRequired: true, displayOrder: 0, options: null }] }
      vi.mocked(api.get).mockResolvedValueOnce({ data: detail } as never)

      const store = await getStore()
      const result = await store.fetchTemplate('tpl-1')

      expect(api.get).toHaveBeenCalledWith('/pm/templates/tpl-1')
      expect(result).toEqual(detail)
      expect(store.currentTemplate).toEqual(detail)
    })

    it('returns null and sets error on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Not found'))

      const store = await getStore()
      const result = await store.fetchTemplate('unknown')

      expect(result).toBeNull()
      expect(store.error).toBe('Not found')
    })
  })

  // ─── createTemplate ────────────────────────────────────────────────────────

  describe('createTemplate', () => {
    it('posts payload and refreshes templates list', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ data: mockTemplate } as never)
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockTemplate] } as never)

      const store = await getStore()
      const result = await store.createTemplate(createPayload)

      expect(api.post).toHaveBeenCalledWith('/pm/templates', createPayload)
      expect(result).toEqual(mockTemplate)
      expect(store.templates).toHaveLength(1)
    })

    it('returns null and sets error on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Validation error'))

      const store = await getStore()
      const result = await store.createTemplate(createPayload)

      expect(result).toBeNull()
      expect(store.error).toBe('Validation error')
    })
  })

  // ─── deleteTemplate ────────────────────────────────────────────────────────

  describe('deleteTemplate', () => {
    it('removes template from state immutably', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockTemplate, mockTemplate2] } as never)

      const store = await getStore()
      await store.fetchTemplates()
      const originalRef = store.templates

      vi.mocked(api.delete).mockResolvedValueOnce({ data: undefined } as never)
      await store.deleteTemplate('tpl-1')

      expect(api.delete).toHaveBeenCalledWith('/pm/templates/tpl-1')
      expect(store.templates).toHaveLength(1)
      expect(store.templates[0].id).toBe('tpl-2')
      expect(store.templates).not.toBe(originalRef)
    })

    it('sets error on failure and keeps existing state', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockTemplate] } as never)

      const store = await getStore()
      await store.fetchTemplates()

      vi.mocked(api.delete).mockRejectedValueOnce(new Error('Forbidden'))
      await store.deleteTemplate('tpl-1')

      expect(store.templates).toHaveLength(1)
      expect(store.error).toBe('Forbidden')
    })
  })

  // ─── applyToProject ────────────────────────────────────────────────────────

  describe('applyToProject', () => {
    it('calls the correct endpoint with template and project IDs', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ data: undefined } as never)

      const store = await getStore()
      await store.applyToProject('tpl-1', 'proj-42')

      expect(api.post).toHaveBeenCalledWith('/pm/templates/tpl-1/apply/proj-42', {})
      expect(store.error).toBeNull()
    })

    it('re-throws on failure and sets error', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Apply failed'))

      const store = await getStore()
      await expect(store.applyToProject('tpl-1', 'proj-42')).rejects.toThrow('Apply failed')
      expect(store.error).toBe('Apply failed')
    })
  })

  // ─── createFromProject ─────────────────────────────────────────────────────

  describe('createFromProject', () => {
    it('posts to from-project endpoint and refreshes templates', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ data: mockTemplate } as never)
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockTemplate] } as never)

      const store = await getStore()
      const result = await store.createFromProject('proj-1', { name: 'Modèle Standard' })

      expect(api.post).toHaveBeenCalledWith('/pm/templates/from-project/proj-1', {
        name: 'Modèle Standard',
      })
      expect(result).toEqual(mockTemplate)
      expect(store.templates).toHaveLength(1)
    })

    it('returns null and sets error on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Project not found'))

      const store = await getStore()
      const result = await store.createFromProject('proj-unknown', { name: 'X' })

      expect(result).toBeNull()
      expect(store.error).toBe('Project not found')
    })
  })
})
