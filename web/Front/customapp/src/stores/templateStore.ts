/**
 * @file     templateStore.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Pinia store for project template management — immutable state updates
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'
import { useApp } from './useApp'
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

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const apiBase = () => useApp().apiUrl + '/admin/projecttemplate'
  const authHeader = () => {
    const jwt = useApp().jwt
    return jwt ? { Authorization: `Bearer ${jwt}` } : {}
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  const fetchTemplates = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.get<ProjectTemplateSummary[]>(apiBase(), {
        headers: authHeader(),
      })
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
      const { data } = await axios.get<ProjectTemplate>(`${apiBase()}/${id}`, {
        headers: authHeader(),
      })
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
      const { data } = await axios.post<ProjectTemplateSummary>(apiBase(), payload, {
        headers: authHeader(),
      })
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
      await axios.delete(`${apiBase()}/${id}`, { headers: authHeader() })
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
      await axios.post(
        `${apiBase()}/${templateId}/apply/${projectId}`,
        {},
        { headers: authHeader() },
      )
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
      const { data } = await axios.post<ProjectTemplateSummary>(
        `${apiBase()}/from-project/${projectId}`,
        payload,
        { headers: authHeader() },
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
  }
})
