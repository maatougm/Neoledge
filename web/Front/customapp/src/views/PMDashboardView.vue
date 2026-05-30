<!-- @file PMDashboardView.vue — dedicated dashboard for the ProjectManager
     role. Shows the PM's project portfolio at a glance: pipeline counts by
     phase, projects I lead, my tasks for today, upcoming milestones, and
     the notification preview. -->
<template>
  <div class="pmd-shell">
    <nav class="pmd-tabs" role="tablist">
      <button type="button" role="tab" class="pmd-tab" :class="{ 'pmd-tab--active': tab === 'overview' }" :aria-selected="tab === 'overview'" @click="setTab('overview')">
        <i class="pi pi-th-large" /> Vue d'ensemble
      </button>
      <button type="button" role="tab" class="pmd-tab" :class="{ 'pmd-tab--active': tab === 'planning' }" :aria-selected="tab === 'planning'" @click="setTab('planning')">
        <i class="pi pi-calendar" /> Planification d'équipe
      </button>
    </nav>

    <div class="pmd-body">
      <div v-show="tab === 'overview'" class="pmd">
    <header class="pmd__head">
      <p class="pmd__eyebrow">Espace chef de projet</p>
      <h1 class="pmd__title">Bonjour {{ firstName }}.</h1>
      <p class="pmd__subtitle">{{ subtitle }}</p>
    </header>

    <!-- Stat row: portfolio pulse -->
    <section class="pmd__stats">
      <StatCard icon="pi-briefcase"        label="Projets actifs"                :value="stats.active"             tone="normal" />
      <StatCard icon="pi-clock"             label="Cahiers en cours de validation" :value="stats.awaitingSpec"      tone="warning" />
      <StatCard icon="pi-check-circle"      label="Cahiers validés"               :value="stats.cahierValidated"   tone="normal" />
    </section>

    <NeoMessage v-if="error" severity="error" :text="error" class="mb-3" />

    <!-- 2-column split -->
    <div class="pmd__grid">
      <!-- Left column -->
      <div class="pmd__col pmd__col--main">
        <!-- My projects card -->
        <section class="nl-card">
          <header class="pmd__card-head">
            <h2><i class="pi pi-briefcase" /> Mes projets</h2>
            <RouterLink class="pmd__link" to="/app/pm/projects">Voir tout</RouterLink>
          </header>
          <div v-if="loadingProjects && projects.length === 0" class="pmd__loading">
            <i class="pi pi-spin pi-spinner" /> Chargement…
          </div>
          <div v-else-if="projects.length === 0" class="pmd__empty">
            <i class="pi pi-briefcase" />
            <p>Aucun projet actif. Demande à un Admin de t'en assigner un.</p>
          </div>
          <ul v-else class="pmd__project-list">
            <li
              v-for="p in projects.slice(0, 6)"
              :key="p.id"
              class="pmd__project"
              @click="openProject(p.id)"
            >
              <div class="pmd__project-body">
                <div class="pmd__project-name">{{ p.name }}</div>
                <div class="pmd__project-meta">
                  <span class="pmd__client">{{ p.clientName ?? '—' }}</span>
                  <NeoTag :value="phaseLabelLocal(p.status)" :severity="phaseSeverity(p.status)" />
                </div>
              </div>
              <i class="pi pi-chevron-right pmd__project-chevron" />
            </li>
          </ul>
        </section>

        <!-- My tasks today -->
        <section class="nl-card">
          <header class="pmd__card-head">
            <h2><i class="pi pi-bolt" /> À faire aujourd'hui</h2>
            <RouterLink class="pmd__link" to="/app/pm/my-tasks">Voir tout</RouterLink>
          </header>
          <div v-if="loadingTasks && myTasks.length === 0" class="pmd__loading">
            <i class="pi pi-spin pi-spinner" /> Chargement…
          </div>
          <div v-else-if="myTasks.length === 0" class="pmd__empty">
            <i class="pi pi-check-circle" />
            <p>Tu es à jour. Aucune tâche urgente.</p>
          </div>
          <ul v-else class="pmd__task-list">
            <li
              v-for="t in myTasks.slice(0, 6)"
              :key="t.id"
              class="pmd__task"
              :class="{ 'pmd__task--overdue': isOverdue(t.dueDate) }"
              @click="openTask(t)"
            >
              <span class="pmd__prio" :class="`pmd__prio--${prioClass(t.priority)}`" />
              <div class="pmd__task-body">
                <div class="pmd__task-title">{{ t.title }}</div>
                <div class="pmd__task-meta">
                  <span v-if="t.project?.name" class="pmd__task-project">{{ t.project.name }}</span>
                  <StatusChip :status="t.status" />
                </div>
              </div>
              <div class="pmd__task-due" :class="{ 'pmd__task-due--danger': isOverdue(t.dueDate) }">
                {{ t.dueDate ? formatDueDate(t.dueDate) : '' }}
              </div>
            </li>
          </ul>
        </section>
      </div>

      <!-- Right column -->
      <div class="pmd__col pmd__col--side">
        <!-- Upcoming milestones -->
        <section class="nl-card">
          <header class="pmd__card-head">
            <h2><i class="pi pi-flag" /> Prochains jalons</h2>
          </header>
          <div v-if="loadingMilestones && milestones.length === 0" class="pmd__empty pmd__empty--mini">
            <p>Chargement…</p>
          </div>
          <div v-else-if="milestones.length === 0" class="pmd__empty pmd__empty--mini">
            <p>Aucun jalon à venir.</p>
          </div>
          <ul v-else class="pmd__mile-list">
            <li
              v-for="m in milestones.slice(0, 5)"
              :key="m.id"
              class="pmd__mile"
              @click="goTo(`/app/pm/projects/${m.projectId}/gantt`)"
            >
              <div class="pmd__mile-date">
                <span class="pmd__mile-day">{{ new Date(m.date).getDate() }}</span>
                <span class="pmd__mile-mon">{{ monthShort(m.date) }}</span>
              </div>
              <div class="pmd__mile-body">
                <div class="pmd__mile-title">{{ m.title }}</div>
                <div class="pmd__mile-proj">{{ m.projectName }}</div>
              </div>
            </li>
          </ul>
        </section>

        <!-- Notifications preview -->
        <section class="nl-card">
          <header class="pmd__card-head">
            <h2><i class="pi pi-bell" /> Notifications</h2>
            <span v-if="unreadCount > 0" class="pmd__badge">{{ unreadCount }}</span>
          </header>
          <div v-if="recentNotifications.length === 0" class="pmd__empty pmd__empty--mini">
            <p>Tout est à jour.</p>
          </div>
          <ul v-else class="pmd__notif-list">
            <li
              v-for="n in recentNotifications"
              :key="n.id"
              class="pmd__notif"
              :class="{ 'pmd__notif--unread': !n.isRead }"
              @click="onNotifClick(n)"
            >
              <span class="pmd__notif-title">{{ n.title }}</span>
              <span class="pmd__notif-msg">{{ n.message }}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
      </div>

      <TeamPlannerView v-if="tab === 'planning'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { NeoMessage, NeoTag } from '@neolibrary/components'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'
import StatCard from '@/components/common/StatCard.vue'
import StatusChip from '@/components/common/StatusChip.vue'
import TeamPlannerView from '@/views/TeamPlannerView.vue'
import type { Notification } from '@/types/notification.types'

interface Project {
  id: string
  name: string
  clientName?: string | null
  status: string
}

interface Task {
  id: string
  title: string
  status: string
  priority: string
  dueDate: string | null
  project?: { id: string; name: string } | null
}

interface Milestone {
  id: string
  projectId: string
  projectName: string
  title: string
  date: string
}

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

// Two-tab dashboard: portfolio overview + team planning (merged in from the old
// standalone Planif. équipe page). The active tab is mirrored in the URL so it's
// deep-linkable / refresh-safe.
type DashTab = 'overview' | 'planning'
const tab = ref<DashTab>(route.query.tab === 'planning' ? 'planning' : 'overview')
function setTab(t: DashTab): void {
  tab.value = t
  void router.replace({ query: { ...route.query, tab: t } })
}
const notifStore = useNotificationStore()

const firstName = computed<string>(() => authStore.userFullName.split(' ')[0] || 'Vous')

const projects = ref<Project[]>([])
const myTasks = ref<Task[]>([])
const milestones = ref<Milestone[]>([])
const loadingProjects = ref<boolean>(true)
const loadingTasks = ref<boolean>(true)
const loadingMilestones = ref<boolean>(true)
const error = ref<string | null>(null)

const stats = computed(() => {
  const active = projects.value.filter((p) => p.status !== 'Closed' && p.status !== 'Archived').length
  const awaitingSpec = projects.value.filter((p) => p.status === 'Parametrage').length
  const cahierValidated = projects.value.filter(
    (p) => p.status === 'MEP' || p.status === 'Production' || p.status === 'Closed',
  ).length
  const open = myTasks.value.filter((t) => t.status !== 'Closed' && t.status !== 'Resolved')
  return {
    active,
    awaitingSpec,
    cahierValidated,
    openTasks: open.length,
  }
})

const subtitle = computed<string>(() => {
  const a = stats.value.awaitingSpec
  const t = stats.value.openTasks
  if (a > 0 && t > 0) {
    return `${a} cahier${a > 1 ? 's' : ''} en validation, ${t} tâche${t > 1 ? 's' : ''} ouverte${t > 1 ? 's' : ''}.`
  }
  if (a > 0) return `${a} cahier${a > 1 ? 's' : ''} attend${a > 1 ? 'ent' : ''} la spécification.`
  if (t > 0) return `${t} tâche${t > 1 ? 's' : ''} à traiter aujourd'hui.`
  return 'Tout est calme — bonne journée.'
})

const unreadCount = computed<number>(() =>
  notifStore.notifications.filter((n) => !n.isRead).length,
)

const recentNotifications = computed<Notification[]>(() =>
  notifStore.notifications.filter((n) => !n.isRead).slice(0, 5),
)

// ─── Actions ─────────────────────────────────────────────────────────────────

function openProject(id: string): void {
  void router.push({ name: 'pm-project-detail', params: { id } })
}

function openTask(t: Task): void {
  if (t.project?.id) {
    void router.push(`/app/pm/projects/${t.project.id}/workpackages?wpId=${t.id}`)
  }
}

function goTo(path: string): void { void router.push(path) }

function onNotifClick(n: Notification): void {
  if (!n.isRead) void notifStore.markAsRead(n.id)
  if (typeof n.link === 'string' && n.link.startsWith('/')) void router.push(n.link)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function prioClass(p: string): 'urgent' | 'high' | 'normal' | 'low' {
  const v = (p || '').toLowerCase()
  if (v === 'urgent' || v === 'critical') return 'urgent'
  if (v === 'high') return 'high'
  if (v === 'low') return 'low'
  return 'normal'
}

function isOverdue(due: string | null): boolean {
  if (!due) return false
  return new Date(due).getTime() < Date.now()
}

function formatDueDate(due: string): string {
  const d = new Date(due)
  const now = new Date()
  const diffDays = Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return "Aujourd'hui"
  if (diffDays === 1) return 'Demain'
  if (diffDays === -1) return 'Hier'
  if (diffDays < 0) return `Il y a ${Math.abs(diffDays)}j`
  if (diffDays <= 7) return `Dans ${diffDays}j`
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function monthShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR', { month: 'short' })
}

function phaseLabelLocal(s: string): string {
  const m: Record<string, string> = {
    New: 'Nouveau',
    Parametrage: 'Paramétrage',
    MEP: 'MEP',
    Production: 'Production',
    Closed: 'Clôturé',
    Archived: 'Archivé',
  }
  return m[s] ?? s
}

function phaseSeverity(s: string): 'info' | 'success' | 'warn' | 'secondary' {
  if (s === 'Parametrage') return 'warn'
  if (s === 'MEP' || s === 'Production') return 'success'
  if (s === 'Closed' || s === 'Archived') return 'secondary'
  return 'info'
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

async function loadProjects(): Promise<void> {
  loadingProjects.value = true
  try {
    const { data } = await api.get<{ items: Project[] } | Project[]>('/pm/projects')
    projects.value = Array.isArray(data) ? data : data.items
  } catch (e) {
    projects.value = []
    error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des projets.'
  } finally {
    loadingProjects.value = false
  }
}

async function loadTasks(): Promise<void> {
  loadingTasks.value = true
  try {
    const { data } = await api.get<{ items: Task[] }>('/pm/my-tasks')
    myTasks.value = data.items
  } catch {
    myTasks.value = []
  } finally {
    loadingTasks.value = false
  }
}

async function loadMilestones(): Promise<void> {
  loadingMilestones.value = true
  try {
    const results: Milestone[] = []
    await Promise.all(
      projects.value.slice(0, 10).map(async (p) => {
        try {
          interface MilestoneRow { id: string; title: string; date: string; isReached: boolean }
          const { data: ms } = await api.get<MilestoneRow[]>(
            `/pm/projects/${p.id}/milestones`,
            { suppressErrorToast: true } as never,
          )
          for (const m of ms) {
            if (!m.isReached && new Date(m.date).getTime() > Date.now()) {
              results.push({ id: m.id, projectId: p.id, projectName: p.name, title: m.title, date: m.date })
            }
          }
        } catch { /* silent */ }
      }),
    )
    results.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    milestones.value = results
  } finally {
    loadingMilestones.value = false
  }
}

onMounted(async () => {
  await loadProjects()
  void loadTasks()
  void loadMilestones()
  void notifStore.fetchNotifications().catch(() => undefined)
})
</script>

<style scoped>
/* Tabbed shell: overview + team planning under one nav item. */
.pmd-shell { display: flex; flex-direction: column; height: 100%; }
.pmd-tabs {
  flex-shrink: 0; display: flex; gap: 0.25rem;
  border-bottom: 1px solid var(--nl-border);
}
.pmd-tab {
  display: inline-flex; align-items: center; gap: 0.5rem;
  background: transparent; border: none;
  padding: 0.75rem 1rem; font-size: 0.9rem; font-weight: 600;
  color: var(--nl-text-2, #6b7280); cursor: pointer;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.pmd-tab:hover { color: var(--nl-text-1, #111827); }
.pmd-tab--active { color: var(--nl-accent); border-bottom-color: var(--nl-accent); }
.pmd-body { flex: 1; min-height: 0; overflow-y: auto; }

.pmd { padding: 1.75rem; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }

.pmd__head { margin-bottom: 0.25rem; }
.pmd__eyebrow {
  font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--nl-text-3); margin: 0 0 0.25rem 0; font-weight: 600;
}
.pmd__title { margin: 0 0 0.25rem 0; font-size: 1.75rem; color: var(--nl-text-1); letter-spacing: -0.02em; }
.pmd__subtitle { margin: 0; color: var(--nl-text-2); font-size: 0.9375rem; }

.pmd__stats {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}
@media (max-width: 900px) { .pmd__stats { grid-template-columns: repeat(2, 1fr); } }

.pmd__grid {
  display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 1rem;
}
@media (max-width: 1100px) { .pmd__grid { grid-template-columns: 1fr; } }

.pmd__col { display: flex; flex-direction: column; gap: 1rem; }

.nl-card {
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  padding: 1.25rem;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.pmd__card-head {
  display: flex; align-items: center; justify-content: space-between;
}
.pmd__card-head h2 {
  margin: 0; font-size: 1rem; font-weight: 600; color: var(--nl-text-1);
  display: inline-flex; align-items: center; gap: 0.5rem;
}
.pmd__card-head h2 i { color: var(--nl-accent, #1e9e8f); }
.pmd__link { font-size: 0.8125rem; color: var(--nl-accent); text-decoration: none; }
.pmd__link:hover { text-decoration: underline; }
.pmd__badge {
  background: var(--nl-danger); color: #fff;
  padding: 0 6px; border-radius: 999px;
  font-size: 0.75rem; font-weight: 600; line-height: 1.6;
}

.pmd__loading,
.pmd__empty {
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 0.5rem;
  padding: 2rem; color: var(--nl-text-3); text-align: center;
}
.pmd__empty--mini { padding: 1rem; }
.pmd__empty i { font-size: 1.5rem; color: var(--nl-success, #059669); }

/* Project list */
.pmd__project-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.pmd__project {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--nl-border); border-radius: 6px;
  cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.pmd__project:hover { border-color: var(--nl-accent); background: var(--nl-accent-light, #ecfdf5); }
.pmd__project-body { flex: 1; min-width: 0; }
.pmd__project-name { font-weight: 600; font-size: 0.9375rem; color: var(--nl-text-1); }
.pmd__project-meta { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.2rem; font-size: 0.75rem; color: var(--nl-text-3); }
.pmd__client { color: var(--nl-text-3); }
.pmd__project-chevron { color: var(--nl-text-3); }

/* Tasks list */
.pmd__task-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.pmd__task {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--nl-border); border-radius: 6px;
  cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.pmd__task:hover { border-color: var(--nl-accent); background: var(--nl-surface-2, #fafafa); }
.pmd__task--overdue { border-left: 3px solid var(--nl-danger, #dc2626); }
.pmd__prio { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--nl-text-3); }
.pmd__prio--urgent { background: var(--nl-danger, #dc2626); }
.pmd__prio--high   { background: var(--nl-warn, #d97706); }
.pmd__prio--low    { background: var(--nl-text-3); opacity: 0.5; }
.pmd__task-body { flex: 1; min-width: 0; }
.pmd__task-title { font-size: 0.875rem; font-weight: 500; color: var(--nl-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmd__task-meta { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.15rem; font-size: 0.75rem; color: var(--nl-text-3); }
.pmd__task-project { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
.pmd__task-due { font-size: 0.75rem; color: var(--nl-text-3); flex-shrink: 0; }
.pmd__task-due--danger { color: var(--nl-danger); font-weight: 600; }

/* Milestones */
.pmd__mile-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.pmd__mile {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.5rem 0.6rem;
  border-radius: 6px; cursor: pointer;
  transition: background 0.15s;
}
.pmd__mile:hover { background: var(--nl-surface-2, #fafafa); }
.pmd__mile-date {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 44px; height: 44px;
  background: var(--nl-accent-light, #ecfdf5); color: var(--nl-accent, #1e9e8f);
  border-radius: 6px; flex-shrink: 0; font-weight: 600;
}
.pmd__mile-day { font-size: 1rem; line-height: 1; }
.pmd__mile-mon { font-size: 0.6875rem; text-transform: uppercase; line-height: 1.4; }
.pmd__mile-body { flex: 1; min-width: 0; }
.pmd__mile-title { font-size: 0.875rem; font-weight: 500; color: var(--nl-text-1); }
.pmd__mile-proj { font-size: 0.75rem; color: var(--nl-text-3); }

/* Notifications */
.pmd__notif-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.pmd__notif {
  display: flex; flex-direction: column; gap: 0.15rem;
  padding: 0.5rem 0.65rem;
  border-left: 3px solid var(--nl-border);
  background: var(--nl-surface-2, #fafafa);
  border-radius: 4px; cursor: pointer;
  transition: background 0.15s;
}
.pmd__notif--unread { border-left-color: var(--nl-accent); background: var(--nl-accent-light, #ecfdf5); }
.pmd__notif:hover { filter: brightness(0.97); }
.pmd__notif-title { font-size: 0.8125rem; font-weight: 600; color: var(--nl-text-1); }
.pmd__notif-msg {
  font-size: 0.75rem; color: var(--nl-text-3);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
</style>
