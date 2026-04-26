import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'

export interface RoleSummary {
  id: string
  name: string
  description: string | null
  isPreset: boolean
  permissionKeys: string[]
  assignmentCount: number
}

export interface PermissionDef {
  key: string
  resource: string
  description: string
}

export interface RoleAssignmentRow {
  id: string
  projectId: string | null
  role: { id: string; name: string; isPreset: boolean }
  project: { id: string; name: string } | null
}

export const useRoleStore = defineStore('roles', () => {
  const roles = ref<RoleSummary[]>([])
  const catalog = ref<PermissionDef[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [rolesResp, catResp] = await Promise.all([
        api.get<RoleSummary[]>('/admin/roles'),
        api.get<PermissionDef[]>('/admin/roles/permissions'),
      ])
      roles.value = rolesResp.data
      catalog.value = catResp.data
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load roles'
    } finally {
      loading.value = false
    }
  }

  async function createRole(input: {
    name: string
    description?: string
    permissionKeys: string[]
  }): Promise<RoleSummary> {
    try {
      const resp = await api.post<RoleSummary>('/admin/roles', input)
      roles.value = [...roles.value, resp.data]
      return resp.data
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create role'
      throw err
    }
  }

  async function updateRole(
    id: string,
    input: { name?: string; description?: string; permissionKeys?: string[] },
  ): Promise<RoleSummary> {
    try {
      const resp = await api.patch<RoleSummary>(`/admin/roles/${id}`, input)
      roles.value = roles.value.map((r) => (r.id === id ? resp.data : r))
      return resp.data
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update role'
      throw err
    }
  }

  async function deleteRole(id: string): Promise<void> {
    try {
      await api.delete(`/admin/roles/${id}`)
      roles.value = roles.value.filter((r) => r.id !== id)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete role'
      throw err
    }
  }

  async function cloneRole(id: string, newName: string): Promise<RoleSummary> {
    try {
      const resp = await api.post<RoleSummary>(`/admin/roles/${id}/clone`, { newName })
      roles.value = [...roles.value, resp.data]
      return resp.data
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to clone role'
      throw err
    }
  }

  async function assignRole(input: {
    userId: string
    roleId: string
    projectId?: string | null
  }): Promise<void> {
    try {
      await api.post('/admin/roles/assignments', input)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to assign role'
      throw err
    }
  }

  async function unassign(assignmentId: string): Promise<void> {
    try {
      await api.delete(`/admin/roles/assignments/${assignmentId}`)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to unassign role'
      throw err
    }
  }

  async function listUserAssignments(userId: string): Promise<RoleAssignmentRow[]> {
    try {
      const resp = await api.get<RoleAssignmentRow[]>(
        `/admin/roles/users/${userId}/assignments`,
      )
      return resp.data
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to list assignments'
      throw err
    }
  }

  function reset(): void {
    roles.value = []
    catalog.value = []
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return {
    roles,
    catalog,
    loading,
    error,
    loadAll,
    createRole,
    updateRole,
    deleteRole,
    cloneRole,
    assignRole,
    unassign,
    listUserAssignments,
    reset,
  }
})
