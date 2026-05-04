<!--
  @file     AnalyticsBottleneckPanel.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Bottleneck heatmap panel — used inside AnalyticsSection
-->
<template>
  <div class="panel">
    <h3 class="panel__title">
      <i class="pi pi-exclamation-triangle panel__icon" />
      Goulots d'étranglement
    </h3>

    <template v-if="loading">
      <div v-for="n in 5" :key="n" class="panel__skeleton" />
    </template>

    <div v-else-if="rows.length === 0" class="panel__empty">
      <i class="pi pi-filter panel__empty-icon" />
      <span>Pas encore de données.</span>
    </div>

    <table v-else class="panel__table">
      <thead>
        <tr>
          <th>Phase</th>
          <th>En cours</th>
          <th>Moy. (jours)</th>
          <th>Criticité</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.phase"
          :class="`panel__heatmap-row--${row.severity}`"
        >
          <td class="panel__phase">{{ phaseLabel(row.phase) }}</td>
          <td class="panel__center">{{ row.currentCount }}</td>
          <td class="panel__center panel__bold">{{ row.avgDays }}j</td>
          <td>
            <span :class="`panel__severity panel__severity--${row.severity}`">
              {{ SEVERITY_LABELS[row.severity] }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { phaseLabel } from '@/utils/phaseLabels'

interface BottleneckRow {
  phase: string
  currentCount: number
  avgDays: number
  severity: 'high' | 'medium' | 'low'
}

defineProps<{
  loading: boolean
  rows: BottleneckRow[]
}>()

const SEVERITY_LABELS: Record<'high' | 'medium' | 'low', string> = {
  high: 'Élevée',
  medium: 'Moyenne',
  low: 'Faible',
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
  border-bottom: 1px solid var(--nl-border);
  vertical-align: middle;
  color: var(--nl-text-2);
}

.panel__table tr:last-child td { border-bottom: none; }

.panel__heatmap-row--high   td { background: rgba(220, 38, 38, 0.06); }
.panel__heatmap-row--medium td { background: rgba(217, 119, 6, 0.06); }
.panel__heatmap-row--low    td { background: rgba(22, 163, 74, 0.04); }

.panel__phase  { font-weight: 600; color: var(--nl-text-1); }
.panel__center { text-align: center; }
.panel__bold   { font-weight: 600; color: var(--nl-text-1); }

.panel__severity {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--nl-radius-pill);
  font-size: 0.75rem;
  font-weight: 600;
}

.panel__severity--high   { background: var(--nl-danger-light); color: var(--nl-danger); }
.panel__severity--medium { background: var(--nl-warning-light); color: var(--nl-warning); }
.panel__severity--low    { background: var(--nl-success-light); color: var(--nl-success); }
</style>
