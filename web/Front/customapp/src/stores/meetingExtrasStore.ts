/** @file src/stores/meetingExtrasStore.ts — Agenda / Attendees / Outcomes for meetings */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'

export interface AgendaItem {
  id: string
  meetingId: string
  title: string
  duration: number | null
  responsibleId: string | null
  position: number
  notes: string | null
  responsible?: { id: string; firstName: string; lastName: string }
}

export interface Attendee {
  id: string
  meetingId: string
  userId: string | null
  externalName: string | null
  externalEmail: string | null
  isPresent: boolean
  role: string | null
  user?: { id: string; firstName: string; lastName: string; email: string }
}

export interface Outcome {
  id: string
  meetingId: string
  type: 'Decision' | 'Action' | 'Note' | 'Risk'
  description: string
  ownerId: string | null
  dueDate: string | null
  workPackageId: string | null
  owner?: { id: string; firstName: string; lastName: string }
  workPackage?: { id: string; title: string; status: string }
}

export const useMeetingExtrasStore = defineStore('meetingExtras', () => {
  const agenda = ref<AgendaItem[]>([])
  const attendees = ref<Attendee[]>([])
  const outcomes = ref<Outcome[]>([])

  function base(projectId: string, meetingId: string) {
    return `/pm/projects/${projectId}/meetings/${meetingId}`
  }

  // ── Agenda ─────────────────────────────────────
  async function fetchAgenda(projectId: string, meetingId: string) {
    const { data } = await api.get<AgendaItem[]>(`${base(projectId, meetingId)}/agenda`)
    agenda.value = data
  }
  async function addAgenda(projectId: string, meetingId: string, payload: Partial<AgendaItem> & { title: string }) {
    const { data } = await api.post<AgendaItem>(`${base(projectId, meetingId)}/agenda`, payload)
    agenda.value = [...agenda.value, data]
  }
  async function updateAgenda(projectId: string, meetingId: string, id: string, payload: Partial<AgendaItem>) {
    const { data } = await api.patch<AgendaItem>(`${base(projectId, meetingId)}/agenda/${id}`, payload)
    const idx = agenda.value.findIndex((a) => a.id === id)
    if (idx >= 0) agenda.value = [...agenda.value.slice(0, idx), data, ...agenda.value.slice(idx + 1)]
  }
  async function deleteAgenda(projectId: string, meetingId: string, id: string) {
    await api.delete(`${base(projectId, meetingId)}/agenda/${id}`)
    agenda.value = agenda.value.filter((a) => a.id !== id)
  }

  // ── Attendees ──────────────────────────────────
  async function fetchAttendees(projectId: string, meetingId: string) {
    const { data } = await api.get<Attendee[]>(`${base(projectId, meetingId)}/attendees`)
    attendees.value = data
  }
  async function addAttendee(projectId: string, meetingId: string, payload: Partial<Attendee>) {
    const { data } = await api.post<Attendee>(`${base(projectId, meetingId)}/attendees`, payload)
    attendees.value = [...attendees.value, data]
  }
  async function updateAttendee(projectId: string, meetingId: string, id: string, payload: { isPresent?: boolean; role?: string | null }) {
    const { data } = await api.patch<Attendee>(`${base(projectId, meetingId)}/attendees/${id}`, payload)
    const idx = attendees.value.findIndex((a) => a.id === id)
    if (idx >= 0) attendees.value = [...attendees.value.slice(0, idx), data, ...attendees.value.slice(idx + 1)]
  }
  async function removeAttendee(projectId: string, meetingId: string, id: string) {
    await api.delete(`${base(projectId, meetingId)}/attendees/${id}`)
    attendees.value = attendees.value.filter((a) => a.id !== id)
  }

  // ── Outcomes ───────────────────────────────────
  async function fetchOutcomes(projectId: string, meetingId: string) {
    const { data } = await api.get<Outcome[]>(`${base(projectId, meetingId)}/outcomes`)
    outcomes.value = data
  }
  async function addOutcome(projectId: string, meetingId: string, payload: { type: string; description: string; ownerId?: string; dueDate?: string }) {
    const { data } = await api.post<Outcome>(`${base(projectId, meetingId)}/outcomes`, payload)
    outcomes.value = [...outcomes.value, data]
  }
  async function deleteOutcome(projectId: string, meetingId: string, id: string) {
    await api.delete(`${base(projectId, meetingId)}/outcomes/${id}`)
    outcomes.value = outcomes.value.filter((o) => o.id !== id)
  }
  async function convertToWp(projectId: string, meetingId: string, id: string) {
    const { data } = await api.post(`${base(projectId, meetingId)}/outcomes/${id}/convert-to-wp`)
    await fetchOutcomes(projectId, meetingId)
    return data
  }

  return {
    agenda, attendees, outcomes,
    fetchAgenda, addAgenda, updateAgenda, deleteAgenda,
    fetchAttendees, addAttendee, updateAttendee, removeAttendee,
    fetchOutcomes, addOutcome, deleteOutcome, convertToWp,
  }
})
