<!--
  @file     AnalyticsSection.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Advanced Analytics dashboard — phase velocity, bottleneck heatmap,
            deadline risk table, team workload
-->
<template>
  <div class="analytics">
    <!-- ── Header ───────────────────────────────────────────────────────────── -->
    <div class="section-header">
      <div class="section-header__text">
        <h2 class="section-title">Analytiques avancées</h2>
        <p class="section-subtitle">Vélocité, goulots, risques et charge équipe</p>
      </div>
      <NeoButton
        label="Actualiser"
        icon="pi pi-refresh"
        :loading="store.loading"
        @click="store.fetchAll()"
      />
    </div>

    <!-- ── Error banner ──────────────────────────────────────────────────────── -->
    <NeoMessage
      v-if="store.error"
      severity="error"
      :text="store.error"
    />

    <!-- ── 2×2 panel grid ────────────────────────────────────────────────────── -->
    <div class="panels-grid">

      <!-- Panel 1: Phase Velocity ──────────────────────────────────────────── -->
      <div class="panel">
        <h3 class="panel-title">
          <i class="pi pi-clock panel-title__icon" />
          Vélocité par phase
        </h3>

        <!-- Skeleton -->
        <template v-if="store.loading">
          <div v-for="n in 5" :key="n" class="skeleton-row" />
        </template>

        <!-- Empty state -->
        <div
          v-else-if="store.phaseVelocity.length === 0"
          class="empty-state"
        >
          Pas encore de données de transition.
        </div>

        <!-- Chart -->
        <div v-else class="chart-wrap">
          <Bar :data="velocityChartData" :options="velocityChartOptions" />
          <div class="velocity-meta">
            <div
              v-for="row in store.phaseVelocity"
              :key="row.phase"
              class="velocity-meta-row"
            >
              <span class="velocity-meta-phase">{{ row.phase }}</span>
              <span class="velocity-meta-range">
                min {{ row.minDays }}j — max {{ row.maxDays }}j
                ({{ row.projectCount }} projet{{ row.projectCount > 1 ? 's' : '' }})
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Panel 2: Bottleneck Heatmap ────────────────────────────────────── -->
      <div class="panel">
        <h3 class="panel-title">
          <i class="pi pi-exclamation-triangle panel-title__icon" />
          Goulots d'étranglement
        </h3>

        <template v-if="store.loading">
          <div v-for="n in 5" :key="n" class="skeleton-row" />
        </template>

        <div
          v-else-if="store.bottleneck.length === 0"
          class="empty-state"
        >
          Pas encore de données.
        </div>

        <table v-else class="heatmap-table">
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
              v-for="row in store.bottleneck"
              :key="row.phase"
              :class="`heatmap-row--${row.severity}`"
            >
              <td class="heatmap-phase">{{ row.phase }}</td>
              <td class="heatmap-count">{{ row.currentCount }}</td>
              <td class="heatmap-days">{{ row.avgDays }}j</td>
              <td>
                <span :class="`severity-badge severity-badge--${row.severity}`">
                  {{ SEVERITY_LABELS[row.severity] }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Panel 3: Deadline Risk ──────────────────────────────────────────── -->
      <div class="panel panel--wide">
        <h3 class="panel-title">
          <i class="pi pi-calendar-times panel-title__icon" />
          Risque de dépassement
        </h3>

        <template v-if="store.loading">
          <div v-for="n in 5" :key="n" class="skeleton-row" />
        </template>

        <div
          v-else-if="store.deadlineRisk.length === 0"
          class="empty-state"
        >
          Aucun projet actif avec une date de fin définie.
        </div>

        <table v-else class="risk-table">
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
              v-for="row in store.deadlineRisk"
              :key="row.projectId"
              class="risk-row"
              role="link"
              tabindex="0"
              @click="goToProject(row.projectId)"
              @keydown.enter="goToProject(row.projectId)"
            >
              <td class="risk-name">{{ row.projectName }}</td>
              <td class="risk-pm">{{ row.pmName ?? '—' }}</td>
              <td>
                <span class="status-badge">{{ row.status }}</span>
              </td>
              <td :class="row.daysRemaining < 0 ? 'risk-overdue' : 'risk-days'">
                {{ row.daysRemaining < 0 ? `${Math.abs(row.daysRemaining)}j en retard` : `${row.daysRemaining}j` }}
              </td>
              <td class="risk-score-cell">
                <div class="risk-bar-wrap">
                  <div
                    class="risk-bar"
                    :class="riskBarClass(row.riskScore)"
                    :style="{ width: row.riskScore + '%' }"
                  />
                </div>
                <span class="risk-score-label">{{ row.riskScore }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Panel 4: Team Workload ──────────────────────────────────────────── -->
      <div class="panel">
        <h3 class="panel-title">
          <i class="pi pi-users panel-title__icon" />
          Charge équipe (chefs de projet)
        </h3>

        <template v-if="store.loading">
          <div v-for="n in 4" :key="n" class="skeleton-row" />
        </template>

        <div
          v-else-if="store.teamWorkload.length === 0"
          class="empty-state"
        >
          Aucun chef de projet actif.
        </div>

        <div v-else class="chart-wrap">
          <Bar :data="workloadChartData" :options="workloadChartOptions" />
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { NeoButton, NeoMessage } from '@neolibrary/components'
import { useAnalyticsStore } from '@/stores/analyticsStore'

// ─── Chart.js registration ────────────────────────────────────────────────────

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Title, Tooltip, Legend)

// ─── Store / router ───────────────────────────────────────────────────────────

const store = useAnalyticsStore()
const router = useRouter()

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_LABELS: Record<'high' | 'medium' | 'low', string> = {
  high: 'Élevée',
  medium: 'Moyenne',
  low: 'Faible',
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  store.fetchAll()
})

// ─── Navigation ───────────────────────────────────────────────────────────────

function goToProject(id: string): void {
  router.push({ name: 'admin-project-detail', params: { id } })
}

// ─── Risk bar helper ──────────────────────────────────────────────────────────

function riskBarClass(score: number): string {
  if (score > 70) return 'risk-bar--high'
  if (score > 40) return 'risk-bar--medium'
  return 'risk-bar--low'
}

// ─── Panel 1: Velocity chart data ─────────────────────────────────────────────

const velocityChartData = computed(() => ({
  labels: store.phaseVelocity.map((r) => r.phase),
  datasets: [
    {
      label: 'Durée moyenne (jours)',
      data: store.phaseVelocity.map((r) => r.avgDays),
      backgroundColor: '#0d9488',
      borderRadius: 4,
    },
  ],
}))

const velocityChartOptions = computed(() => ({
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: { raw: unknown }) => ` ${ctx.raw} jours en moyenne`,
      },
    },
  },
  scales: {
    x: {
      title: { display: true, text: 'Jours' },
      grid: { color: 'rgba(0,0,0,0.05)' },
    },
    y: { grid: { display: false } },
  },
}))

// ─── Panel 4: Workload chart data ─────────────────────────────────────────────

const workloadChartData = computed(() => ({
  labels: store.teamWorkload.map((r) => r.pmName),
  datasets: [
    {
      label: 'Actifs',
      data: store.teamWorkload.map((r) => r.active),
      backgroundColor: '#0d9488',
      borderRadius: 3,
    },
    {
      label: 'En retard',
      data: store.teamWorkload.map((r) => r.overdue),
      backgroundColor: '#ef4444',
      borderRadius: 3,
    },
    {
      label: 'Terminés (90j)',
      data: store.teamWorkload.map((r) => r.completed),
      backgroundColor: '#22c55e',
      borderRadius: 3,
    },
  ],
}))

const workloadChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: { boxWidth: 12, font: { size: 11 } },
    },
  },
  scales: {
    x: { grid: { display: false } },
    y: {
      grid: { color: 'rgba(0,0,0,0.05)' },
      ticks: { stepSize: 1 },
    },
  },
}))
</script>

<style scoped>
/* ── Layout ─────────────────────────────────────────────────────────────────── */
.analytics {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.section-header__text { flex: 1; }
.section-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--nl-text-1);
  margin: 0;
}
.section-subtitle {
  font-size: 0.875rem;
  color: var(--nl-text-3);
  margin: 0.25rem 0 0;
}

/* ── 2x2 grid ───────────────────────────────────────────────────────────────── */
.panels-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.25rem;
}

.panel {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 320px;
}

.panel--wide {
  grid-column: span 2;
}

/* ── Panel title ────────────────────────────────────────────────────────────── */
.panel-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.panel-title__icon {
  color: var(--nl-accent);
  font-size: 1rem;
}

/* ── Skeleton ────────────────────────────────────────────────────────────────── */
.skeleton-row {
  height: 36px;
  background: linear-gradient(90deg, var(--nl-surface-2) 25%, var(--nl-border) 50%, var(--nl-surface-2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 6px;
}

@keyframes shimmer {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}

/* ── Empty state ─────────────────────────────────────────────────────────────── */
.empty-state {
  color: var(--nl-text-3);
  font-style: italic;
  font-size: 0.9rem;
  padding: 2rem 0;
  text-align: center;
}

/* ── Chart wrapper ───────────────────────────────────────────────────────────── */
.chart-wrap {
  flex: 1;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* ── Velocity meta (min/max legends) ─────────────────────────────────────────── */
.velocity-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  border-top: 1px solid var(--nl-border);
  padding-top: 0.75rem;
}
.velocity-meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  color: var(--nl-text-3);
}
.velocity-meta-phase { font-weight: 600; color: var(--nl-text-2); }
.velocity-meta-range { font-style: italic; }

/* ── Heatmap table ───────────────────────────────────────────────────────────── */
.heatmap-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.heatmap-table th {
  background: var(--nl-surface-2);
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-size: 0.78rem;
  text-transform: uppercase;
  color: var(--nl-text-3);
  letter-spacing: 0.05em;
  font-weight: 600;
}
.heatmap-table td {
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--nl-border);
  vertical-align: middle;
}
.heatmap-table tr:last-child td { border-bottom: none; }

.heatmap-row--high  td { background: rgba(239, 68, 68, 0.08); }
.heatmap-row--medium td { background: rgba(245, 158, 11, 0.08); }
.heatmap-row--low   td { background: rgba(34, 197, 94, 0.06); }

.heatmap-phase { font-weight: 600; color: var(--nl-text-1); }
.heatmap-count { text-align: center; }
.heatmap-days  { text-align: center; font-weight: 600; }

/* ── Severity badge ──────────────────────────────────────────────────────────── */
.severity-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.severity-badge--high   { background: rgba(239, 68, 68, 0.15); color: #dc2626; }
.severity-badge--medium { background: rgba(245, 158, 11, 0.15); color: #d97706; }
.severity-badge--low    { background: rgba(34, 197, 94, 0.15);  color: #16a34a; }

/* ── Risk table ──────────────────────────────────────────────────────────────── */
.risk-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.risk-table th {
  background: var(--nl-surface-2);
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-size: 0.78rem;
  text-transform: uppercase;
  color: var(--nl-text-3);
  letter-spacing: 0.05em;
  font-weight: 600;
}
.risk-table td {
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--nl-border);
  vertical-align: middle;
}
.risk-table tr:last-child td { border-bottom: none; }

.risk-row {
  cursor: pointer;
  transition: background 0.15s;
}
.risk-row:hover td { background: var(--nl-surface-2); }

.risk-name  { font-weight: 600; color: var(--nl-text-1); }
.risk-pm    { color: var(--nl-text-2); }
.risk-days  { color: var(--nl-text-2); }
.risk-overdue { color: #dc2626; font-weight: 600; }

.status-badge {
  display: inline-block;
  padding: 0.2rem 0.55rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--nl-surface-2);
  color: var(--nl-text-2);
}

/* ── Risk score bar ──────────────────────────────────────────────────────────── */
.risk-score-cell {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.risk-bar-wrap {
  flex: 1;
  height: 8px;
  background: var(--nl-surface-2);
  border-radius: 4px;
  overflow: hidden;
}
.risk-bar {
  height: 100%;
  border-radius: 4px;
  min-width: 4px;
  transition: width 0.4s ease;
}
.risk-bar--low    { background: #22c55e; }
.risk-bar--medium { background: #f59e0b; }
.risk-bar--high   { background: #ef4444; }
.risk-score-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--nl-text-2);
  min-width: 24px;
  text-align: right;
}

/* ── Responsive ─────────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .panels-grid { grid-template-columns: 1fr; }
  .panel--wide { grid-column: span 1; }
}
</style>
