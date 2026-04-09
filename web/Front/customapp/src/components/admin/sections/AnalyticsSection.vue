<!--
  @file     AnalyticsSection.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-27
  @desc     Admin analytics dashboard — metrics, status distribution, monthly trend, avg duration
-->
<template>
  <div class="analytics">
    <div class="section-header">
      <h2 class="section-title">Analytiques</h2>
      <p class="section-subtitle">Vue d'ensemble des projets</p>
    </div>

    <!-- Row 1: Metric cards -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">{{ totalProjects }}</div>
        <div class="metric-label">Projets créés</div>
      </div>
      <div class="metric-card">
        <div class="metric-value metric-value--success">{{ completedCount }}</div>
        <div class="metric-label">Projets terminés</div>
      </div>
      <div class="metric-card">
        <div class="metric-value metric-value--info">{{ completionRate }}%</div>
        <div class="metric-label">Taux de complétion</div>
      </div>
      <div class="metric-card">
        <div class="metric-value metric-value--secondary">{{ archivedCount }}</div>
        <div class="metric-label">Projets archivés</div>
      </div>
    </div>

    <!-- Row 2: Status distribution -->
    <div class="chart-card">
      <h3 class="chart-title">Répartition par statut</h3>
      <div class="status-bars">
        <div
          v-for="item in statusDistribution"
          :key="item.status"
          class="status-bar-row"
        >
          <div class="status-bar-label">{{ item.label }}</div>
          <div class="status-bar-track">
            <div
              class="status-bar-fill"
              :class="`status-bar-fill--${item.severity}`"
              :style="{ width: item.pct + '%' }"
            />
          </div>
          <div class="status-bar-count">{{ item.count }}</div>
        </div>
      </div>
    </div>

    <!-- Row 3: Monthly creation trend -->
    <div class="chart-card">
      <h3 class="chart-title">Tendance mensuelle (6 derniers mois)</h3>
      <div class="monthly-chart">
        <div
          v-for="m in monthlyTrend"
          :key="m.key"
          class="monthly-col"
        >
          <div class="monthly-bar-wrap">
            <div
              class="monthly-bar"
              :style="{ height: m.pct + '%' }"
            />
          </div>
          <div class="monthly-label">{{ m.label }}</div>
          <div class="monthly-count">{{ m.count }}</div>
        </div>
      </div>
    </div>

    <!-- Row 4: Average days per status -->
    <div class="chart-card">
      <h3 class="chart-title">Durée moyenne par statut</h3>
      <table class="avg-table">
        <thead>
          <tr>
            <th>Statut</th>
            <th>Nb projets</th>
            <th>Durée moy. (jours)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in avgDurationRows" :key="row.status">
            <td>{{ row.label }}</td>
            <td>{{ row.count }}</td>
            <td>{{ row.avgDays }}</td>
          </tr>
          <tr v-if="avgDurationRows.length === 0">
            <td colspan="3" class="empty-row">Aucune donnée disponible.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useProjectStore } from '@/stores/projectStore'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'

const store = useProjectStore()

onMounted(async () => {
  if (store.projects.length === 0) {
    await store.fetchAll()
  }
})

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_STATUSES: ProjectStatus[] = [
  'Draft',
  'InProgress',
  'SpecificationValidation',
  'Realization',
  'DeploymentValidation',
  'Completed',
  'Archived',
]

const FRENCH_MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

// ─── Row 1: Metric computeds ──────────────────────────────────────────────────

const totalProjects = computed(() => store.projects.length)

const completedCount = computed(
  () => store.projects.filter((p) => p.status === 'Completed').length
)

const archivedCount = computed(
  () => store.projects.filter((p) => p.status === 'Archived').length
)

const completionRate = computed(() => {
  if (totalProjects.value === 0) return 0
  return Math.round((completedCount.value / totalProjects.value) * 100)
})

// ─── Row 2: Status distribution ───────────────────────────────────────────────

const statusDistribution = computed(() => {
  const max = Math.max(
    1,
    ...ALL_STATUSES.map((s) => store.projects.filter((p) => p.status === s).length)
  )
  return ALL_STATUSES.map((s) => {
    const count = store.projects.filter((p) => p.status === s).length
    return {
      status: s,
      label: PROJECT_STATUS_LABELS[s],
      count,
      severity: PROJECT_STATUS_SEVERITY[s],
      pct: Math.round((count / max) * 100),
    }
  })
})

// ─── Row 3: Monthly creation trend ───────────────────────────────────────────

const monthlyTrend = computed(() => {
  const now = new Date()
  const months: { key: string; label: string; count: number; pct: number }[] = []

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const yr = d.getFullYear()
    const mo = d.getMonth() // 0-based
    const key = `${yr}-${String(mo + 1).padStart(2, '0')}`
    const count = store.projects.filter((p) => {
      const cd = new Date(p.createdAt)
      return cd.getFullYear() === yr && cd.getMonth() === mo
    }).length
    months.push({ key, label: FRENCH_MONTHS[mo], count, pct: 0 })
  }

  const maxCount = Math.max(1, ...months.map((m) => m.count))
  return months.map((m) => ({
    ...m,
    pct: Math.round((m.count / maxCount) * 100),
  }))
})

// ─── Row 4: Average days per status ───────────────────────────────────────────

interface AvgDurationRow {
  status: ProjectStatus
  label: string
  count: number
  avgDays: number
}

const avgDurationRows = computed((): AvgDurationRow[] => {
  const today = new Date()

  const rows = ALL_STATUSES.map((s) => {
    const group = store.projects.filter((p) => p.status === s)
    const totalDays = group.reduce((acc, p) => {
      const created = new Date(p.createdAt)
      const diff = Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86400000))
      return acc + diff
    }, 0)
    return {
      status: s,
      label: PROJECT_STATUS_LABELS[s],
      count: group.length,
      avgDays: group.length > 0 ? Math.round(totalDays / group.length) : 0,
    }
  })

  return rows
    .filter((r) => r.count > 0)
    .sort((a, b) => b.avgDays - a.avgDays)
})
</script>

<style scoped>
.analytics {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.section-header { margin-bottom: 0.25rem; }
.section-title  { font-size: 1.5rem; font-weight: 800; color: var(--nl-text-1); margin: 0; }
.section-subtitle { font-size: 0.875rem; color: var(--nl-text-3); margin: 0.25rem 0 0; }

/* ── Metric cards ──────────────────────────────────────────────────────────── */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

.metric-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.metric-value {
  font-size: 2rem;
  font-weight: 800;
  color: var(--nl-text-1);
  line-height: 1;
}
.metric-value--success  { color: var(--nl-success); }
.metric-value--info     { color: var(--nl-accent); }
.metric-value--secondary { color: var(--nl-text-3); }

.metric-label {
  font-size: 0.8rem;
  color: var(--nl-text-3);
  font-weight: 500;
}

/* ── Chart card ─────────────────────────────────────────────────────────────── */
.chart-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  padding: 1.5rem;
}

.chart-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0 0 1.25rem;
}

/* ── Status bar chart ───────────────────────────────────────────────────────── */
.status-bars {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.status-bar-row {
  display: grid;
  grid-template-columns: 200px 1fr 40px;
  align-items: center;
  gap: 0.75rem;
}

.status-bar-label {
  font-size: 0.85rem;
  color: var(--nl-text-2);
  font-weight: 500;
  text-align: right;
}

.status-bar-track {
  height: 12px;
  background: var(--nl-surface-2);
  border-radius: 6px;
  overflow: hidden;
}

.status-bar-fill {
  height: 100%;
  border-radius: 6px;
  min-width: 4px;
  transition: width 0.4s ease;
}

.status-bar-fill--secondary { background: var(--nl-border-strong); }
.status-bar-fill--info      { background: var(--nl-accent); }
.status-bar-fill--warning   { background: var(--nl-warning); }
.status-bar-fill--success   { background: var(--nl-success); }

.status-bar-count {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--nl-text-2);
  text-align: center;
}

/* ── Monthly bar chart ──────────────────────────────────────────────────────── */
.monthly-chart {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  height: 160px;
  padding-bottom: 1.75rem;
  position: relative;
}

.monthly-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  justify-content: flex-end;
  gap: 0.35rem;
}

.monthly-bar-wrap {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
}

.monthly-bar {
  width: 100%;
  background: var(--nl-accent);
  border-radius: 4px 4px 0 0;
  min-height: 4px;
  transition: height 0.4s ease;
}

.monthly-label {
  font-size: 0.75rem;
  color: var(--nl-text-3);
  font-weight: 500;
}

.monthly-count {
  font-size: 0.75rem;
  color: var(--nl-text-2);
  font-weight: 600;
}

/* ── Avg table ──────────────────────────────────────────────────────────────── */
.avg-table {
  width: 100%;
  border-collapse: collapse;
}

.avg-table th {
  background: var(--nl-surface-2);
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-size: 0.8rem;
  text-transform: uppercase;
  color: var(--nl-text-3);
  letter-spacing: 0.05em;
  font-weight: 600;
}

.avg-table td {
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--nl-border);
  font-size: 0.875rem;
  color: var(--nl-text-2);
}

.avg-table tr:last-child td { border-bottom: none; }

.empty-row {
  text-align: center;
  color: var(--nl-text-3);
  font-style: italic;
  padding: 1.5rem;
}

/* ── Responsive ─────────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .metrics-grid { grid-template-columns: repeat(2, 1fr); }
  .status-bar-row { grid-template-columns: 120px 1fr 32px; }
}
</style>
