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

/** Convert "dd/mm/yy" or "dd/mm/yyyy" → "yyyy-mm-dd" ISO string. Pass-through if already ISO. */
function toISODate(s: string): string {
  if (!s) return s
  // Already ISO format: "2026-04-09"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // French format: "09/04/26" or "09/04/2026"
  const parts = s.split('/')
  if (parts.length === 3) {
    const [d, m, y] = parts
    const fullYear = y.length === 2 ? `20${y}` : y
    return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return s
}

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
      const result = await store.createProject({
        ...form,
        startDate: toISODate(form.startDate),
        endDate: toISODate(form.endDate),
      })
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
    const normalized: UpdateProjectPayload = {
      ...payload,
      ...(payload.startDate ? { startDate: toISODate(payload.startDate) } : {}),
      ...(payload.endDate   ? { endDate:   toISODate(payload.endDate)   } : {}),
    }
    try {
      const result = await store.updateProject(id, normalized)
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
