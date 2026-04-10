/**
 * @file src/stores/projectStore.ts — Pinia store for project management — immutable state updates
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/lib/api'
import type {
  ProjectSummary,
  ProjectDetail,
  ProjectField,
  CreateProjectPayload,
  UpdateProjectPayload,
  AssignManagerPayload,
  AddFieldPayload,
  ProjectStatus,
  ProjectActivity,
  ProjectTemplateSummary,
  CreateTemplatePayload,
  DeletedProjectSummary,
} from '@/types/project.types'

// ─── Pure helper — exported for testing ──────────────────────────────────────

/**
 * Computes the fill percentage of required fields for a project detail.
 * Returns 100 when there are no required fields.
 */
export function computeProgress(project: ProjectDetail): number {
  const requiredFields = project.fields.filter((f) => f.isRequired)
  if (requiredFields.length === 0) return 100
  const filled = requiredFields.filter((f) => {
    const val = project.fieldValues.find((v) => v.projectFieldId === f.id)
    return val?.value !== null && val?.value !== undefined && val.value.trim() !== ''
  })
  return Math.round((filled.length / requiredFields.length) * 100)
}

export const useProjectStore = defineStore('projects', () => {
  // ─── State ──────────────────────────────────────────────────────────────────
  const projects = ref<ProjectSummary[]>([])
  const currentProject = ref<ProjectDetail | null>(null)
  const activities = ref<ProjectActivity[]>([])
  const templates = ref<ProjectTemplateSummary[]>([])
  const deletedProjects = ref<DeletedProjectSummary[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const searchQuery = ref<string>('')
  const statusFilter = ref<string>('')
  const totalProjects = ref<number>(0)
  const selectedProjectIds = ref<string[]>([])

  // ─── Getters ─────────────────────────────────────────────────────────────────
  const draftProjects = computed(() => projects.value.filter((p) => p.status === 'Draft'))
  const activeProjects = computed(() =>
    projects.value.filter((p) => p.status !== 'Draft' && p.status !== 'Completed'),
  )

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const fetchAll = async () => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<{ items: ProjectSummary[]; total: number }>('/admin/Project')
      const items = Array.isArray(data) ? data : (data.items ?? [])
      projects.value = [...items]
      totalProjects.value = Array.isArray(data) ? data.length : (data.total ?? items.length)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des projets.'
    } finally {
      loading.value = false
    }
  }

  const searchProjects = async (params: {
    search?: string
    status?: string
    skip?: number
    take?: number
  }) => {
    loading.value = true
    error.value = null
    searchQuery.value = params.search ?? ''
    statusFilter.value = params.status ?? ''
    try {
      const queryParams = new URLSearchParams()
      if (params.search) queryParams.set('search', params.search)
      if (params.status) queryParams.set('status', params.status)
      if (params.skip !== undefined) queryParams.set('skip', String(params.skip))
      if (params.take !== undefined) queryParams.set('take', String(params.take))
      const url = queryParams.toString()
        ? `/admin/Project?${queryParams.toString()}`
        : '/admin/Project'
      const { data } = await api.get<{ items: ProjectSummary[]; total: number }>(url)
      const items = Array.isArray(data) ? data : (data.items ?? [])
      projects.value = [...items]
      totalProjects.value = Array.isArray(data) ? data.length : (data.total ?? items.length)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la recherche des projets.'
    } finally {
      loading.value = false
    }
  }

  const fetchById = async (id: string) => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<ProjectDetail>(`/admin/Project/${id}`)
      currentProject.value = { ...data }
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement du projet.'
      return null
    } finally {
      loading.value = false
    }
  }

  const createProject = async (payload: CreateProjectPayload): Promise<ProjectDetail | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.post<ProjectDetail>('/admin/Project', payload)
      currentProject.value = { ...data }
      await fetchAll()
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la création du projet.'
      return null
    } finally {
      loading.value = false
    }
  }

  const updateProject = async (
    id: string,
    payload: UpdateProjectPayload,
  ): Promise<ProjectDetail | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.put<ProjectDetail>(`/admin/Project/${id}`, payload)
      currentProject.value = { ...data }
      projects.value = projects.value.map((p) =>
        p.id === id
          ? { ...p, name: data.name, clientName: data.clientName, status: data.status }
          : p,
      )
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la mise à jour.'
      return null
    } finally {
      loading.value = false
    }
  }

  const deleteProject = async (id: string) => {
    loading.value = true
    error.value = null
    try {
      await api.delete(`/admin/Project/${id}`)
      projects.value = projects.value.filter((p) => p.id !== id)
      if (currentProject.value?.id === id) currentProject.value = null
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la suppression.'
    } finally {
      loading.value = false
    }
  }

  const assignManager = async (projectId: string, payload: AssignManagerPayload) => {
    loading.value = true
    error.value = null
    try {
      await api.post(`/admin/Project/${projectId}/assign-manager`, payload)
      await fetchAll()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : "Erreur lors de l'assignation du chef de projet."
    } finally {
      loading.value = false
    }
  }

  const updateStatus = async (projectId: string, status: ProjectStatus) => {
    loading.value = true
    error.value = null
    try {
      await api.post(`/admin/Project/${projectId}/status`, { status })
      projects.value = projects.value.map((p) => (p.id === projectId ? { ...p, status } : p))
      if (currentProject.value?.id === projectId) {
        currentProject.value = { ...currentProject.value, status }
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la mise à jour du statut.'
    } finally {
      loading.value = false
    }
  }

  const archiveProject = async (projectId: string) => {
    loading.value = true
    error.value = null
    try {
      await api.patch(`/admin/Project/${projectId}/archive`, null)
      projects.value = projects.value.map((p) =>
        p.id === projectId ? { ...p, status: 'Archived' as ProjectStatus } : p,
      )
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors de l'archivage."
    } finally {
      loading.value = false
    }
  }

  const addField = async (
    projectId: string,
    payload: AddFieldPayload,
  ): Promise<ProjectField | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.post<ProjectField>(`/admin/Project/${projectId}/fields`, payload)
      if (currentProject.value?.id === projectId) {
        currentProject.value = {
          ...currentProject.value,
          fields: [...currentProject.value.fields, data],
        }
      }
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors de l'ajout du champ."
      return null
    } finally {
      loading.value = false
    }
  }

  const removeField = async (projectId: string, fieldId: string) => {
    loading.value = true
    error.value = null
    try {
      await api.delete(`/admin/Project/${projectId}/fields/${fieldId}`)
      if (currentProject.value?.id === projectId) {
        currentProject.value = {
          ...currentProject.value,
          fields: currentProject.value.fields.filter((f) => f.id !== fieldId),
        }
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la suppression du champ.'
    } finally {
      loading.value = false
    }
  }

  const toggleManagerFields = async (projectId: string, allow: boolean) => {
    loading.value = true
    error.value = null
    try {
      await api.patch(`/admin/Project/${projectId}/toggle-manager-fields`, { allow })
      if (currentProject.value?.id === projectId) {
        currentProject.value = { ...currentProject.value, allowManagerCustomFields: allow }
      }
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la mise à jour des permissions.'
    } finally {
      loading.value = false
    }
  }

  // ─── Selection ───────────────────────────────────────────────────────────────

  const toggleSelection = (id: string): void => {
    if (selectedProjectIds.value.includes(id)) {
      selectedProjectIds.value = selectedProjectIds.value.filter((sid) => sid !== id)
    } else {
      selectedProjectIds.value = [...selectedProjectIds.value, id]
    }
  }

  const selectAll = (ids: string[]): void => {
    selectedProjectIds.value = [...ids]
  }

  const clearSelection = (): void => {
    selectedProjectIds.value = []
  }

  // ─── Bulk Actions ─────────────────────────────────────────────────────────────

  const bulkArchive = async (ids: string[]): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      await api.post('/admin/Project/bulk-archive', { ids })
      await fetchAll()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors de l'archivage en masse."
    } finally {
      loading.value = false
    }
  }

  const bulkUpdateStatus = async (ids: string[], status: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      await api.post('/admin/Project/bulk-status', { ids, status })
      await fetchAll()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors du changement de statut en masse.'
    } finally {
      loading.value = false
    }
  }

  const bulkAssignManager = async (ids: string[], managerId: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      await api.post('/admin/Project/bulk-assign-manager', { ids, managerId })
      await fetchAll()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors de l'assignation en masse."
    } finally {
      loading.value = false
    }
  }

  // ─── Trash ───────────────────────────────────────────────────────────────────

  const fetchDeletedProjects = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<DeletedProjectSummary[]>('/admin/Project/deleted')
      deletedProjects.value = [...data]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement de la corbeille.'
    } finally {
      loading.value = false
    }
  }

  const restoreProject = async (id: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      await api.post(`/admin/Project/${id}/restore`, null)
      deletedProjects.value = deletedProjects.value.filter((p) => p.id !== id)
      await fetchAll()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la restauration du projet.'
    } finally {
      loading.value = false
    }
  }

  const purgeProject = async (id: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      await api.delete(`/admin/Project/${id}/hard-delete`)
      deletedProjects.value = deletedProjects.value.filter((p) => p.id !== id)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la suppression définitive.'
    } finally {
      loading.value = false
    }
  }

  // ─── Activity ────────────────────────────────────────────────────────────────

  const fetchActivity = async (projectId: string) => {
    try {
      const { data } = await api.get<ProjectActivity[]>(
        `/admin/Project/${projectId}/activity`,
      )
      activities.value = [...data]
    } catch {
      activities.value = []
    }
  }

  // ─── Templates ───────────────────────────────────────────────────────────────

  const fetchTemplates = async () => {
    try {
      const { data } = await api.get<ProjectTemplateSummary[]>('/admin/projecttemplate')
      templates.value = [...data]
    } catch {
      templates.value = []
    }
  }

  const createTemplate = async (payload: CreateTemplatePayload) => {
    await api.post('/admin/projecttemplate', payload)
    await fetchTemplates()
  }

  const deleteTemplate = async (id: string) => {
    await api.delete(`/admin/projecttemplate/${id}`)
    templates.value = templates.value.filter((t) => t.id !== id)
  }

  const applyTemplate = async (templateId: string, projectId: string) => {
    await api.post(`/admin/projecttemplate/${templateId}/apply/${projectId}`, {})
  }

  return {
    projects,
    currentProject,
    activities,
    templates,
    deletedProjects,
    loading,
    error,
    searchQuery,
    statusFilter,
    totalProjects,
    selectedProjectIds,
    draftProjects,
    activeProjects,
    fetchAll,
    searchProjects,
    fetchById,
    createProject,
    updateProject,
    deleteProject,
    assignManager,
    updateStatus,
    archiveProject,
    addField,
    removeField,
    toggleManagerFields,
    fetchDeletedProjects,
    restoreProject,
    purgeProject,
    fetchActivity,
    fetchTemplates,
    createTemplate,
    deleteTemplate,
    applyTemplate,
    toggleSelection,
    selectAll,
    clearSelection,
    bulkArchive,
    bulkUpdateStatus,
    bulkAssignManager,
  }
})
