<!--
  @file     AnalyticsRiskPanel.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Deadline risk table panel — used inside AnalyticsSection
-->
<template>
  <div class="panel panel--wide">
    <h3 class="panel__title">
      <i class="pi pi-calendar-times panel__icon" />
      Risque de dépassement
    </h3>

    <template v-if="loading">
      <div v-for="n in 5" :key="n" class="panel__skeleton" />
    </template>

    <div v-else-if="rows.length === 0" class="panel__empty">
      <i class="pi pi-calendar panel__empty-icon" />
      <span>Aucun projet actif avec une date de fin définie.</span>
    </div>

    <table v-else class="panel__table">
      <thead>
        <tr>
          <th>Projet</th>
          <th>Chef de projet</th>
          <th>Statut</th>
          <th>Jours restants</th>
          <th>Score de risque</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.projectId"
          class="panel__risk-row"
          role="link"
          tabindex="0"
          @click="emit('navigate', row.projectId)"
          @keydown.enter="emit('navigate', row.projectId)"
        >
          <td class="panel__risk-name" :title="row.projectName">{{ row.projectName }}</td>
          <td class="panel__muted">{{ row.pmName ?? '—' }}</td>
          <td>
            <span :class="['panel__status-badge', `panel__status-badge--${statusClass(row.status)}`]">{{ statusLabel(row.status) }}</span>
          </td>
          <td :class="row.daysRemaining < 0 ? 'panel__overdue' : 'panel__days'">
            {{ row.daysRemaining < 0 ? `${Math.abs(row.daysRemaining)}j en retard` : `${row.daysRemaining}j` }}
          </td>
          <td class="panel__score-cell">
            <div class="panel__score-track">
              <div
                class="panel__score-fill"
                :class="riskBarClass(row.riskScore)"
                :style="{ width: row.riskScore + '%' }"
              />
            </div>
            <span class="panel__score-label">{{ row.riskScore }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
interface RiskRow {
  projectId: string
  projectName: string
  pmName: string | null
  status: string
  daysRemaining: number
  riskScore: number
}

defineProps<{
  loading: boolean
  rows: RiskRow[]
}>()

const emit = defineEmits<{
  navigate: [id: string]
}>()

function riskBarClass(score: number): string {
  if (score > 70) return 'panel__score-fill--high'
  if (score > 40) return 'panel__score-fill--medium'
  return 'panel__score-fill--low'
}

import { phaseLabel as statusLabel } from '@/utils/phaseLabels'

function statusClass(status: string): string {
  switch (status) {
    case 'Draft':                    return 'draft'
    case 'Kickoff':                  return 'active'
    case 'Realisation':              return 'validation'
    case 'Cloture':                  return 'done'
    case 'Archived':                 return 'muted'
    default:                         return 'muted'
  }
}
</script>

<style scoped>
.panel {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow-md);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 320px;
}

.panel--wide { grid-column: span 2; }

.panel__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--nl-text-2);
}

.panel__icon { color: var(--nl-accent); font-size: 13px; }

.panel__skeleton {
  height: 36px;
  border-radius: var(--nl-radius);
  background: linear-gradient(90deg, var(--nl-surface-2) 25%, var(--nl-border) 50%, var(--nl-surface-2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}

@keyframes shimmer {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}

.panel__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  flex: 1;
  color: var(--nl-text-3);
  font-size: 0.875rem;
  text-align: center;
  padding: 2rem 0;
}

.panel__empty-icon { font-size: 1.75rem; color: var(--nl-border-strong); }

.panel__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.panel__table th {
  background: var(--nl-surface-2);
  padding: 0 0.75rem;
  height: 32px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--nl-text-3);
}

.panel__table td {
  padding: 0.625rem 0.75rem;
  height: 48px;
  border-bottom: 1px solid var(--nl-border);
  vertical-align: middle;
  color: var(--nl-text-2);
}

.panel__table tr:last-child td { border-bottom: none; }

.panel__risk-row {
  cursor: pointer;
  transition: background 0.12s;
}

.panel__risk-row:hover td { background: var(--nl-surface-2); }

.panel__risk-name {
  font-weight: 600;
  color: var(--nl-text-1);
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel__muted     { color: var(--nl-text-3); font-size: 0.8125rem; }
.panel__days      { color: var(--nl-text-2); white-space: nowrap; }
.panel__overdue   { color: var(--nl-danger); font-weight: 600; white-space: nowrap; }

.panel__status-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--nl-radius-sm);
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--nl-surface-2);
  color: var(--nl-text-2);
  white-space: nowrap;
}
.panel__status-badge--draft       { background: rgba(148,163,184,0.15); color: var(--nl-text-2); }
.panel__status-badge--active      { background: rgba(59,130,246,0.12);  color: var(--nl-info); }
.panel__status-badge--validation  { background: rgba(245,158,11,0.15);  color: var(--nl-warning); }
.panel__status-badge--done        { background: rgba(16,185,129,0.15);  color: var(--nl-success); }
.panel__status-badge--muted       { background: rgba(107,114,128,0.1);  color: var(--nl-text-3); }

.panel__score-cell {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.panel__score-track {
  flex: 1;
  height: 4px;
  background: var(--nl-border);
  border-radius: var(--nl-radius-pill);
  overflow: hidden;
}

.panel__score-fill {
  height: 100%;
  border-radius: var(--nl-radius-pill);
  min-width: 4px;
  transition: width 0.4s ease;
}

.panel__score-fill--low    { background: var(--nl-success); }
.panel__score-fill--medium { background: var(--nl-warning); }
.panel__score-fill--high   { background: var(--nl-danger); }

.panel__score-label {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--nl-text-2);
  min-width: 24px;
  text-align: right;
}
</style>
