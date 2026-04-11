<!--
  @file     AnalyticsSection.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Advanced Analytics dashboard — phase velocity, bottleneck heatmap,
            deadline risk table, team workload
-->
<template>
  <div class="analytics">
    <!-- ── Header ───────────────────────────────────────────────────────────── -->
    <div class="analytics__header">
      <div class="analytics__header-text">
        <h2 class="analytics__title">Analytiques avancées</h2>
        <p class="analytics__subtitle">Vélocité, goulots, risques et charge équipe</p>
      </div>
      <NeoButton
        label="Actualiser"
        icon="pi pi-refresh"
        :loading="store.loading"
        @click="store.fetchAll()"
      />
    </div>

    <NeoMessage v-if="store.error" severity="error" :text="store.error" />

    <!-- ── 2×2 panel grid ────────────────────────────────────────────────────── -->
    <div class="analytics__grid">

      <!-- Panel 1: Phase Velocity chart ──────────────────────────────────── -->
      <div class="analytics__panel">
        <h3 class="analytics__panel-title">
          <i class="pi pi-clock analytics__panel-icon" />
          Vélocité par phase
        </h3>

        <template v-if="store.loading">
          <div v-for="n in 5" :key="n" class="analytics__skeleton" />
        </template>

        <div v-else-if="store.phaseVelocity.length === 0" class="analytics__empty">
          <i class="pi pi-chart-bar analytics__empty-icon" />
          <span>Pas encore de données de transition.</span>
        </div>

        <div v-else class="analytics__chart-wrap">
          <Bar :data="velocityChartData" :options="velocityChartOptions" />
          <div class="analytics__velocity-meta">
            <div v-for="row in store.phaseVelocity" :key="row.phase" class="analytics__velocity-row">
              <span class="analytics__velocity-phase">{{ row.phase }}</span>
              <span class="analytics__velocity-range">
                min {{ row.minDays }}j — max {{ row.maxDays }}j
                ({{ row.projectCount }} projet{{ row.projectCount > 1 ? 's' : '' }})
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Panel 2: Bottleneck heatmap ───────────────────────────────────── -->
      <AnalyticsBottleneckPanel
        :loading="store.loading"
        :rows="store.bottleneck"
      />

      <!-- Panel 3: Deadline risk table (wide) ───────────────────────────── -->
      <AnalyticsRiskPanel
        :loading="store.loading"
        :rows="store.deadlineRisk"
        @navigate="goToProject"
      />

      <!-- Panel 4: Team workload chart ──────────────────────────────────── -->
      <div class="analytics__panel">
        <h3 class="analytics__panel-title">
          <i class="pi pi-users analytics__panel-icon" />
          Charge équipe (chefs de projet)
        </h3>

        <template v-if="store.loading">
          <div v-for="n in 4" :key="n" class="analytics__skeleton" />
        </template>

        <div v-else-if="store.teamWorkload.length === 0" class="analytics__empty">
          <i class="pi pi-users analytics__empty-icon" />
          <span>Aucun chef de projet actif.</span>
        </div>

        <div v-else class="analytics__chart-wrap">
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
import AnalyticsBottleneckPanel from './AnalyticsBottleneckPanel.vue'
import AnalyticsRiskPanel from './AnalyticsRiskPanel.vue'

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Title, Tooltip, Legend)

// ─── Design tokens ────────────────────────────────────────────────────────────

const CHART_PRIMARY = '#0F62FE'
const CHART_DANGER  = '#DC2626'
const CHART_SUCCESS = '#16A34A'
const CHART_GRID    = 'rgba(0, 0, 0, 0.04)'

// ─── Store / router ───────────────────────────────────────────────────────────

const store = useAnalyticsStore()
const router = useRouter()

onMounted(() => store.fetchAll())

function goToProject(id: string): void {
  router.push({ name: 'admin-project-detail', params: { id } })
}

// ─── Velocity chart ───────────────────────────────────────────────────────────

const velocityChartData = computed(() => ({
  labels: store.phaseVelocity.map((r) => r.phase),
  datasets: [
    {
      label: 'Durée moyenne (jours)',
      data: store.phaseVelocity.map((r) => r.avgDays),
      backgroundColor: CHART_PRIMARY,
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
      callbacks: { label: (ctx: { raw: unknown }) => ` ${ctx.raw} jours en moyenne` },
    },
  },
  scales: {
    x: {
      title: { display: true, text: 'Jours', color: '#71717A', font: { size: 11 } },
      grid: { color: CHART_GRID },
      ticks: { color: '#71717A', font: { size: 11 } },
    },
    y: {
      grid: { display: false },
      ticks: { color: '#3F3F46', font: { size: 11 } },
    },
  },
}))

// ─── Workload chart ───────────────────────────────────────────────────────────

const workloadChartData = computed(() => ({
  labels: store.teamWorkload.map((r) => r.pmName),
  datasets: [
    { label: 'Actifs',         data: store.teamWorkload.map((r) => r.active),    backgroundColor: CHART_PRIMARY, borderRadius: 3 },
    { label: 'En retard',      data: store.teamWorkload.map((r) => r.overdue),   backgroundColor: CHART_DANGER,  borderRadius: 3 },
    { label: 'Terminés (90j)', data: store.teamWorkload.map((r) => r.completed), backgroundColor: CHART_SUCCESS, borderRadius: 3 },
  ],
}))

const workloadChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: { boxWidth: 12, font: { size: 11 }, color: '#3F3F46' },
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { color: '#71717A', font: { size: 11 } } },
    y: { grid: { color: CHART_GRID }, ticks: { stepSize: 1, color: '#71717A', font: { size: 11 } } },
  },
}))
</script>

<style scoped>
.analytics {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* ── Header ─────────────────────────────────────────────────────────────────── */
.analytics__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.analytics__header-text { flex: 1; }

.analytics__title {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
  letter-spacing: -0.01em;
}

.analytics__subtitle {
  font-size: 0.8125rem;
  color: var(--nl-text-3);
  margin: 0.2rem 0 0;
}

/* ── Grid ────────────────────────────────────────────────────────────────────── */
.analytics__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.25rem;
}

/* ── Chart panels (velocity + workload) ──────────────────────────────────────── */
.analytics__panel {
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

.analytics__panel-title {
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

.analytics__panel-icon { color: var(--nl-accent); font-size: 13px; }

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
.analytics__skeleton {
  height: 36px;
  border-radius: var(--nl-radius);
  background: linear-gradient(90deg, var(--nl-surface-2) 25%, var(--nl-border) 50%, var(--nl-surface-2) 75%);
  background-size: 200% 100%;
  animation: as-shimmer 1.4s infinite;
}

@keyframes as-shimmer {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}

/* ── Empty state ─────────────────────────────────────────────────────────── */
.analytics__empty {
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

.analytics__empty-icon { font-size: 1.75rem; color: var(--nl-border-strong); }

/* ── Chart wrap ──────────────────────────────────────────────────────────── */
.analytics__chart-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* Chart.js Bar needs a positioned parent with explicit height */
.analytics__chart-wrap > div {
  position: relative;
  height: 200px;
  width: 100%;
}

/* ── Velocity meta ───────────────────────────────────────────────────────── */
.analytics__velocity-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  border-top: 1px solid var(--nl-border);
  padding-top: 0.75rem;
}

.analytics__velocity-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--nl-text-3);
}

.analytics__velocity-phase { font-weight: 600; color: var(--nl-text-2); }
.analytics__velocity-range { font-style: italic; }

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .analytics__grid { grid-template-columns: 1fr; }
}
</style>
