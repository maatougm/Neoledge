/**
 * @file     projectStore.ts
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Pinia store for project management — immutable state updates
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { useApp } from './useApp'
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
} from '@/types/project.types'

export const useProjectStore = defineStore('projects', () => {
  // ─── State ──────────────────────────────────────────────────────────────────
  const projects = ref<ProjectSummary[]>([])
  const currentProject = ref<ProjectDetail | null>(null)
  const activities = ref<ProjectActivity[]>([])
  const templates = ref<ProjectTemplateSummary[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ─── Getters ─────────────────────────────────────────────────────────────────
  const draftProjects = computed(() => projects.value.filter((p) => p.status === 'Draft'))
  const activeProjects = computed(() =>
    projects.value.filter((p) => p.status !== 'Draft' && p.status !== 'Completed'),
  )

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const apiBase = () => useApp().apiUrl + '/admin/Project'
  const authHeader = () => {
    const jwt = useApp().jwt
    return jwt ? { Authorization: `Bearer ${jwt}` } : {}
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const fetchAll = async () => {
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.get<ProjectSummary[]>(apiBase(), { headers: authHeader() })
      projects.value = [...data]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des projets.'
    } finally {
      loading.value = false
    }
  }

  const fetchById = async (id: string) => {
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.get<ProjectDetail>(`${apiBase()}/${id}`, {
        headers: authHeader(),
      })
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
      const { data } = await axios.post<ProjectDetail>(apiBase(), payload, {
        headers: authHeader(),
      })
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

  const updateProject = async (id: string, payload: UpdateProjectPayload): Promise<ProjectDetail | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.put<ProjectDetail>(`${apiBase()}/${id}`, payload, {
        headers: authHeader(),
      })
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
      await axios.delete(`${apiBase()}/${id}`, { headers: authHeader() })
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
      await axios.post(`${apiBase()}/${projectId}/assign-manager`, payload, {
        headers: authHeader(),
      })
      await fetchAll()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors de l'assignation du chef de projet."
    } finally {
      loading.value = false
    }
  }

  const updateStatus = async (projectId: string, status: ProjectStatus) => {
    loading.value = true
    error.value = null
    try {
      await axios.post(
        `${apiBase()}/${projectId}/status`,
        { status },
        { headers: authHeader() },
      )
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
      await axios.patch(`${apiBase()}/${projectId}/archive`, null, { headers: authHeader() })
      projects.value = projects.value.map((p) =>
        p.id === projectId ? { ...p, status: 'Archived' as ProjectStatus } : p,
      )
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors de l'archivage."
    } finally {
      loading.value = false
    }
  }

  const addField = async (projectId: string, payload: AddFieldPayload): Promise<ProjectField | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.post<ProjectField>(
        `${apiBase()}/${projectId}/fields`,
        payload,
        { headers: authHeader() },
      )
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
      await axios.delete(`${apiBase()}/${projectId}/fields/${fieldId}`, { headers: authHeader() })
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
      await axios.patch(
        `${apiBase()}/${projectId}/toggle-manager-fields`,
        { allow },
        { headers: authHeader() },
      )
      if (currentProject.value?.id === projectId) {
        currentProject.value = { ...currentProject.value, allowManagerCustomFields: allow }
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la mise à jour des permissions.'
    } finally {
      loading.value = false
    }
  }

  // ─── Activity ────────────────────────────────────────────────────────────────
  const fetchActivity = async (projectId: string) => {
    try {
      const { data } = await axios.get<ProjectActivity[]>(`${apiBase()}/${projectId}/activity`, { headers: authHeader() })
      activities.value = [...data]
    } catch {
      activities.value = []
    }
  }

  // ─── Templates ───────────────────────────────────────────────────────────────
  const apiTemplates = () => useApp().apiUrl + '/admin/projecttemplate'

  const fetchTemplates = async () => {
    try {
      const { data } = await axios.get<ProjectTemplateSummary[]>(apiTemplates(), { headers: authHeader() })
      templates.value = [...data]
    } catch {
      templates.value = []
    }
  }

  const createTemplate = async (payload: CreateTemplatePayload) => {
    await axios.post(apiTemplates(), payload, { headers: authHeader() })
    await fetchTemplates()
  }

  const deleteTemplate = async (id: string) => {
    await axios.delete(`${apiTemplates()}/${id}`, { headers: authHeader() })
    templates.value = templates.value.filter((t) => t.id !== id)
  }

  const applyTemplate = async (templateId: string, projectId: string) => {
    await axios.post(`${apiTemplates()}/${templateId}/apply/${projectId}`, {}, { headers: authHeader() })
  }

  return {
    projects,
    currentProject,
    activities,
    templates,
    loading,
    error,
    draftProjects,
    activeProjects,
    fetchAll,
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
    fetchActivity,
    fetchTemplates,
    createTemplate,
    deleteTemplate,
    applyTemplate,
  }
})
