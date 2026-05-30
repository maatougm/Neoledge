<!--
  @file     DashboardSection.vue
  @desc     Admin command-center dashboard — KPIs + analytical charts.
            The full project list lives at /app/admin/projects; this
            page is for at-a-glance insight, not row-by-row management.
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

    <!-- ── Charts row: status donut + PM workload ────────────────────────────── -->
    <div class="charts-grid">
      <!-- Status distribution donut -->
      <div class="section-card chart-card">
        <div class="section-header">
          <h2 class="section-title">Répartition par statut</h2>
          <span class="chart-meta">{{ projectStore.projects.length }} projets</span>
        </div>
        <div v-if="statusChartData.labels.length === 0" class="chart-empty">
          <i class="pi pi-chart-pie" />
          <span>Aucun projet à afficher.</span>
        </div>
        <div v-else class="donut-wrap">
          <Doughnut :data="statusChartData" :options="donutOptions" />
        </div>
      </div>

      <!-- PM workload stacked bars -->
      <div class="section-card chart-card">
        <div class="section-header">
          <h2 class="section-title">Charge par chef de projet</h2>
          <span class="chart-meta">{{ workloads.length }} CPs</span>
        </div>
        <div v-if="workloads.length === 0" class="chart-empty">
          <i class="pi pi-users" />
          <span>Aucun chef de projet actif.</span>
        </div>
        <div v-else class="bar-wrap">
          <Bar :data="workloadChartData" :options="barOptions" />
        </div>
      </div>
    </div>

    <!-- ── Bottom row: deadlines + activity ──────────────────────────────────── -->
    <div class="bottom-grid">
      <!-- Deadline radar -->
      <div class="section-card deadline-card">
        <div class="section-header">
          <h2 class="section-title">
            <i class="pi pi-clock" style="color: var(--nl-warning)" />
            Échéances à venir (14 j)
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

      <!-- Recent cross-project activity -->
      <div class="section-card activity-card">
        <div class="section-header">
          <h2 class="section-title">
            <i class="pi pi-history" style="color: var(--nl-accent)" />
            Activité récente
          </h2>
          <RouterLink :to="{ name: 'admin-audit' }" class="chart-link">
            Tout voir <i class="pi pi-arrow-right" />
          </RouterLink>
        </div>

        <div v-if="activityLoading" class="empty-state">
          <i class="pi pi-spin pi-spinner empty-icon" />
          <span>Chargement…</span>
        </div>
        <div v-else-if="recentActivity.length === 0" class="empty-state">
          <i class="pi pi-inbox empty-icon" />
          <span>Aucune activité récente.</span>
        </div>
        <ul v-else class="activity-list">
          <li
            v-for="a in recentActivity"
            :key="a.id"
            class="activity-row"
            :class="{ 'activity-row--clickable': !!a.projectId }"
            @click="a.projectId && navigateToProject(a.projectId)"
          >
            <i class="pi activity-icon" :class="actionIcon(a.action)" />
            <div class="activity-body">
              <div class="activity-text">
                <strong>{{ a.userName ?? 'Système' }}</strong>
                {{ actionLabel(a.action) }}
                <span v-if="a.projectName" class="activity-project">« {{ a.projectName }} »</span>
              </div>
              <div class="activity-meta">{{ relTime(a.timestamp) }}</div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { NeoTag } from '@neolibrary/components'
import { Bar, Doughnut } from 'vue-chartjs'
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Legend, Tooltip,
} from 'chart.js'
import type { TooltipItem } from 'chart.js'
import { useProjectStore } from '@/stores/projectStore'
import { useUserStore } from '@/stores/userStore'
import { PROJECT_STATUS_LABELS } from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'
import api from '@/lib/api'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Legend, Tooltip)

const projectStore = useProjectStore()
const userStore    = useUserStore()
const router       = useRouter()

// ── KPIs ─────────────────────────────────────────────────────────────────
const TERMINAL_STATUSES: ProjectStatus[] = ['Cloture', 'Archived']

const activeCount = computed(() =>
  projectStore.projects.filter(p => !TERMINAL_STATUSES.includes(p.status)).length,
)
const overdueCount = computed(() => {
  const now = Date.now()
  return projectStore.projects.filter(p => {
    if (!p.endDate || TERMINAL_STATUSES.includes(p.status)) return false
    return new Date(p.endDate).getTime() < now
  }).length
})
const pendingValidationCount = computed(() =>
  projectStore.projects.filter(p => p.status === 'Parametrage' || p.status === 'MEP').length,
)

// ── Status colours — keep aligned with the table chips elsewhere. ─────────
const STATUS_COLORS: Record<ProjectStatus, string> = {
  Draft:            '#94a3b8',
  Kickoff:          '#93c5fd',
  CadrageTechnique: '#3b82f6',
  Environnement:    '#1d4ed8',
  Parametrage:      '#fbbf24',
  Integration:      '#d97706',
  Recette:          '#f97316',
  MEP:              '#10b981',
  Cloture:          '#0d9488',
  Archived:         '#cbd5e1',
}

// ── Status donut data ────────────────────────────────────────────────────
const statusChartData = computed(() => {
  const counts: Record<string, number> = {}
  for (const p of projectStore.projects) counts[p.status] = (counts[p.status] ?? 0) + 1
  const orderedStatuses = (Object.keys(STATUS_COLORS) as ProjectStatus[])
    .filter((s) => (counts[s] ?? 0) > 0)
  return {
    labels: orderedStatuses.map((s) => PROJECT_STATUS_LABELS[s] ?? s),
    datasets: [{
      data: orderedStatuses.map((s) => counts[s]),
      backgroundColor: orderedStatuses.map((s) => STATUS_COLORS[s]),
      borderColor: '#fff',
      borderWidth: 2,
      hoverOffset: 6,
    }],
  }
})
const donutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: {
    legend: {
      position: 'right' as const,
      labels: { boxWidth: 12, padding: 10, font: { size: 12 } },
    },
    tooltip: {
      callbacks: {
        label: (ctx: TooltipItem<'doughnut'>) => {
          // Cast to number — datasets here only ever contain numeric counts.
          const data = ctx.chart.data.datasets[0].data as number[]
          const total = data.reduce((a, b) => a + (b ?? 0), 0)
          const v = (ctx.parsed as unknown as number) ?? 0
          const pct = total ? Math.round((v / total) * 100) : 0
          return `${ctx.label}: ${v} (${pct}%)`
        },
      },
    },
  },
}

// ── PM workload — fetched from /api/dashboard/pm-workloads ─────────────────
interface Workload {
  managerName: string
  inProgressProjects: number
  completedProjects: number
  overdueProjects: number
  totalProjects: number
}
const workloads = ref<Workload[]>([])

const workloadChartData = computed(() => ({
  labels: workloads.value.map((w) => w.managerName),
  datasets: [
    { label: 'En cours',  data: workloads.value.map((w) => w.inProgressProjects), backgroundColor: '#3b82f6', stack: 'wp', borderRadius: 4 },
    { label: 'En retard', data: workloads.value.map((w) => w.overdueProjects),    backgroundColor: '#e11d48', stack: 'wp', borderRadius: 4 },
    { label: 'Terminés',  data: workloads.value.map((w) => w.completedProjects),  backgroundColor: '#10b981', stack: 'wp', borderRadius: 4 },
  ],
}))
const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y' as const,
  scales: {
    x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
    y: { stacked: true, ticks: { font: { size: 12 } } },
  },
  plugins: {
    legend: { position: 'top' as const, labels: { boxWidth: 12, padding: 10, font: { size: 12 } } },
    tooltip: { mode: 'index' as const, intersect: false },
  },
}

// ── Recent activity ────────────────────────────────────────────────────────
interface Activity {
  id: string
  action: string
  detail: string | null
  timestamp: string
  userName: string | null
  projectId: string | null
  projectName: string | null
}
const recentActivity = ref<Activity[]>([])
const activityLoading = ref(true)

const ACTION_LABELS: Record<string, string> = {
  create: 'a créé', created: 'a créé',
  update: 'a modifié', updated: 'a modifié',
  delete: 'a supprimé', deleted: 'a supprimé',
  status_change: 'a changé le statut de',
  assign: 'a assigné',
  validate: 'a validé',
  cahier_generated: 'a généré le cahier de',
  cahier_edited: 'a modifié le cahier de',
}
function actionLabel(a: string): string {
  const lower = (a || '').toLowerCase()
  for (const [k, v] of Object.entries(ACTION_LABELS)) {
    if (lower.includes(k)) return v
  }
  return 'a agi sur'
}
function actionIcon(a: string): string {
  const lower = (a || '').toLowerCase()
  if (lower.includes('creat'))  return 'pi-plus-circle'
  if (lower.includes('updat'))  return 'pi-pencil'
  if (lower.includes('delet'))  return 'pi-trash'
  if (lower.includes('valid'))  return 'pi-check-circle'
  if (lower.includes('cahier')) return 'pi-file-word'
  if (lower.includes('status')) return 'pi-flag'
  return 'pi-info-circle'
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'à l\'instant'
  if (ms < 3_600_000)   return `il y a ${Math.floor(ms / 60_000)} min`
  if (ms < 86_400_000)  return `il y a ${Math.floor(ms / 3_600_000)} h`
  return `il y a ${Math.floor(ms / 86_400_000)} j`
}

async function loadDashboardData(): Promise<void> {
  // Pull workloads + recent activity in parallel.
  const [wlRes, actRes] = await Promise.allSettled([
    api.get<Workload[]>('/api/dashboard/pm-workloads'),
    api.get<Activity[]>('/api/dashboard/recent-activity?count=10'),
  ])
  if (wlRes.status === 'fulfilled' && Array.isArray(wlRes.value.data)) {
    workloads.value = wlRes.value.data
      .filter((w) => w.totalProjects > 0)
      .sort((a, b) => b.totalProjects - a.totalProjects)
  }
  if (actRes.status === 'fulfilled' && Array.isArray(actRes.value.data)) {
    recentActivity.value = actRes.value.data
  }
  activityLoading.value = false
}

onMounted(() => {
  if (projectStore.projects.length === 0) projectStore.fetchAll()
  if (userStore.users.length === 0) userStore.fetchAll()
  void loadDashboardData()
})

// ── Deadline radar ─────────────────────────────────────────────────────────
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

const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—'

const todayLabel = computed(() =>
  new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
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
  padding: 1.5rem;
}

/* ── Heading ─────────────────────────────────────────────────────────────── */
.dash-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.dash-title { font-size: 1.5rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.dash-date  { font-size: 0.875rem; color: var(--nl-text-3); margin: 0.25rem 0 0; text-transform: capitalize; }
.view-all-btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.5rem 0.875rem;
  border-radius: 8px;
  background: var(--nl-accent);
  color: #fff; font-size: 0.8125rem; font-weight: 600;
  text-decoration: none;
  transition: background 0.15s;
}
.view-all-btn:hover { background: var(--nl-accent-strong, #0d4f5e); }

/* ── KPI cards ───────────────────────────────────────────────────────────── */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}
.kpi-card {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1rem 1.25rem;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 10px;
  transition: box-shadow 0.15s;
}
.kpi-card:hover { box-shadow: var(--nl-shadow-md, 0 2px 8px rgba(0,0,0,0.05)); }
.kpi-card--alert { border-color: color-mix(in srgb, var(--nl-danger) 30%, transparent); background: var(--nl-danger-light); }
.kpi-card--warn  { border-color: color-mix(in srgb, var(--nl-warning) 30%, transparent); background: var(--nl-warning-light); }

.kpi-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 10px;
  font-size: 1rem; flex-shrink: 0;
}
.kpi-icon--blue    { background: var(--nl-info-light); color: var(--nl-info); }
.kpi-icon--green   { background: var(--nl-success-light); color: var(--nl-success); }
.kpi-icon--danger  { background: var(--nl-danger-light); color: var(--nl-danger); }
.kpi-icon--warn    { background: var(--nl-warning-light); color: var(--nl-warning); }
.kpi-icon--purple  { background: #ede9fe; color: #6d28d9; }
.kpi-icon--neutral { background: var(--nl-surface-2); color: var(--nl-text-3); }
:global(.dark) .kpi-icon--purple { background: rgba(124,58,237,0.18); color: #c4b5fd; }

.kpi-info { display: flex; flex-direction: column; gap: 0.1rem; flex: 1; min-width: 0; }
.kpi-num  { font-size: 1.4rem; font-weight: 800; color: var(--nl-text-1); line-height: 1; }
.kpi-num.text-danger  { color: var(--nl-danger); }
.kpi-num.text-warning { color: var(--nl-warning); }
.kpi-lbl  { font-size: 0.75rem; color: var(--nl-text-3); }

.kpi-badge {
  font-size: 0.6875rem; font-weight: 600;
  padding: 0.2rem 0.5rem; border-radius: 999px;
  white-space: nowrap;
}
.kpi-badge--blue    { background: var(--nl-info-light); color: var(--nl-info); }
.kpi-badge--green   { background: var(--nl-success-light); color: var(--nl-success); }
.kpi-badge--danger  { background: var(--nl-danger-light); color: var(--nl-danger); }
.kpi-badge--warn    { background: var(--nl-warning-light); color: var(--nl-warning); }
.kpi-badge--neutral { background: var(--nl-surface-2); color: var(--nl-text-3); }

/* ── Section / chart cards ───────────────────────────────────────────────── */
.section-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 12px;
  padding: 1.25rem;
}
.section-header {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  margin-bottom: 1rem;
}
.section-title {
  display: flex; align-items: center; gap: 0.5rem;
  font-size: 1rem; font-weight: 700; color: var(--nl-text-1); margin: 0;
}

.chart-meta { font-size: 0.75rem; color: var(--nl-text-3); font-weight: 500; }
.chart-link {
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-size: 0.75rem; color: var(--nl-accent); font-weight: 500;
  text-decoration: none;
}
.chart-link:hover { text-decoration: underline; }

.chart-empty {
  display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
  padding: 2.5rem 1rem;
  color: var(--nl-text-3); font-size: 0.875rem;
}
.chart-empty .pi { font-size: 2rem; opacity: 0.5; }

/* ── Charts grid ─────────────────────────────────────────────────────────── */
.charts-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 1rem;
}

.donut-wrap, .bar-wrap {
  position: relative;
  height: 280px;
  width: 100%;
}

/* ── Bottom grid: deadlines + activity ───────────────────────────────────── */
.bottom-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
}

.deadline-list {
  display: flex; flex-direction: column;
  max-height: 360px; overflow-y: auto;
}
.deadline-row {
  display: grid;
  grid-template-columns: 4px 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0;
  border-bottom: 1px solid var(--nl-border);
  cursor: pointer;
  transition: background 0.12s;
}
.deadline-row:hover { background: var(--nl-surface-2); }
.deadline-row:last-child { border-bottom: none; }

.urgency-bar {
  height: 32px; width: 4px; border-radius: 2px;
}
.urgency--overdue  { background: var(--nl-danger); }
.urgency--critical { background: #f97316; }
.urgency--warn     { background: #f59e0b; }

.deadline-info { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.deadline-name { font-size: 0.875rem; font-weight: 600; color: var(--nl-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.deadline-meta { font-size: 0.75rem; color: var(--nl-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.deadline-right { display: flex; flex-direction: column; align-items: flex-end; gap: 0.15rem; }
.deadline-badge {
  font-size: 0.6875rem; font-weight: 700;
  padding: 0.15rem 0.5rem; border-radius: 999px;
}
.deadline-badge.urgency--overdue  { background: var(--nl-danger-light); color: var(--nl-danger); }
.deadline-badge.urgency--critical { background: var(--nl-warning-light); color: var(--nl-warning); }
.deadline-badge.urgency--warn     { background: var(--nl-warning-light); color: var(--nl-warning); }
.deadline-date { font-size: 0.6875rem; color: var(--nl-text-3); }

.empty-state {
  display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
  padding: 2rem 1rem; color: var(--nl-text-3); font-size: 0.875rem;
}
.empty-icon { font-size: 1.75rem; opacity: 0.55; }

/* ── Activity feed ───────────────────────────────────────────────────────── */
.activity-list { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow-y: auto; }
.activity-row {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 0.6rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--nl-border);
}
.activity-row:last-child { border-bottom: none; }
.activity-row--clickable { cursor: pointer; transition: background 0.12s; }
.activity-row--clickable:hover { background: var(--nl-surface-2); }
.activity-icon {
  font-size: 0.875rem; color: var(--nl-text-3); padding-top: 4px;
}
.activity-body { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.activity-text {
  font-size: 0.8125rem; color: var(--nl-text-2); line-height: 1.45;
}
.activity-text strong { color: var(--nl-text-1); font-weight: 600; }
.activity-project { color: var(--nl-text-1); font-weight: 500; }
.activity-meta { font-size: 0.6875rem; color: var(--nl-text-3); }

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 1100px) {
  .charts-grid { grid-template-columns: 1fr; }
  .bottom-grid { grid-template-columns: 1fr; }
}
@media (max-width: 860px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 600px) {
  .kpi-grid { grid-template-columns: 1fr; }
  .donut-wrap, .bar-wrap { height: 240px; }
}
</style>
