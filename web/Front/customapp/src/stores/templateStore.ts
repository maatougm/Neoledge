/**
 * @file     templateStore.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Pinia store for project template management — immutable state updates
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'
import type {
  ProjectTemplateSummary,
  ProjectTemplate,
  CreateTemplatePayload,
  CreateFromProjectPayload,
} from '@/types/project.types'

export const useTemplateStore = defineStore('templates', () => {
  // ─── State ─────────────────────────────────────────────────────────────────
  const templates = ref<ProjectTemplateSummary[]>([])
  const currentTemplate = ref<ProjectTemplate | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ─── Actions ───────────────────────────────────────────────────────────────

  const fetchTemplates = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<ProjectTemplateSummary[]>('/pm/templates')
      templates.value = [...data]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des modèles.'
      templates.value = []
    } finally {
      loading.value = false
    }
  }

  const fetchTemplate = async (id: string): Promise<ProjectTemplate | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<ProjectTemplate>(`/pm/templates/${id}`)
      currentTemplate.value = { ...data }
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement du modèle.'
      return null
    } finally {
      loading.value = false
    }
  }

  const createTemplate = async (payload: CreateTemplatePayload): Promise<ProjectTemplateSummary | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.post<ProjectTemplateSummary>('/pm/templates', payload)
      await fetchTemplates()
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la création du modèle.'
      return null
    } finally {
      loading.value = false
    }
  }

  const deleteTemplate = async (id: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      await api.delete(`/pm/templates/${id}`)
      templates.value = templates.value.filter((t) => t.id !== id)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la suppression du modèle.'
    } finally {
      loading.value = false
    }
  }

  const applyToProject = async (templateId: string, projectId: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      await api.post(`/pm/templates/${templateId}/apply/${projectId}`, {})
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors de l'application du modèle."
      throw e
    } finally {
      loading.value = false
    }
  }

  const createFromProject = async (
    projectId: string,
    payload: CreateFromProjectPayload,
  ): Promise<ProjectTemplateSummary | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.post<ProjectTemplateSummary>(
        `/pm/templates/from-project/${projectId}`,
        payload,
      )
      await fetchTemplates()
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la sauvegarde du modèle.'
      return null
    } finally {
      loading.value = false
    }
  }

  // ─── Logout reset ────────────────────────────────────────────────────────────

  /** Wipe per-user state on logout. */
  const reset = (): void => {
    templates.value = []
    currentTemplate.value = null
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return {
    templates,
    currentTemplate,
    loading,
    error,
    fetchTemplates,
    fetchTemplate,
    createTemplate,
    deleteTemplate,
    applyToProject,
    createFromProject,
    reset,
  }
})
