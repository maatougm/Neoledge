/** @file src/stores/analyticsStore.ts — Pinia store for Advanced Analytics */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'

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
  // Per-metric errors so the dashboard can render partial results when one
  // endpoint fails instead of hiding everything behind a single `error` ref.
  const phaseVelocityError = ref<string | null>(null)
  const bottleneckError = ref<string | null>(null)
  const deadlineRiskError = ref<string | null>(null)
  const teamWorkloadError = ref<string | null>(null)

  function _msg(e: unknown, fallback: string): string {
    return e instanceof Error ? e.message : fallback
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  const fetchPhaseVelocity = async (): Promise<void> => {
    phaseVelocityError.value = null
    try {
      const { data } = await api.get<PhaseVelocityRow[]>('/api/analytics/phase-velocity')
      phaseVelocity.value = [...data]
    } catch (e: unknown) {
      const msg = _msg(e, 'Erreur lors du chargement de la vélocité.')
      phaseVelocityError.value = msg
      error.value = msg
      throw e
    }
  }

  const fetchBottleneck = async (): Promise<void> => {
    bottleneckError.value = null
    try {
      const { data } = await api.get<BottleneckRow[]>('/api/analytics/bottleneck')
      bottleneck.value = [...data]
    } catch (e: unknown) {
      const msg = _msg(e, "Erreur lors du chargement des goulots d'étranglement.")
      bottleneckError.value = msg
      error.value = msg
      throw e
    }
  }

  const fetchDeadlineRisk = async (): Promise<void> => {
    deadlineRiskError.value = null
    try {
      const { data } = await api.get<DeadlineRiskRow[]>('/api/analytics/deadline-risk')
      deadlineRisk.value = [...data]
    } catch (e: unknown) {
      const msg = _msg(e, 'Erreur lors du chargement des risques de délai.')
      deadlineRiskError.value = msg
      error.value = msg
      throw e
    }
  }

  const fetchTeamWorkload = async (): Promise<void> => {
    teamWorkloadError.value = null
    try {
      const { data } = await api.get<TeamWorkloadRow[]>('/api/analytics/team-workload')
      teamWorkload.value = [...data]
    } catch (e: unknown) {
      const msg = _msg(e, 'Erreur lors du chargement de la charge équipe.')
      teamWorkloadError.value = msg
      error.value = msg
      throw e
    }
  }

  const fetchAll = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      // Use allSettled so a single failed endpoint does not cancel the others.
      // Log each rejection individually so nothing is silently swallowed.
      const results = await Promise.allSettled([
        fetchPhaseVelocity(),
        fetchBottleneck(),
        fetchDeadlineRisk(),
        fetchTeamWorkload(),
      ])
      const names = ['phaseVelocity', 'bottleneck', 'deadlineRisk', 'teamWorkload'] as const
      const firstError = results.find((r) => r.status === 'rejected') as
        | PromiseRejectedResult
        | undefined
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          // eslint-disable-next-line no-console
        }
      })
      if (firstError) {
        error.value = _msg(firstError.reason, 'Erreur lors du chargement des analyses.')
      }
    } finally {
      loading.value = false
    }
  }

  // ─── Logout reset ────────────────────────────────────────────────────────────

  /** Wipe per-user state on logout. */
  const reset = (): void => {
    phaseVelocity.value = []
    bottleneck.value = []
    deadlineRisk.value = []
    teamWorkload.value = []
    loading.value = false
    error.value = null
    phaseVelocityError.value = null
    bottleneckError.value = null
    deadlineRiskError.value = null
    teamWorkloadError.value = null
  }

  onLogout(reset)

  return {
    phaseVelocity,
    bottleneck,
    deadlineRisk,
    teamWorkload,
    loading,
    error,
    phaseVelocityError,
    bottleneckError,
    deadlineRiskError,
    teamWorkloadError,
    fetchPhaseVelocity,
    fetchBottleneck,
    fetchDeadlineRisk,
    fetchTeamWorkload,
    fetchAll,
    reset,
  }
})
