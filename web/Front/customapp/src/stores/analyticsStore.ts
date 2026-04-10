/** @file src/stores/analyticsStore.ts — Pinia store for Advanced Analytics */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhaseVelocityRow {
  phase: string
  avgDays: number
  minDays: number
  maxDays: number
  projectCount: number
}

export interface BottleneckRow {
  phase: string
  currentCount: number
  avgDays: number
  severity: 'high' | 'medium' | 'low'
}

export interface DeadlineRiskRow {
  projectId: string
  projectName: string
  status: string
  pmName: string | null
  daysRemaining: number
  riskScore: number
}

export interface TeamWorkloadRow {
  pmId: string
  pmName: string
  active: number
  overdue: number
  completed: number
  upcoming: number
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAnalyticsStore = defineStore('analytics', () => {
  const phaseVelocity = ref<PhaseVelocityRow[]>([])
  const bottleneck = ref<BottleneckRow[]>([])
  const deadlineRisk = ref<DeadlineRiskRow[]>([])
  const teamWorkload = ref<TeamWorkloadRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ─── Actions ────────────────────────────────────────────────────────────────

  const fetchPhaseVelocity = async (): Promise<void> => {
    try {
      const { data } = await api.get<PhaseVelocityRow[]>('/api/analytics/phase-velocity')
      phaseVelocity.value = [...data]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement de la vélocité.'
    }
  }

  const fetchBottleneck = async (): Promise<void> => {
    try {
      const { data } = await api.get<BottleneckRow[]>('/api/analytics/bottleneck')
      bottleneck.value = [...data]
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors du chargement des goulots d'étranglement.'
    }
  }

  const fetchDeadlineRisk = async (): Promise<void> => {
    try {
      const { data } = await api.get<DeadlineRiskRow[]>('/api/analytics/deadline-risk')
      deadlineRisk.value = [...data]
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors du chargement des risques de délai.'
    }
  }

  const fetchTeamWorkload = async (): Promise<void> => {
    try {
      const { data } = await api.get<TeamWorkloadRow[]>('/api/analytics/team-workload')
      teamWorkload.value = [...data]
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors du chargement de la charge équipe.'
    }
  }

  const fetchAll = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      await Promise.all([
        fetchPhaseVelocity(),
        fetchBottleneck(),
        fetchDeadlineRisk(),
        fetchTeamWorkload(),
      ])
    } finally {
      loading.value = false
    }
  }

  return {
    phaseVelocity,
    bottleneck,
    deadlineRisk,
    teamWorkload,
    loading,
    error,
    fetchPhaseVelocity,
    fetchBottleneck,
    fetchDeadlineRisk,
    fetchTeamWorkload,
    fetchAll,
  }
})
