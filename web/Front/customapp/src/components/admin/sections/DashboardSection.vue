<!--
  @file     DashboardSection.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Tableau de bord — KPI strip, status breakdown, completion ring, deadline table
-->
<template>
  <div class="dash">
    <!-- Page heading -->
    <div class="dash-heading">
      <div>
        <h1 class="dash-title">Tableau de bord</h1>
        <p class="dash-date">{{ todayLabel }}</p>
      </div>
      <div class="heading-right">
        <span class="total-pill">
          {{ projectStore.projects.length }} projets au total
        </span>
      </div>
    </div>

    <!-- KPI strip -->
    <div class="kpi-strip">
      <div class="kpi" :class="overdueCount > 0 ? 'kpi--warn' : ''">
        <span class="kpi-num">{{ activeCount }}</span>
        <span class="kpi-lbl">Projets actifs</span>
        <span class="kpi-badge kpi-badge--neutral">en cours</span>
      </div>
      <div class="kpi-divider" />
      <div class="kpi">
        <span class="kpi-num" :class="overdueCount > 0 ? 'text-danger' : ''">{{ overdueCount }}</span>
        <span class="kpi-lbl">En retard</span>
        <span v-if="overdueCount > 0" class="kpi-badge kpi-badge--danger">action requise</span>
        <span v-else class="kpi-badge kpi-badge--success">à jour</span>
      </div>
      <div class="kpi-divider" />
      <div class="kpi">
        <span class="kpi-num" :class="pendingValidationCount > 0 ? 'text-warning' : ''">{{ pendingValidationCount }}</span>
        <span class="kpi-lbl">Validations en attente</span>
        <span v-if="pendingValidationCount > 0" class="kpi-badge kpi-badge--warn">à valider</span>
        <span v-else class="kpi-badge kpi-badge--neutral">aucune</span>
      </div>
      <div class="kpi-divider" />
      <div class="kpi">
        <span class="kpi-num">{{ userStore.users.length }}</span>
        <span class="kpi-lbl">Utilisateurs actifs</span>
        <span class="kpi-badge kpi-badge--neutral">membres</span>
      </div>
    </div>

    <!-- Mid row -->
    <div class="mid-grid">
      <!-- Status breakdown -->
      <div class="card status-card">
        <h2 class="card-title">Répartition par statut</h2>

        <!-- Stacked bar -->
        <div class="stacked-bar" role="img" :aria-label="`Répartition: ${stackedAriaLabel}`">
          <div
            v-for="s in STATUS_ORDER.filter(x => statusCount(x) > 0)"
            :key="s"
            class="stack-seg"
            :style="{ width: barWidth(statusCount(s)), background: STATUS_COLORS[s] }"
            :title="`${PROJECT_STATUS_LABELS[s]}: ${statusCount(s)}`"
          />
        </div>

        <!-- Legend -->
        <div class="legend">
          <div
            v-for="s in STATUS_ORDER"
            :key="s"
            class="legend-row"
          >
            <span class="legend-dot" :style="{ background: STATUS_COLORS[s] }" />
            <span class="legend-lbl">{{ PROJECT_STATUS_LABELS[s] }}</span>
            <span class="legend-bar-wrap">
              <span class="legend-bar" :style="{ width: barWidth(statusCount(s)), background: STATUS_COLORS[s] + '40' }" />
            </span>
            <span class="legend-count">{{ statusCount(s) }}</span>
          </div>
        </div>
      </div>

      <!-- Completion -->
      <div class="card completion-card">
        <h2 class="card-title">Complétion</h2>
        <div class="ring-area">
          <svg class="ring-svg" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="ring-bg" cx="50" cy="50" r="40" />
            <circle
              class="ring-prog"
              cx="50" cy="50" r="40"
              :stroke-dasharray="`${completionArc} 251`"
              stroke-linecap="round"
            />
          </svg>
          <div class="ring-label">
            <span class="ring-pct">{{ completionPct }}%</span>
            <span class="ring-sub">terminés</span>
          </div>
        </div>
        <div class="completion-row">
          <div class="c-stat">
            <span class="c-stat-num c-stat-num--green">{{ completedCount }}</span>
            <span class="c-stat-lbl">terminés</span>
          </div>
          <div class="c-stat-sep" />
          <div class="c-stat">
            <span class="c-stat-num">{{ projectStore.projects.length - completedCount }}</span>
            <span class="c-stat-lbl">en cours</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Deadline table -->
    <div class="card deadline-card">
      <div class="card-header">
        <h2 class="card-title">Échéances dans les 14 jours</h2>
        <NeoTag
          v-if="upcomingDeadlines.length"
          :value="String(upcomingDeadlines.length)"
          severity="warn"
        />
      </div>

      <div v-if="upcomingDeadlines.length === 0" class="empty-state">
        <i class="pi pi-check-square empty-icon" aria-hidden="true" />
        <span>Aucune échéance imminente — bonne nouvelle !</span>
      </div>

      <table v-else class="dt">
        <thead>
          <tr>
            <th>Projet</th>
            <th>Client</th>
            <th>Statut</th>
            <th>Échéance</th>
            <th>Jours restants</th>
            <th>Chef de projet</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in upcomingDeadlines" :key="p.id">
            <td class="dt-name">{{ p.name }}</td>
            <td class="dt-muted">{{ p.clientName }}</td>
            <td>
              <NeoTag :value="PROJECT_STATUS_LABELS[p.status]" :severity="statusSeverity(p.status)" />
            </td>
            <td class="dt-muted">{{ formatDate(p.endDate) }}</td>
            <td>
              <span class="urgency" :class="urgencyClass(p.endDate)">{{ urgencyLabel(p.endDate) }}</span>
            </td>
            <td class="dt-muted">{{ p.projectManagerName ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { NeoTag } from '@neolibrary/components'
import { useProjectStore } from '@/stores/projectStore'
import { useUserStore } from '@/stores/userStore'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'

const projectStore = useProjectStore()
const userStore    = useUserStore()

onMounted(() => {
  if (projectStore.projects.length === 0) projectStore.fetchAll()
  if (userStore.users.length === 0) userStore.fetchAll()
})

// ── Status ordering & colors ───────────────────────────────────────────────────
const STATUS_ORDER: ProjectStatus[] = [
  'Draft', 'InProgress', 'SpecificationValidation',
  'Realization', 'DeploymentValidation', 'Completed', 'Archived',
]

const STATUS_COLORS: Record<ProjectStatus, string> = {
  Draft:                   '#94a3b8',
  InProgress:              '#3b82f6',
  SpecificationValidation: '#f59e0b',
  Realization:             '#6366f1',
  DeploymentValidation:    '#f59e0b',
  Completed:               '#10b981',
  Archived:                '#cbd5e1',
}

// ── KPI computeds ─────────────────────────────────────────────────────────────
const activeCount = computed(() =>
  projectStore.projects.filter(
    (p) => p.status !== 'Completed' && p.status !== 'Archived',
  ).length,
)

const overdueCount = computed(() => {
  const now = Date.now()
  return projectStore.projects.filter((p) => {
    if (!p.endDate || p.status === 'Completed' || p.status === 'Archived') return false
    return new Date(p.endDate).getTime() < now
  }).length
})

const pendingValidationCount = computed(() =>
  projectStore.projects.filter(
    (p) => p.status === 'SpecificationValidation' || p.status === 'DeploymentValidation',
  ).length,
)

const completedCount = computed(() =>
  projectStore.projects.filter((p) => p.status === 'Completed').length,
)

// ── Status bar helpers ─────────────────────────────────────────────────────────
const statusCount = (s: ProjectStatus) =>
  projectStore.projects.filter((p) => p.status === s).length

const barWidth = (count: number): string => {
  const total = projectStore.projects.length
  return total === 0 ? '0%' : `${Math.round((count / total) * 100)}%`
}

const barPct = (count: number): string => {
  const total = projectStore.projects.length
  return total === 0 ? '0%' : `${Math.round((count / total) * 100)}%`
}

// ── Completion ring (circumference of r=40 ≈ 251) ─────────────────────────────
const completionPct = computed(() => {
  const total = projectStore.projects.length
  return total === 0 ? 0 : Math.round((completedCount.value / total) * 100)
})

const completionArc = computed(() => (completionPct.value / 100) * 251)

// ── Deadline helpers ───────────────────────────────────────────────────────────
const upcomingDeadlines = computed(() => {
  const now    = Date.now()
  const cutoff = now + 14 * 24 * 60 * 60 * 1000
  return projectStore.projects
    .filter((p) => {
      if (!p.endDate || p.status === 'Completed' || p.status === 'Archived') return false
      return new Date(p.endDate).getTime() < cutoff
    })
    .slice()
    .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
})

function urgencyClass(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0)             return 'urgency--overdue'
  if (ms < 7 * 86400000) return 'urgency--critical'
  return 'urgency--warn'
}

function urgencyLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0) return 'Dépassé'
  return `${Math.ceil(ms / 86400000)} j`
}

const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR') : '—'

// ── New helpers ────────────────────────────────────────────────────────────────
const todayLabel = computed(() =>
  new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
)

const stackedAriaLabel = computed(() =>
  STATUS_ORDER
    .filter(s => statusCount(s) > 0)
    .map(s => `${PROJECT_STATUS_LABELS[s]}: ${statusCount(s)}`)
    .join(', ')
)
</script>

<style scoped>
.dash { display: flex; flex-direction: column; gap: 1.5rem; font-family: var(--nl-font); }

/* Heading */
.dash-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.dash-title { font-size: 1.375rem; font-weight: 800; color: var(--nl-text-1); letter-spacing: -0.3px; }
.dash-date  { font-size: 0.8125rem; color: var(--nl-text-3); margin-top: 0.2rem; text-transform: capitalize; }
.total-pill {
  display: inline-flex; align-items: center; gap: 0.375rem;
  background: var(--nl-surface); border: 1px solid var(--nl-border);
  border-radius: 20px; padding: 0.3rem 0.875rem;
  font-size: 0.75rem; font-weight: 500; color: var(--nl-text-2);
}

/* KPI strip */
.kpi-strip {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  display: flex;
  align-items: stretch;
  overflow: hidden;
}

.kpi {
  flex: 1;
  padding: 1.5rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  position: relative;
}

.kpi--warn { background: #FFFCF0; }

.kpi-divider {
  width: 1px;
  background: var(--nl-border);
  flex-shrink: 0;
  margin: 1rem 0;
}

.kpi-num {
  font-size: 2.25rem;
  font-weight: 800;
  color: var(--nl-text-1);
  letter-spacing: -1px;
  line-height: 1;
}

.text-danger  { color: var(--nl-danger) !important; }
.text-warning { color: var(--nl-warning) !important; }

.kpi-lbl {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--nl-text-3);
}

.kpi-badge {
  display: inline-flex;
  align-items: center;
  margin-top: 0.375rem;
  padding: 0.15rem 0.5rem;
  border-radius: 20px;
  font-size: 0.65rem;
  font-weight: 600;
  width: fit-content;
}

.kpi-badge--neutral { background: var(--nl-border); color: var(--nl-text-3); }
.kpi-badge--success { background: #DCFCE7; color: #15803D; }
.kpi-badge--danger  { background: #FEE2E2; color: #DC2626; }
.kpi-badge--warn    { background: #FEF3C7; color: #B45309; }

/* Mid grid */
.mid-grid {
  display: grid;
  grid-template-columns: 1fr 240px;
  gap: 1rem;
}

/* Cards */
.card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  padding: 1.25rem 1.5rem;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-bottom: 1rem;
}

.card-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin-bottom: 1rem;
}

.card-header .card-title { margin-bottom: 0; }

/* Stacked bar */
.stacked-bar {
  height: 8px;
  background: var(--nl-border);
  border-radius: 4px;
  display: flex;
  overflow: hidden;
  margin-bottom: 1.125rem;
}

.stack-seg {
  height: 100%;
  transition: width 0.5s ease;
  min-width: 2px;
}

/* Legend */
.legend { display: flex; flex-direction: column; gap: 0.5rem; }

.legend-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-lbl {
  font-size: 0.75rem;
  color: var(--nl-text-2);
  min-width: 160px;
  flex-shrink: 0;
}

.legend-bar-wrap {
  flex: 1;
  height: 4px;
  background: var(--nl-border);
  border-radius: 2px;
  overflow: hidden;
}

.legend-bar {
  display: block;
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

.legend-count {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--nl-text-2);
  min-width: 20px;
  text-align: right;
}

/* Completion ring */
.completion-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.ring-area { position: relative; width: 120px; height: 120px; margin: 0.75rem 0; }

.ring-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.ring-bg   { fill: none; stroke: var(--nl-border); stroke-width: 10; }
.ring-prog {
  fill: none;
  stroke: var(--nl-accent);
  stroke-width: 10;
  stroke-dasharray: 0 251;
  transition: stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1);
}

.ring-label {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.ring-pct { font-size: 1.5rem; font-weight: 800; color: var(--nl-text-1); line-height: 1; }
.ring-sub { font-size: 0.65rem; color: var(--nl-text-3); margin-top: 0.125rem; }

.completion-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.5rem;
}

.c-stat { display: flex; flex-direction: column; align-items: center; }
.c-stat-num { font-size: 1.125rem; font-weight: 700; color: var(--nl-text-1); }
.c-stat-num--green { color: var(--nl-success); }
.c-stat-lbl { font-size: 0.65rem; color: var(--nl-text-3); }
.c-stat-sep { width: 1px; height: 28px; background: var(--nl-border); }

/* Deadline table */
.deadline-card { padding-bottom: 0; }
.deadline-card .card-title { margin-bottom: 0; }

.empty-state {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 2rem 0 2.5rem;
  font-size: 0.875rem;
  color: var(--nl-text-3);
  justify-content: center;
}

.empty-icon { font-size: 1.125rem; color: var(--nl-success); }

/* Data table */
.dt {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
  margin-top: 0.875rem;
}

.dt th {
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--nl-text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--nl-border);
  white-space: nowrap;
}

.dt td {
  padding: 0.75rem 0.75rem;
  border-bottom: 1px solid var(--nl-border);
  color: var(--nl-text-2);
  vertical-align: middle;
}

.dt tr:last-child td { border-bottom: none; }
.dt tr:hover td { background: var(--nl-surface-2); }
.dt-name  { font-weight: 600; color: var(--nl-text-1); }
.dt-muted { color: var(--nl-text-3); font-size: 0.75rem; }

.urgency {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.5rem;
  border-radius: 20px;
  font-size: 0.7rem;
  font-weight: 600;
}

.urgency--overdue  { background: #FEE2E2; color: #DC2626; }
.urgency--critical { background: #FEF3C7; color: #B45309; }
.urgency--warn     { background: #ECFDF5; color: #15803D; }

/* Responsive */
@media (max-width: 860px) { .mid-grid { grid-template-columns: 1fr; } }
@media (max-width: 600px) { .kpi-strip { flex-direction: column; } .kpi-divider { width: 100%; height: 1px; margin: 0 1rem; } }
</style>
