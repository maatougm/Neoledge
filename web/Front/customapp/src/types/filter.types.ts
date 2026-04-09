/**
 * @file     filter.types.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Types for saved filters and filter criteria
 */

export interface FilterCriteria {
  status?: string[]
  priority?: string[]
  assignedToMe?: boolean
  tags?: string[]
  search?: string
  dateRange?: { from?: string; to?: string }
}

export interface SavedFilter {
  id: string
  name: string
  filters: FilterCriteria
  createdAt: string
  isDefault: boolean
}

export type Priority = 'Low' | 'Medium' | 'High' | 'Critical'

export const PRIORITY_LABELS: Record<Priority, string> = {
  Low: 'Faible',
  Medium: 'Moyen',
  High: 'Élevé',
  Critical: 'Critique',
}

export const PRIORITY_SEVERITY: Record<Priority, string> = {
  Low: 'secondary',
  Medium: 'info',
  High: 'warning',
  Critical: 'danger',
}
