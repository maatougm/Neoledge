/**
 * @file     useUserManagement.ts
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Composable encapsulating dialog state and handlers for user CRUD
 */

import { ref, onMounted } from 'vue'
import { useUserStore } from '@/stores/userStore'
import { useNeoToast } from '@neolibrary/components'
import type { UserResponse, CreateUserPayload, UpdateUserPayload } from '@/types/user.types'

export function useUserManagement() {
  const store = useUserStore()
  const toast = useNeoToast()

  // Fetch the user list on first mount of the consumer component. Without this,
  // navigating to /app/admin/users (or returning to it after logout/login) shows
  // an empty list — the store is module-singleton and starts empty.
  onMounted(() => {
    void store.fetchAll()
  })

  // ─── Dialog state ─────────────────────────────────────────────────────────
  const showCreateDialog = ref(false)
  const showEditDialog = ref(false)
  const editingUser = ref<UserResponse | null>(null)
  const tempPassword = ref<string | null>(null)
  const showTempPasswordDialog = ref(false)

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const openCreate = () => {
    showCreateDialog.value = true
  }

  const openEdit = (user: UserResponse) => {
    editingUser.value = { ...user }
    showEditDialog.value = true
  }

  const handleCreate = async (payload: CreateUserPayload) => {
    const result = await store.createUser(payload)
    if (result) {
      toast.add({ severity: 'success', detail: `Utilisateur ${result.firstName} ${result.lastName} créé avec succès.`, life: 3000 })
      showCreateDialog.value = false
    } else {
      toast.add({ severity: 'error', detail: store.error ?? 'Erreur lors de la création.', life: 5000 })
    }
  }

  const handleUpdate = async (id: string, payload: UpdateUserPayload) => {
    const result = await store.updateUser(id, payload)
    if (result) {
      toast.add({ severity: 'success', detail: 'Utilisateur mis à jour.', life: 3000 })
      showEditDialog.value = false
      editingUser.value = null
    } else {
      toast.add({ severity: 'error', detail: store.error ?? 'Erreur lors de la mise à jour.', life: 5000 })
    }
  }

  const handleResetPassword = async (id: string) => {
    const password = await store.resetPassword(id)
    if (password) {
      tempPassword.value = password
      showTempPasswordDialog.value = true
      // Auto-hide the temp password after 30 s (#3)
      setTimeout(() => {
        if (showTempPasswordDialog.value) {
          showTempPasswordDialog.value = false
          tempPassword.value = null
        }
      }, 30_000)
    } else {
      toast.add({ severity: 'error', detail: store.error ?? 'Erreur lors de la réinitialisation.', life: 5000 })
    }
  }

  const handleDeactivate = async (id: string) => {
    await store.deactivateUser(id)
    if (!store.error) {
      toast.add({ severity: 'success', detail: 'Compte désactivé.', life: 3000 })
    } else {
      toast.add({ severity: 'error', detail: store.error, life: 5000 })
    }
  }

  const handleReactivate = async (id: string) => {
    await store.reactivateUser(id)
    if (!store.error) {
      toast.add({ severity: 'success', detail: 'Compte réactivé.', life: 3000 })
    } else {
      toast.add({ severity: 'error', detail: store.error, life: 5000 })
    }
  }

  return {
    store,
    showCreateDialog,
    showEditDialog,
    editingUser,
    tempPassword,
    showTempPasswordDialog,
    openCreate,
    openEdit,
    handleCreate,
    handleUpdate,
    handleResetPassword,
    handleDeactivate,
    handleReactivate,
  }
}
