import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'

export interface ProjectMember {
  id: string
  userId: string
  label: string
  createdAt: string
  user: {
    id: string
    firstName: string
    lastName: string
    email: string
    avatarPath: string | null
    role: string
  }
}

export const useProjectMembersStore = defineStore('projectMembers', () => {
  const members = ref<ProjectMember[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  function _errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function fetchAll(projectId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<ProjectMember[]>(`/pm/projects/${projectId}/members`)
      members.value = data
    } catch (err) {
      error.value = _errMsg(err)
    } finally {
      loading.value = false
    }
  }

  async function add(projectId: string, userId: string, label: string): Promise<void> {
    error.value = null
    try {
      await api.post(`/pm/projects/${projectId}/members`, { userId, label })
      await fetchAll(projectId)
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function updateLabel(projectId: string, memberId: string, label: string): Promise<void> {
    error.value = null
    try {
      await api.patch(`/pm/projects/${projectId}/members/${memberId}`, { label })
      await fetchAll(projectId)
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function remove(projectId: string, memberId: string): Promise<void> {
    error.value = null
    try {
      await api.delete(`/pm/projects/${projectId}/members/${memberId}`)
      await fetchAll(projectId)
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  function reset(): void {
    members.value = []
    loading.value = false
    error.value = null
  }

  return { members, loading, error, fetchAll, add, updateLabel, remove, reset }
})
