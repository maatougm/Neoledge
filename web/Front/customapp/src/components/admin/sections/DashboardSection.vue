<!--
  @file     DashboardSection.vue
  @desc     Admin command-center dashboard — KPI cards, projects dashboard, deadline radar
-->
<template>
  <div class="dash">
    <!-- ── Page heading ─────────────────────────────────────────────────────── -->
    <div class="dash-heading">
      <div>
        <h1 class="dash-title">Tableau de bord</h1>
        <p class="dash-date">{{ todayLabel }}</p>
      </div>
      <RouterLink :to="{ name: 'admin-projects' }" class="view-all-btn">
        Voir tous les projets <i class="pi pi-arrow-right" />
      </RouterLink>
    </div>

    <!-- ── KPI cards ─────────────────────────────────────────────────────────── -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--blue"><i class="pi pi-briefcase" /></div>
        <div class="kpi-info">
          <span class="kpi-num">{{ activeCount }}</span>
          <span class="kpi-lbl">Projets actifs</span>
        </div>
        <span class="kpi-badge kpi-badge--blue">{{ projectStore.projects.length }} total</span>
      </div>

      <div class="kpi-card" :class="{ 'kpi-card--alert': overdueCount > 0 }">
        <div class="kpi-icon" :class="overdueCount > 0 ? 'kpi-icon--danger' : 'kpi-icon--green'">
          <i :class="overdueCount > 0 ? 'pi pi-exclamation-triangle' : 'pi pi-check-circle'" />
        </div>
        <div class="kpi-info">
          <span class="kpi-num" :class="overdueCount > 0 ? 'text-danger' : ''">{{ overdueCount }}</span>
          <span class="kpi-lbl">En retard</span>
        </div>
        <span class="kpi-badge" :class="overdueCount > 0 ? 'kpi-badge--danger' : 'kpi-badge--green'">
          {{ overdueCount > 0 ? 'action requise' : 'tout à jour' }}
        </span>
      </div>

      <div class="kpi-card" :class="{ 'kpi-card--warn': pendingValidationCount > 0 }">
        <div class="kpi-icon" :class="pendingValidationCount > 0 ? 'kpi-icon--warn' : 'kpi-icon--neutral'">
          <i class="pi pi-shield" />
        </div>
        <div class="kpi-info">
          <span class="kpi-num" :class="pendingValidationCount > 0 ? 'text-warning' : ''">{{ pendingValidationCount }}</span>
          <span class="kpi-lbl">Validations en attente</span>
        </div>
        <span class="kpi-badge" :class="pendingValidationCount > 0 ? 'kpi-badge--warn' : 'kpi-badge--neutral'">
          {{ pendingValidationCount > 0 ? 'à valider' : 'aucune' }}
        </span>
      </div>

      <div class="kpi-card">
        <div class="kpi-icon kpi-icon--purple"><i class="pi pi-users" /></div>
        <div class="kpi-info">
          <span class="kpi-num">{{ userStore.users.length }}</span>
          <span class="kpi-lbl">Utilisateurs actifs</span>
        </div>
        <span class="kpi-badge kpi-badge--neutral">membres</span>
      </div>
    </div>

    <!-- ── Projects dashboard ────────────────────────────────────────────────── -->
    <div class="section-card">
      <div class="section-header pd-header">
        <h2 class="section-title">Tableau de bord des projets</h2>
        <div class="pd-filters">
          <button
            v-for="f in PROJECT_FILTERS"
            :key="f.id"
            type="button"
            class="pd-filter"
            :class="{ 'pd-filter--active': activeFilter === f.id }"
            @click="activeFilter = f.id"
          >
            {{ f.label }}
            <span class="pd-filter__count">{{ filterCount(f.id) }}</span>
          </button>
        </div>
      </div>

      <div v-if="filteredProjects.length === 0" class="pd-empty">
        <i class="pi pi-inbox pd-empty__icon" />
        <span>Aucun projet ne correspond à ce filtre.</span>
      </div>

      <div v-else class="pd-table-wrap">
        <table class="pd-table">
          <thead>
            <tr>
              <th>Projet</th>
              <th>Statut</th>
              <th>Chef de projet</th>
              <th class="pd-progress-col">Avancement</th>
              <th class="pd-due-col">Échéance</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in filteredProjects"
              :key="p.id"
              class="pd-row"
              @click="navigateToProject(p.id)"
            >
              <td class="pd-name-cell">
                <div class="pd-name">{{ p.name }}</div>
                <div class="pd-client">{{ p.clientName }}</div>
              </td>
              <td>
                <NeoTag
                  :value="PROJECT_STATUS_LABELS[p.status] ?? p.status"
                  :severity="statusSeverity(p.status)"
                />
              </td>
              <td class="pd-pm-cell">{{ p.projectManagerName ?? '—' }}</td>
              <td class="pd-progress-cell">
                <div class="pd-progress-bar">
                  <div
                    class="pd-progress-fill"
                    :class="progressFillClass(p)"
                    :style="{ width: `${getProgress(p)}%` }"
                  />
                </div>
                <span class="pd-progress-pct">{{ getProgress(p) }}%</span>
              </td>
              <td class="pd-due-cell">
                <span v-if="p.endDate" class="pd-due" :class="dueClass(p.endDate, p.status)">
                  {{ formatDate(p.endDate) }}
                </span>
                <span v-else class="pd-due pd-due--none">—</span>
              </td>
              <td class="pd-arrow-cell"><i class="pi pi-chevron-right" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Bottom grid: deadlines + health ──────────────────────────────────── -->
    <div class="bottom-grid">
      <!-- Deadline radar -->
      <div class="section-card deadline-card">
        <div class="section-header">
          <h2 class="section-title">
            <i class="pi pi-clock" style="color: var(--nl-warning)" />
            Échéances à venir
          </h2>
          <NeoTag
            v-if="upcomingDeadlines.length"
            :value="String(upcomingDeadlines.length)"
            severity="warn"
          />
        </div>

        <div v-if="upcomingDeadlines.length === 0" class="empty-state">
          <i class="pi pi-check-circle empty-icon" />
          <span>Aucune échéance dans les 14 jours</span>
        </div>

        <div v-else class="deadline-list">
          <div
            v-for="p in upcomingDeadlines"
            :key="p.id"
            class="deadline-row"
            @click="navigateToProject(p.id)"
          >
            <div class="urgency-bar" :class="urgencyClass(p.endDate)" />
            <div class="deadline-info">
              <span class="deadline-name">{{ p.name }}</span>
              <span class="deadline-meta">{{ p.clientName }} · {{ p.projectManagerName ?? 'Sans chef de projet' }}</span>
            </div>
            <div class="deadline-right">
              <span class="deadline-badge" :class="urgencyClass(p.endDate)">{{ urgencyLabel(p.endDate) }}</span>
              <span class="deadline-date">{{ formatDate(p.endDate) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Project health summary -->
      <div class="section-card health-card">
        <div class="section-header">
          <h2 class="section-title">Santé du portefeuille</h2>
        </div>

        <div class="health-ring-area">
          <svg class="ring-svg" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="ring-bg" cx="50" cy="50" r="38" />
            <circle
              class="ring-prog"
              cx="50" cy="50" r="38"
              :stroke-dasharray="`${(completionPct / 100) * 238.8} 238.8`"
            />
          </svg>
          <div class="ring-center">
            <span class="ring-pct">{{ completionPct }}%</span>
            <span class="ring-sub">terminés</span>
          </div>
        </div>

        <div class="health-stats">
          <div v-for="s in HEALTH_STATS" :key="s.label" class="health-stat">
            <span class="health-stat__dot" :style="{ background: s.color }" />
            <span class="health-stat__label">{{ s.label }}</span>
            <span class="health-stat__val">{{ s.count }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { NeoTag } from '@neolibrary/components'
import { useProjectStore } from '@/stores/projectStore'
import { useUserStore } from '@/stores/userStore'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus, ProjectSummary } from '@/types/project.types'

const projectStore = useProjectStore()
const userStore    = useUserStore()
const router       = useRouter()

onMounted(() => {
  if (projectStore.projects.length === 0) projectStore.fetchAll()
  if (userStore.users.length === 0) userStore.fetchAll()
})

// ── Projects dashboard config ─────────────────────────────────────────────────
type FilterId = 'all' | 'active' | 'overdue' | 'pending' | 'completed'
const PROJECT_FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all',       label: 'Tous'        },
  { id: 'active',    label: 'Actifs'      },
  { id: 'overdue',   label: 'En retard'   },
  { id: 'pending',   label: 'En validation' },
  { id: 'completed', label: 'Terminés'    },
]
const activeFilter = ref<FilterId>('all')

// ── KPI computeds ─────────────────────────────────────────────────────────────
const TERMINAL_STATUSES: ProjectStatus[] = ['Cloture', 'Archived']

const activeCount = computed(() =>
  projectStore.projects.filter(p => !TERMINAL_STATUSES.includes(p.status)).length
)

const overdueCount = computed(() => {
  const now = Date.now()
  return projectStore.projects.filter(p => {
    if (!p.endDate || TERMINAL_STATUSES.includes(p.status)) return false
    return new Date(p.endDate).getTime() < now
  }).length
})

const pendingValidationCount = computed(() =>
  projectStore.projects.filter(
    p => p.status === 'Parametrage' || p.status === 'MEP'
  ).length
)

const completedCount = computed(() =>
  projectStore.projects.filter(p => p.status === 'Cloture').length
)

// ── Projects dashboard helpers ────────────────────────────────────────────────
function matchesFilter(p: ProjectSummary, f: FilterId): boolean {
  const isTerminal = TERMINAL_STATUSES.includes(p.status)
  const isOverdue = !!p.endDate && !isTerminal && new Date(p.endDate).getTime() < Date.now()
  switch (f) {
    case 'all':       return true
    case 'active':    return !isTerminal
    case 'overdue':   return isOverdue
    case 'pending':   return p.status === 'Parametrage' || p.status === 'MEP'
    case 'completed': return p.status === 'Cloture'
  }
}

const filterCount = (f: FilterId): number =>
  projectStore.projects.filter((p) => matchesFilter(p, f)).length

const filteredProjects = computed<ProjectSummary[]>(() => {
  const list = projectStore.projects.filter((p) => matchesFilter(p, activeFilter.value))
  // Active first, then by due-date ascending (most urgent first), then by name
  return list.slice().sort((a, b) => {
    const aTerm = TERMINAL_STATUSES.includes(a.status) ? 1 : 0
    const bTerm = TERMINAL_STATUSES.includes(b.status) ? 1 : 0
    if (aTerm !== bTerm) return aTerm - bTerm
    const aMs = a.endDate ? new Date(a.endDate).getTime() : Number.POSITIVE_INFINITY
    const bMs = b.endDate ? new Date(b.endDate).getTime() : Number.POSITIVE_INFINITY
    if (aMs !== bMs) return aMs - bMs
    return a.name.localeCompare(b.name)
  })
})

function getProgress(p: ProjectSummary): number {
  // Backend supplies progressPct when work-package counts are available.
  // Fall back to a status-based heuristic for legacy / empty projects.
  if (typeof p.progressPct === 'number') return p.progressPct
  const map: Record<ProjectStatus, number> = {
    Draft: 0, Kickoff: 5, CadrageTechnique: 15, Environnement: 25,
    Parametrage: 50, Integration: 65, Recette: 80, MEP: 95,
    Cloture: 100, Archived: 100,
  }
  return map[p.status] ?? 0
}

function progressFillClass(p: ProjectSummary): string {
  if (TERMINAL_STATUSES.includes(p.status)) return 'pd-progress-fill--done'
  if (p.endDate && new Date(p.endDate).getTime() < Date.now()) return 'pd-progress-fill--late'
  const pct = getProgress(p)
  if (pct < 30) return 'pd-progress-fill--early'
  if (pct < 70) return 'pd-progress-fill--mid'
  return 'pd-progress-fill--almost'
}

function dueClass(iso: string, status: ProjectStatus): string {
  if (TERMINAL_STATUSES.includes(status)) return 'pd-due--done'
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0)              return 'pd-due--overdue'
  if (ms < 7  * 86_400_000) return 'pd-due--critical'
  if (ms < 14 * 86_400_000) return 'pd-due--warn'
  return 'pd-due--ok'
}

// ── Completion ─────────────────────────────────────────────────────────────────
const completionPct = computed(() => {
  const total = projectStore.projects.length
  return total === 0 ? 0 : Math.round((completedCount.value / total) * 100)
})

// ── Health stats ──────────────────────────────────────────────────────────────
const HEALTH_STATS = computed(() => [
  { label: 'En cours',        count: projectStore.projects.filter(p => !TERMINAL_STATUSES.includes(p.status) && p.status !== 'Draft').length, color: '#3b82f6' },
  { label: 'En validation',   count: pendingValidationCount.value,                                        color: '#f59e0b' },
  { label: 'En retard',       count: overdueCount.value,                                                  color: '#e11d48' },
  { label: 'Terminés',        count: completedCount.value,                                                color: '#10b981' },
])

// ── Deadline helpers ───────────────────────────────────────────────────────────
const upcomingDeadlines = computed(() => {
  const now    = Date.now()
  const cutoff = now + 14 * 24 * 60 * 60 * 1000
  return projectStore.projects
    .filter(p => {
      if (!p.endDate || TERMINAL_STATUSES.includes(p.status)) return false
      return new Date(p.endDate).getTime() < cutoff
    })
    .slice()
    .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
})

function urgencyClass(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0)               return 'urgency--overdue'
  if (ms < 7 * 86_400_000) return 'urgency--critical'
  return 'urgency--warn'
}

function urgencyLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0) return 'En retard'
  return `${Math.ceil(ms / 86_400_000)} j`
}

function navigateToProject(id: string): void {
  router.push({ name: 'admin-project-detail', params: { id } })
}

const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—'

const todayLabel = computed(() =>
  new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
)
</script>

<style scoped>
.dash {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  font-family: var(--nl-font);
  max-width: 100%;
  min-width: 0;
  overflow-x: hidden;
}
.dash > * { min-width: 0; }

/* ── Heading ─────────────────────────────────────────────────────────────────── */
.dash-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.dash-title {
  font-size: 1.375rem;
  font-weight: 800;
  color: var(--nl-text-1);
  letter-spacing: -0.3px;
  margin: 0;
}

.dash-date {
  font-size: 0.8125rem;
  color: var(--nl-text-3);
  margin: 0.2rem 0 0;
  text-transform: capitalize;
}

.view-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.4rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--nl-border);
  background: var(--nl-surface);
  color: var(--nl-text-2);
  font-size: 0.8125rem;
  font-weight: 500;
  text-decoration: none;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  white-space: nowrap;
}

.view-all-btn:hover {
  border-color: var(--nl-accent);
  color: var(--nl-accent);
}

/* ── KPI grid ────────────────────────────────────────────────────────────────── */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

.kpi-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 12px;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  transition: box-shadow 0.15s;
}

.kpi-card:hover { box-shadow: var(--nl-shadow); }

.kpi-card--alert { border-color: rgba(225, 29, 72, 0.3); background: rgba(225, 29, 72, 0.03); }
.kpi-card--warn  { border-color: rgba(217, 119, 6, 0.3); background: rgba(217, 119, 6, 0.03); }

:global(.dark) .kpi-card--alert { background: rgba(225, 29, 72, 0.06); }
:global(.dark) .kpi-card--warn  { background: rgba(217, 119, 6, 0.06); }

.kpi-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.kpi-icon--blue    { background: rgba(59,130,246,0.12);  color: #3b82f6; }
.kpi-icon--green   { background: rgba(16,185,129,0.12);  color: #10b981; }
.kpi-icon--danger  { background: rgba(225,29,72,0.12);   color: var(--nl-danger); }
.kpi-icon--warn    { background: rgba(217,119,6,0.12);   color: var(--nl-warning); }
.kpi-icon--purple  { background: rgba(99,102,241,0.12);  color: #6366f1; }
.kpi-icon--neutral { background: var(--nl-surface-2);    color: var(--nl-text-3); }

.kpi-info {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin-top: 0.25rem;
}

.kpi-num {
  font-size: 2rem;
  font-weight: 800;
  color: var(--nl-text-1);
  letter-spacing: -1px;
  line-height: 1;
}

.kpi-lbl {
  font-size: 0.75rem;
  color: var(--nl-text-3);
  font-weight: 500;
}

.text-danger  { color: var(--nl-danger) !important; }
.text-warning { color: var(--nl-warning) !important; }

.kpi-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border-radius: 20px;
  font-size: 0.65rem;
  font-weight: 600;
  width: fit-content;
}

.kpi-badge--blue    { background: rgba(59,130,246,0.1);  color: #3b82f6; }
.kpi-badge--green   { background: rgba(16,185,129,0.12); color: #059669; }
.kpi-badge--danger  { background: #FEE2E2; color: #DC2626; }
.kpi-badge--warn    { background: #FEF3C7; color: #B45309; }
.kpi-badge--purple  { background: rgba(99,102,241,0.1);  color: #6366f1; }
.kpi-badge--neutral { background: var(--nl-border); color: var(--nl-text-3); }

:global(.dark) .kpi-badge--green  { background: rgba(5,150,105,0.18);  color: #34d399; }
:global(.dark) .kpi-badge--danger { background: rgba(220,38,38,0.18);  color: #fb7185; }
:global(.dark) .kpi-badge--warn   { background: rgba(217,119,6,0.18);  color: #fcd34d; }

/* ── Section card ────────────────────────────────────────────────────────────── */
.section-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 16px;
  padding: 1.25rem 1.5rem;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
}

/* ── Completion pill ─────────────────────────────────────────────────────────── */
/* ── Projects dashboard (replaces the old pipeline funnel) ──────────────────── */
.pd-header {
  flex-wrap: wrap;
  gap: 0.75rem;
}
.pd-filters {
  display: flex;
  gap: 0.375rem;
  flex-wrap: wrap;
}
.pd-filter {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--nl-border);
  background: var(--nl-surface);
  color: var(--nl-text-2);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.pd-filter:hover { border-color: var(--nl-accent); color: var(--nl-accent); }
.pd-filter--active {
  background: var(--nl-accent);
  border-color: var(--nl-accent);
  color: #fff;
}
.pd-filter__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.08);
  font-size: 0.6875rem;
  font-weight: 700;
}
.pd-filter--active .pd-filter__count { background: rgba(255, 255, 255, 0.25); }

.pd-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--nl-text-3);
  font-size: 0.875rem;
}
.pd-empty__icon { font-size: 2rem; opacity: 0.5; }

.pd-table-wrap {
  width: 100%;
  overflow-x: auto;
}
.pd-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.875rem;
  table-layout: fixed;
}
.pd-table th {
  text-align: left;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--nl-text-3);
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--nl-border);
  background: var(--nl-surface-2);
}
.pd-table td {
  padding: 0.625rem 0.75rem;
  border-bottom: 1px solid var(--nl-border);
  vertical-align: middle;
}
.pd-table .pd-progress-col { width: 200px; }
.pd-table .pd-due-col      { width: 110px; }

.pd-row {
  cursor: pointer;
  transition: background 0.12s;
}
.pd-row:hover td { background: var(--nl-surface-2); }

.pd-name-cell { min-width: 0; }
.pd-name {
  font-weight: 600;
  color: var(--nl-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pd-client {
  font-size: 0.75rem;
  color: var(--nl-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pd-pm-cell {
  color: var(--nl-text-2);
  font-size: 0.8125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pd-progress-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.pd-progress-bar {
  flex: 1;
  height: 6px;
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: 999px;
  overflow: hidden;
}
.pd-progress-fill {
  height: 100%;
  border-radius: inherit;
  transition: width 0.4s ease;
}
.pd-progress-fill--early   { background: #94a3b8; }
.pd-progress-fill--mid     { background: #3b82f6; }
.pd-progress-fill--almost  { background: #14b8a6; }
.pd-progress-fill--done    { background: #10b981; }
.pd-progress-fill--late    { background: #ef4444; }

.pd-progress-pct {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--nl-text-2);
  min-width: 36px;
  text-align: right;
}

.pd-due {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}
.pd-due--ok       { background: var(--nl-surface-2); color: var(--nl-text-2); }
.pd-due--warn     { background: #fef3c7; color: #b45309; }
.pd-due--critical { background: #fed7aa; color: #c2410c; }
.pd-due--overdue  { background: #fee2e2; color: #b91c1c; }
.pd-due--done     { background: #dcfce7; color: #047857; }
.pd-due--none     { color: var(--nl-text-3); font-weight: 500; }

.pd-arrow-cell {
  width: 24px;
  color: var(--nl-text-3);
  text-align: right;
}
.pd-row:hover .pd-arrow-cell { color: var(--nl-accent); }

/* ── Bottom grid ─────────────────────────────────────────────────────────────── */
.bottom-grid {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 1rem;
}

@media (max-width: 1280px) {
  .bottom-grid {
    grid-template-columns: 1fr;
  }
}

/* ── Deadline list ───────────────────────────────────────────────────────────── */
.empty-state {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 1.5rem 0;
  font-size: 0.875rem;
  color: var(--nl-text-3);
  justify-content: center;
}

.empty-icon { font-size: 1.25rem; color: var(--nl-success); }

.deadline-list {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.deadline-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.5rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
}

.deadline-row:hover { background: var(--nl-surface-2); }

.urgency-bar {
  width: 3px;
  height: 36px;
  border-radius: 2px;
  flex-shrink: 0;
}

.urgency-bar.urgency--overdue  { background: var(--nl-danger); }
.urgency-bar.urgency--critical { background: var(--nl-warning); }
.urgency-bar.urgency--warn     { background: var(--nl-success); }

.deadline-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.deadline-name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--nl-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deadline-meta {
  font-size: 0.7rem;
  color: var(--nl-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deadline-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
  flex-shrink: 0;
}

.deadline-badge {
  padding: 0.15rem 0.45rem;
  border-radius: 10px;
  font-size: 0.625rem;
  font-weight: 700;
  white-space: nowrap;
}

.urgency--overdue  { background: #FEE2E2; color: #DC2626; }
.urgency--critical { background: #FEF3C7; color: #B45309; }
.urgency--warn     { background: #ECFDF5; color: #15803D; }

:global(.dark) .urgency--overdue  { background: rgba(220,38,38,0.2);  color: #fb7185; }
:global(.dark) .urgency--critical { background: rgba(217,119,6,0.2);  color: #fcd34d; }
:global(.dark) .urgency--warn     { background: rgba(5,150,105,0.2);  color: #34d399; }

.deadline-date {
  font-size: 0.625rem;
  color: var(--nl-text-3);
}

/* ── Health ring ─────────────────────────────────────────────────────────────── */
.health-card {
  display: flex;
  flex-direction: column;
}

.health-ring-area {
  position: relative;
  width: 120px;
  height: 120px;
  margin: 0 auto 1rem;
}

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
  stroke-linecap: round;
  stroke-dasharray: 0 238.8;
  transition: stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1);
}

.ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.ring-pct { font-size: 1.5rem; font-weight: 800; color: var(--nl-text-1); line-height: 1; }
.ring-sub { font-size: 0.625rem; color: var(--nl-text-3); margin-top: 0.125rem; }

.health-stats {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.health-stat {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.health-stat__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.health-stat__label {
  flex: 1;
  font-size: 0.75rem;
  color: var(--nl-text-2);
}

.health-stat__val {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--nl-text-1);
}

/* ── Responsive ──────────────────────────────────────────────────────────────── */
@media (max-width: 860px) {
  .kpi-grid   { grid-template-columns: repeat(2, 1fr); }
  .bottom-grid { grid-template-columns: 1fr; }
  /* Compact the projects dashboard table on narrow screens */
  .pd-table .pd-progress-col,
  .pd-progress-cell { display: none; }
  .pd-table .pd-due-col      { width: 90px; }
}

@media (max-width: 600px) {
  .kpi-grid { grid-template-columns: 1fr; }
  /* On phones, hide the PM column too — name + status + due is enough. */
  .pd-pm-cell,
  .pd-table th:nth-child(3) { display: none; }
}
</style>
