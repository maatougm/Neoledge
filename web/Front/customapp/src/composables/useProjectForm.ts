/**
 * @file     useProjectForm.ts
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Composable for project creation / update form state and validation
 */

import { ref, reactive } from 'vue'
import { useProjectStore } from '@/stores/projectStore'
import { useNeoToast } from '@neolibrary/components'
import type { CreateProjectPayload, UpdateProjectPayload } from '@/types/project.types'

export function useProjectForm() {
  const store = useProjectStore()
  const toast = useNeoToast()

  // ─── Form state ────────────────────────────────────────────────────────────
  const form = reactive<CreateProjectPayload>({
    name: '',
    clientName: '',
    startDate: '',
    endDate: '',
    projectManagerId: undefined,
  })

  const errors = reactive<Partial<Record<keyof CreateProjectPayload, string>>>({})
  const submitting = ref(false)

  // ─── Validation ────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    Object.keys(errors).forEach((k) => delete errors[k as keyof typeof errors])

    if (!form.name.trim()) errors.name = 'Le nom du projet est requis.'
    if (!form.clientName.trim()) errors.clientName = 'Le nom du client est requis.'
    if (!form.startDate) errors.startDate = 'La date de début est requise.'
    if (!form.endDate) errors.endDate = 'La date de fin est requise.'
    if (form.startDate && form.endDate && form.endDate <= form.startDate) {
      errors.endDate = 'La date de fin doit être postérieure à la date de début.'
    }

    return Object.keys(errors).length === 0
  }

  const reset = () => {
    form.name = ''
    form.clientName = ''
    form.startDate = ''
    form.endDate = ''
    form.projectManagerId = undefined
    Object.keys(errors).forEach((k) => delete errors[k as keyof typeof errors])
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  const submitCreate = async (): Promise<boolean> => {
    if (!validate()) return false

    submitting.value = true
    try {
      const result = await store.createProject({ ...form })
      if (result) {
        toast.add({ severity: 'success', detail: `Projet « ${result.name} » créé avec succès.`, life: 3000 })
        reset()
        return true
      } else {
        toast.add({ severity: 'error', detail: store.error ?? 'Erreur lors de la création du projet.', life: 5000 })
        return false
      }
    } finally {
      submitting.value = false
    }
  }

  const submitUpdate = async (id: string, payload: UpdateProjectPayload): Promise<boolean> => {
    submitting.value = true
    try {
      const result = await store.updateProject(id, payload)
      if (result) {
        toast.add({ severity: 'success', detail: 'Projet mis à jour.', life: 3000 })
        return true
      } else {
        toast.add({ severity: 'error', detail: store.error ?? 'Erreur lors de la mise à jour.', life: 5000 })
        return false
      }
    } finally {
      submitting.value = false
    }
  }

  return {
    form,
    errors,
    submitting,
    validate,
    reset,
    submitCreate,
    submitUpdate,
  }
}
