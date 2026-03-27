import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'
import { useApp } from './useApp'
import type { ProjectSummary, ProjectDetail, AddFieldPayload, ProjectActivity } from '@/types/project.types'
import type { ProjectValidation, SaveQuestionnairePayload, SubmitValidationPayload } from '@/types/pm.types'

export const usePmStore = defineStore('pm', () => {
  const projects       = ref<ProjectSummary[]>([])
  const currentProject = ref<ProjectDetail | null>(null)
  const validations    = ref<ProjectValidation[]>([])
  const activities     = ref<ProjectActivity[]>([])
  const loading        = ref(false)
  const saving         = ref(false)
  const error          = ref<string | null>(null)

  const apiBase = () => useApp().apiUrl + '/pm'
  const authHeader = () => {
    const jwt = useApp().jwt
    return jwt ? { Authorization: `Bearer ${jwt}` } : {}
  }

  const fetchMyProjects = async () => {
    loading.value = true
    error.value   = null
    try {
      const { data } = await axios.get<ProjectSummary[]>(`${apiBase()}/projects`, { headers: authHeader() })
      projects.value = [...data]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des projets.'
    } finally {
      loading.value = false
    }
  }

  const fetchProject = async (id: string) => {
    loading.value = true
    error.value   = null
    try {
      const [{ data: detail }, { data: vals }] = await Promise.all([
        axios.get<ProjectDetail>(`${apiBase()}/projects/${id}`, { headers: authHeader() }),
        axios.get<ProjectValidation[]>(`${apiBase()}/projects/${id}/validations`, { headers: authHeader() }),
      ])
      currentProject.value = detail
      validations.value    = [...vals]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement du projet.'
    } finally {
      loading.value = false
    }
  }

  const saveQuestionnaire = async (projectId: string, payload: SaveQuestionnairePayload) => {
    saving.value = true
    error.value  = null
    try {
      await axios.patch(`${apiBase()}/projects/${projectId}/field-values`, payload, { headers: authHeader() })
      return true
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la sauvegarde.'
      return false
    } finally {
      saving.value = false
    }
  }

  const addCustomField = async (projectId: string, payload: AddFieldPayload) => {
    saving.value = true
    error.value  = null
    try {
      await axios.post(`${apiBase()}/projects/${projectId}/fields`, payload, { headers: authHeader() })
      await fetchProject(projectId)
      return true
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors de l'ajout du champ."
      return false
    } finally {
      saving.value = false
    }
  }

  const submitValidation = async (projectId: string, payload: SubmitValidationPayload) => {
    saving.value = true
    error.value  = null
    try {
      const { data } = await axios.post<ProjectValidation>(
        `${apiBase()}/projects/${projectId}/validations`,
        payload,
        { headers: authHeader() },
      )
      validations.value = [data, ...validations.value]
      return true
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la soumission.'
      return false
    } finally {
      saving.value = false
    }
  }

  const fetchActivity = async (projectId: string) => {
    try {
      const { data } = await axios.get<ProjectActivity[]>(`${apiBase()}/projects/${projectId}/activity`, { headers: authHeader() })
      activities.value = [...data]
    } catch {
      activities.value = []
    }
  }

  return {
    projects, currentProject, validations, activities, loading, saving, error,
    fetchMyProjects, fetchProject, saveQuestionnaire, addCustomField, submitValidation, fetchActivity,
  }
})
