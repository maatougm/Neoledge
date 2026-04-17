/** @file src/stores/budgetStore.ts — Project budget + line items + burn report */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'

export interface BudgetLineItem {
  id: string
  budgetId: string
  description: string
  type: string
  unitCost: number
  units: number
  total: number
  position: number
}

export interface ProjectBudget {
  id: string
  projectId: string
  laborBudget: number
  materialBudget: number
  currency: string
  notes: string | null
  lineItems: BudgetLineItem[]
}

export interface BurnReport {
  totalBudget: number
  labor: number
  material: number
  laborSpent: number
  materialSpent: number
  spent: number
  remaining: number
  percentUsed: number
  currency: string
}

export const useBudgetStore = defineStore('budget', () => {
  const budget = ref<ProjectBudget | null>(null)
  const burn = ref<BurnReport | null>(null)
  const loading = ref(false)

  async function fetchBudget(projectId: string) {
    loading.value = true
    try {
      const { data } = await api.get<ProjectBudget>(`/pm/projects/${projectId}/budget`)
      budget.value = data
    } finally {
      loading.value = false
    }
  }

  async function upsertBudget(projectId: string, payload: { laborBudget?: number; materialBudget?: number; currency?: string; notes?: string }) {
    const { data } = await api.put<ProjectBudget>(`/pm/projects/${projectId}/budget`, payload)
    budget.value = data
    return data
  }

  async function createLineItem(projectId: string, payload: { description: string; type?: string; unitCost: number; units: number }) {
    const { data } = await api.post<BudgetLineItem>(`/pm/projects/${projectId}/budget/line-items`, payload)
    if (budget.value) budget.value = { ...budget.value, lineItems: [...budget.value.lineItems, data] }
    return data
  }

  async function updateLineItem(projectId: string, id: string, payload: Partial<BudgetLineItem>) {
    const { data } = await api.patch<BudgetLineItem>(`/pm/projects/${projectId}/budget/line-items/${id}`, payload)
    if (budget.value) {
      const idx = budget.value.lineItems.findIndex((l) => l.id === id)
      if (idx >= 0) {
        const newLines = [...budget.value.lineItems.slice(0, idx), data, ...budget.value.lineItems.slice(idx + 1)]
        budget.value = { ...budget.value, lineItems: newLines }
      }
    }
    return data
  }

  async function deleteLineItem(projectId: string, id: string) {
    await api.delete(`/pm/projects/${projectId}/budget/line-items/${id}`)
    if (budget.value) {
      budget.value = { ...budget.value, lineItems: budget.value.lineItems.filter((l) => l.id !== id) }
    }
  }

  async function fetchBurn(projectId: string) {
    const { data } = await api.get<BurnReport>(`/pm/projects/${projectId}/budget/burn`)
    burn.value = data
  }

  return { budget, burn, loading, fetchBudget, upsertBudget, createLineItem, updateLineItem, deleteLineItem, fetchBurn }
})
