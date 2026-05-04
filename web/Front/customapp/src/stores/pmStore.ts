/** @file src/stores/pmStore.ts — Pinia store for Project Manager module */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'
import type {
  ProjectSummary,
  ProjectDetail,
  AddFieldPayload,
  ProjectActivity,
} from '@/types/project.types'
import type {
  ProjectValidation,
  SaveQuestionnairePayload,
  SubmitValidationPayload,
  MeetingTranscriptSummary,
  MeetingTranscriptDetail,
  AiResults,
  AutomationRule,
  AutomationLog,
} from '@/types/pm.types'

export const usePmStore = defineStore('pm', () => {
  /** Projects fetched via the PM's own list endpoint. */
  const myProjects = ref<ProjectSummary[]>([])
  /** Projects fetched via the team-member endpoint. */
  const teamProjects = ref<ProjectSummary[]>([])
  /** Tracks which list was last populated so callers can infer context. */
  const projectsView = ref<'mine' | 'team'>('mine')
  /** Computed view of the active project list — switches between myProjects and teamProjects. */
  const projects = computed<ProjectSummary[]>(() =>
    projectsView.value === 'team' ? teamProjects.value : myProjects.value,
  )
  const currentProject = ref<ProjectDetail | null>(null)
  const validations = ref<ProjectValidation[]>([])
  const activities = ref<ProjectActivity[]>([])
  const meetings = ref<MeetingTranscriptSummary[]>([])
  const currentTranscript = ref<MeetingTranscriptDetail | null>(null)
  const aiResults = ref<AiResults | null>(null)
  /** Module-private interval handle — not a ref, avoids unnecessary reactivity. */
  let _aiPolling: ReturnType<typeof setInterval> | null = null
  const automationRules = ref<AutomationRule[]>([])
  const automationLogs = ref<AutomationLog[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const fetchMyProjects = async () => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<ProjectSummary[]>('/pm/projects')
      myProjects.value = [...data]
      projectsView.value = 'mine'
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des projets.'
    } finally {
      loading.value = false
    }
  }

  const fetchTeamProjects = async () => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<ProjectSummary[]>('/pm/team-projects')
      teamProjects.value = [...data]
      projectsView.value = 'team'
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des projets.'
    } finally {
      loading.value = false
    }
  }

  const fetchProject = async (id: string) => {
    loading.value = true
    error.value = null
    try {
      const [{ data: detail }, { data: vals }] = await Promise.all([
        api.get<ProjectDetail>(`/pm/projects/${id}`),
        api.get<ProjectValidation[]>(`/pm/projects/${id}/validations`),
      ])
      currentProject.value = detail
      validations.value = [...vals]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement du projet.'
    } finally {
      loading.value = false
    }
  }

  const saveQuestionnaire = async (
    projectId: string,
    payload: SaveQuestionnairePayload,
  ) => {
    saving.value = true
    error.value = null
    try {
      await api.patch(`/pm/projects/${projectId}/field-values`, payload)
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
    error.value = null
    try {
      await api.post(`/pm/projects/${projectId}/fields`, payload)
      await fetchProject(projectId)
      return true
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors de l'ajout du champ."
      return false
    } finally {
      saving.value = false
    }
  }

  const submitValidation = async (
    projectId: string,
    payload: SubmitValidationPayload,
  ) => {
    saving.value = true
    error.value = null
    try {
      const { data } = await api.post<ProjectValidation>(
        `/pm/projects/${projectId}/validations`,
        payload,
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
      const { data } = await api.get<ProjectActivity[]>(`/pm/projects/${projectId}/activity`)
      activities.value = [...data]
    } catch {
      activities.value = []
    }
  }

  const fetchMeetings = async (projectId: string) => {
    try {
      const { data } = await api.get<MeetingTranscriptSummary[]>(
        `/pm/projects/${projectId}/meetings`,
      )
      meetings.value = [...data]
    } catch {
      meetings.value = []
    }
  }

  const fetchTranscript = async (projectId: string, meetingId: string) => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<MeetingTranscriptDetail>(
        `/pm/projects/${projectId}/meetings/${meetingId}`,
      )
      currentTranscript.value = data
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors du chargement de la transcription.'
    } finally {
      loading.value = false
    }
  }

  const uploadMeeting = async (projectId: string, formData: FormData) => {
    saving.value = true
    error.value = null
    try {
      await api.post(`/pm/projects/${projectId}/meetings/upload`, formData, { timeout: 300_000 })
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = msg || "Erreur lors de l'envoi de l'enregistrement."
      return false
    } finally {
      saving.value = false
    }
  }

  const deleteMeeting = async (projectId: string, meetingId: string) => {
    try {
      await api.delete(`/pm/projects/${projectId}/meetings/${meetingId}`)
      meetings.value = meetings.value.filter((m) => m.id !== meetingId)
      return true
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la suppression.'
      return false
    }
  }

  const stopAiPolling = () => {
    if (_aiPolling !== null) {
      clearInterval(_aiPolling)
      _aiPolling = null
    }
  }

  const resumeAiPolling = (projectId: string, meetingId: string) => {
    stopAiPolling()
    _aiPolling = setInterval(() => {
      void fetchAiResults(projectId, meetingId)
    }, 5000)
  }

  const fetchAiResults = async (projectId: string, meetingId: string) => {
    try {
      const { data } = await api.get<AiResults>(
        `/pm/projects/${projectId}/meetings/${meetingId}/ai-results`,
      )
      aiResults.value = { ...data }
      if (data.aiStatus === 'completed' || data.aiStatus === 'failed') {
        stopAiPolling()
      }
    } catch (e: unknown) {
      stopAiPolling()
      error.value = e instanceof Error ? e.message : "Erreur lors du chargement des résultats IA."
    }
  }

  const triggerAiAnalysis = async (projectId: string, meetingId: string) => {
    try {
      await api.post(`/pm/projects/${projectId}/meetings/${meetingId}/ai-analyze`)
      aiResults.value = {
        aiStatus: 'processing',
        aiSummary: null,
        aiError: null,
        aiModel: null,
        aiProcessedAt: null,
        actionItems: [],
        decisions: [],
      }
      stopAiPolling()
      _aiPolling = setInterval(() => {
        void fetchAiResults(projectId, meetingId)
      }, 5000)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Erreur lors du lancement de l'analyse IA."
    }
  }

  const renameSpeaker = async (
    projectId: string,
    meetingId: string,
    oldName: string,
    newName: string,
  ) => {
    try {
      await api.patch(`/pm/projects/${projectId}/meetings/${meetingId}/rename-speaker`, {
        oldName,
        newName,
      })
      if (currentTranscript.value?.id === meetingId) {
        currentTranscript.value = {
          ...currentTranscript.value,
          segments: currentTranscript.value.segments.map((s) =>
            s.speaker === oldName ? { ...s, speaker: newName } : s,
          ),
        }
      }
      return true
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du renommage.'
      return false
    }
  }

  // ─── Automation ──────────────────────────────────────────────────────────────

  const fetchAutomationRules = async (projectId: string) => {
    try {
      const { data } = await api.get<{ success: boolean; data: AutomationRule[] }>(
        `/pm/projects/${projectId}/automation/rules`,
      )
      automationRules.value = [...(data.data ?? [])]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des règles.'
    }
  }

  const createAutomationRule = async (projectId: string, payload: Partial<AutomationRule>) => {
    try {
      const { data } = await api.post<{ success: boolean; data: AutomationRule }>(
        `/pm/projects/${projectId}/automation/rules`,
        payload,
      )
      if (data.success && data.data) {
        automationRules.value = [data.data, ...automationRules.value]
      }
      return data.success
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la création de la règle.'
      return false
    }
  }

  const toggleAutomationRule = async (projectId: string, ruleId: string, isActive: boolean) => {
    try {
      const { data } = await api.patch<{ success: boolean; data: AutomationRule }>(
        `/pm/projects/${projectId}/automation/rules/${ruleId}/toggle`,
        { isActive },
      )
      if (data.success && data.data) {
        automationRules.value = automationRules.value.map((r) =>
          r.id === ruleId ? { ...data.data } : r,
        )
      }
      return data.success
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la mise à jour de la règle.'
      return false
    }
  }

  const deleteAutomationRule = async (projectId: string, ruleId: string) => {
    try {
      await api.delete(`/pm/projects/${projectId}/automation/rules/${ruleId}`)
      automationRules.value = automationRules.value.filter((r) => r.id !== ruleId)
      return true
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la suppression de la règle.'
      return false
    }
  }

  const fetchAutomationLogs = async (projectId: string) => {
    try {
      const { data } = await api.get<{ success: boolean; data: AutomationLog[] }>(
        `/pm/projects/${projectId}/automation/logs`,
      )
      automationLogs.value = [...(data.data ?? [])]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des logs.'
    }
  }

  // ─── Logout reset ────────────────────────────────────────────────────────────

  /** Clear the currently selected project without a full store reset. */
  const clearCurrent = (): void => {
    currentProject.value = null
    validations.value = []
  }

  /** Stop AI polling + wipe per-user state. Called on logout. */
  const reset = (): void => {
    stopAiPolling()
    myProjects.value = []
    teamProjects.value = []
    projectsView.value = 'mine'
    currentProject.value = null
    validations.value = []
    activities.value = []
    meetings.value = []
    currentTranscript.value = null
    aiResults.value = null
    automationRules.value = []
    automationLogs.value = []
    loading.value = false
    saving.value = false
    error.value = null
  }

  onLogout(reset)

  return {
    myProjects,
    teamProjects,
    projectsView,
    projects,
    currentProject,
    validations,
    activities,
    meetings,
    currentTranscript,
    aiResults,
    automationRules,
    automationLogs,
    loading,
    saving,
    error,
    fetchMyProjects,
    fetchTeamProjects,
    fetchProject,
    saveQuestionnaire,
    addCustomField,
    submitValidation,
    fetchActivity,
    fetchMeetings,
    fetchTranscript,
    uploadMeeting,
    deleteMeeting,
    renameSpeaker,
    triggerAiAnalysis,
    fetchAiResults,
    stopAiPolling,
    resumeAiPolling,
    fetchAutomationRules,
    createAutomationRule,
    toggleAutomationRule,
    deleteAutomationRule,
    fetchAutomationLogs,
    clearCurrent,
    reset,
  }
})
