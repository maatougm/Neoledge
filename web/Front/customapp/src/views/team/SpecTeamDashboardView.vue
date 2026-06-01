<!-- @file SpecTeamDashboardView.vue — dedicated dashboard for the
     SpecificationTeam role. Their job is reviewing/validating cahiers, so
     the layout is queue-first: pending reviews on top, validation activity
     stats, projects I'm currently in. -->
<template>
  <div class="std">
    <header class="std__head">
      <p class="std__eyebrow">Espace validation</p>
      <h1 class="std__title">Bonjour {{ firstName }}.</h1>
      <p class="std__subtitle">{{ subtitle }}</p>
    </header>

    <!-- Stat row: validation pulse -->
    <section class="std__stats">
      <StatCard icon="pi-clock"          label="Cahiers à valider"     :value="stats.pending"          tone="warning" />
      <StatCard icon="pi-times-circle"   label="Cahiers rejetés"       :value="stats.rejected"         tone="danger" />
      <StatCard icon="pi-check-circle"   label="Validés cette semaine" :value="stats.approvedThisWeek" tone="normal" />
      <StatCard icon="pi-briefcase"      label="Projets suivis"        :value="stats.totalProjects"    tone="normal" />
    </section>

    <NeoMessage v-if="error" severity="error" :text="error" class="mb-3" />

    <!-- 2-column split -->
    <div class="std__grid">
      <!-- Left column: queue + projects -->
      <div class="std__col std__col--main">
        <!-- Pending reviews queue (the core) -->
        <section class="nl-card std__queue">
          <header class="std__card-head">
            <h2><i class="pi pi-list-check" /> File de validation</h2>
            <RouterLink class="std__link" to="/app/team/pending-reviews">Voir tout</RouterLink>
          </header>
          <div v-if="loadingPending && pending.length === 0" class="std__loading">
            <i class="pi pi-spin pi-spinner" /> Chargement…
          </div>
          <div v-else-if="pending.length === 0" class="std__empty">
            <i class="pi pi-check-circle" />
            <p>Aucun cahier en attente. La file est vide.</p>
          </div>
          <ul v-else class="std__queue-list">
            <li
              v-for="row in pending.slice(0, 5)"
              :key="row.projectId"
              class="std__queue-row"
              :class="{ 'std__queue-row--rejected': row.cahierStatus === 'rejected' }"
              @click="openProject(row.projectId)"
            >
              <div class="std__queue-body">
                <div class="std__queue-name">{{ row.projectName }}</div>
                <div class="std__queue-meta">
                  <span class="std__client">{{ row.clientName }}</span>
                  <span v-if="row.managerName" class="std__manager">· {{ row.managerName }}</span>
                </div>
              </div>
              <div class="std__queue-side">
                <NeoTag
                  :value="row.cahierStatus === 'rejected' ? 'Rejeté — à regénérer' : 'À examiner'"
                  :severity="row.cahierStatus === 'rejected' ? 'warn' : 'info'"
                />
                <span v-if="row.cahierSavedAt" class="std__queue-date">
                  {{ formatRelative(row.cahierSavedAt) }}
                </span>
              </div>
            </li>
          </ul>
        </section>

        <!-- All projects I'm involved in -->
        <section class="nl-card">
          <header class="std__card-head">
            <h2><i class="pi pi-briefcase" /> Mes projets</h2>
            <RouterLink class="std__link" to="/app/team/projects">Voir tout</RouterLink>
          </header>
          <div v-if="loadingProjects && projects.length === 0" class="std__loading">
            <i class="pi pi-spin pi-spinner" /> Chargement…
          </div>
          <div v-else-if="projects.length === 0" class="std__empty std__empty--mini">
            <p>Tu n'es membre d'aucun projet pour l'instant.</p>
          </div>
          <ul v-else class="std__project-list">
            <li
              v-for="p in projects.slice(0, 6)"
              :key="p.id"
              class="std__project"
              @click="openProject(p.id)"
            >
              <div class="std__project-body">
                <div class="std__project-name">{{ p.name }}</div>
                <div class="std__project-meta">
                  <span class="std__client">{{ p.clientName ?? '—' }}</span>
                  <NeoTag :value="phaseLabelLocal(p.status)" :severity="phaseSeverity(p.status)" />
                </div>
              </div>
              <i class="pi pi-chevron-right std__project-chevron" />
            </li>
          </ul>
        </section>
      </div>

      <!-- Right column: recent activity + notifications -->
      <div class="std__col std__col--side">
        <!-- Recent feedback I've given -->
        <section class="nl-card">
          <header class="std__card-head">
            <h2><i class="pi pi-history" /> Mes derniers verdicts</h2>
            <RouterLink class="std__link" to="/app/team/validations">Voir tout</RouterLink>
          </header>
          <div v-if="loadingActivity && recentActivity.length === 0" class="std__empty std__empty--mini">
            <p>Chargement…</p>
          </div>
          <div v-else-if="recentActivity.length === 0" class="std__empty std__empty--mini">
            <p>Aucune validation récente.</p>
          </div>
          <ul v-else class="std__activity-list">
            <li
              v-for="a in recentActivity.slice(0, 5)"
              :key="`${a.projectId}-${a.createdAt}`"
              class="std__activity"
              @click="openProject(a.projectId)"
            >
              <i
                class="pi"
                :class="a.status === 'approved' ? 'pi-check-circle std__activity-ok' : 'pi-times-circle std__activity-ko'"
              />
              <div class="std__activity-body">
                <div class="std__activity-title">
                  <span class="std__activity-name">{{ a.projectName }}</span>
                  <span class="std__activity-verdict">{{ a.status === 'approved' ? 'validé' : 'rejeté' }}</span>
                </div>
                <div class="std__activity-time">{{ formatRelative(a.createdAt) }}</div>
              </div>
            </li>
          </ul>
        </section>

        <!-- Notifications preview -->
        <section class="nl-card">
          <header class="std__card-head">
            <h2><i class="pi pi-bell" /> Notifications</h2>
            <span v-if="unreadCount > 0" class="std__badge">{{ unreadCount }}</span>
          </header>
          <div v-if="recentNotifications.length === 0" class="std__empty std__empty--mini">
            <p>Tout est à jour.</p>
          </div>
          <ul v-else class="std__notif-list">
            <li
              v-for="n in recentNotifications"
              :key="n.id"
              class="std__notif"
              :class="{ 'std__notif--unread': !n.isRead }"
              @click="onNotifClick(n)"
            >
              <span class="std__notif-title">{{ n.title }}</span>
              <span class="std__notif-msg">{{ n.message }}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { NeoMessage, NeoTag } from '@neolibrary/components'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'
import StatCard from '@/components/common/StatCard.vue'
import { formatRelative } from '@/lib/formatDate'
import type { Notification } from '@/types/notification.types'

interface PendingReview {
  projectId: string
  projectName: string
  clientName: string
  phase: string
  cahierSavedAt: string | null
  managerName: string | null
  cahierStatus: 'pending' | 'approved' | 'rejected'
  myLastFeedbackAt: string | null
}

interface ProjectLite {
  id: string
  name: string
  clientName?: string | null
  status: string
}

interface ActivityRow {
  projectId: string
  projectName: string
  status: 'approved' | 'rejected'
  createdAt: string
}

const router = useRouter()
const authStore = useAuthStore()
const notifStore = useNotificationStore()

const firstName = computed<string>(() => authStore.userFullName.split(' ')[0] || 'Vous')

const pending = ref<PendingReview[]>([])
const projects = ref<ProjectLite[]>([])
const recentActivity = ref<ActivityRow[]>([])
const loadingPending = ref<boolean>(true)
const loadingProjects = ref<boolean>(true)
const loadingActivity = ref<boolean>(true)
const error = ref<string | null>(null)

const stats = computed(() => {
  const pendingCount = pending.value.filter((r) => r.cahierStatus === 'pending').length
  const rejectedCount = pending.value.filter((r) => r.cahierStatus === 'rejected').length
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const approvedThisWeek = recentActivity.value.filter(
    (a) => a.status === 'approved' && new Date(a.createdAt).getTime() >= sevenDaysAgo,
  ).length
  return {
    pending: pendingCount,
    rejected: rejectedCount,
    approvedThisWeek,
    totalProjects: projects.value.length,
  }
})

const subtitle = computed<string>(() => {
  const p = stats.value.pending
  if (p === 0) return 'File de validation vide. Bonne journée.'
  if (p === 1) return '1 cahier attend ta validation.'
  return `${p} cahiers attendent ta validation.`
})

const unreadCount = computed<number>(() =>
  notifStore.notifications.filter((n) => !n.isRead).length,
)
const recentNotifications = computed<Notification[]>(() =>
  notifStore.notifications.filter((n) => !n.isRead).slice(0, 5),
)

// ─── Actions ─────────────────────────────────────────────────────────────────

function openProject(projectId: string): void {
  void router.push({ name: 'team-project-detail', params: { id: projectId }, query: { from: 'queue' } })
}

function onNotifClick(n: Notification): void {
  if (!n.isRead) void notifStore.markAsRead(n.id)
  if (typeof n.link === 'string' && n.link.startsWith('/')) void router.push(n.link)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function phaseLabelLocal(s: string): string {
  const m: Record<string, string> = {
    Draft: 'Brouillon',
    Kickoff: 'Lancement',
    Realisation: 'Réalisation',
    Cloture: 'Clôture',
    Archived: 'Archivé',
  }
  return m[s] ?? s
}

function phaseSeverity(s: string): 'info' | 'success' | 'warn' | 'secondary' {
  if (s === 'Realisation') return 'warn'
  if (s === 'Cloture') return 'success'
  if (s === 'Archived') return 'secondary'
  return 'info' // Draft / Kickoff
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

async function loadPending(): Promise<void> {
  loadingPending.value = true
  try {
    const { data } = await api.get<PendingReview[]>('/spec/pending-reviews')
    pending.value = Array.isArray(data) ? data : []
  } catch (e) {
    pending.value = []
    error.value = e instanceof Error ? e.message : 'Erreur lors du chargement de la file.'
  } finally {
    loadingPending.value = false
  }
}

async function loadProjects(): Promise<void> {
  loadingProjects.value = true
  try {
    const { data } = await api.get<ProjectLite[] | { items: ProjectLite[] }>('/pm/team-projects')
    const list = Array.isArray(data) ? data : data.items
    projects.value = list ?? []
  } catch {
    projects.value = []
  } finally {
    loadingProjects.value = false
  }
}

interface MyReviewRow {
  projectId: string
  projectName: string
  verdict: 'approved' | 'rejected'
  reviewedAt: string
}

async function loadActivity(): Promise<void> {
  loadingActivity.value = true
  // Real review history (includes approved cahiers, which the pending queue
  // hides). Drives "Mes derniers verdicts" and the "Validés cette semaine" stat.
  try {
    const { data } = await api.get<MyReviewRow[]>('/spec/my-reviews')
    const list = Array.isArray(data) ? data : []
    const rows = list.map<ActivityRow>((r) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      status: r.verdict,
      createdAt: r.reviewedAt,
    }))
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    recentActivity.value = rows
  } catch {
    recentActivity.value = []
  } finally {
    loadingActivity.value = false
  }
}

onMounted(async () => {
  void loadPending()
  void loadActivity()
  void loadProjects()
  void notifStore.fetchNotifications().catch(() => undefined)
})
</script>

<style scoped>
.std { padding: 1.75rem; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }

.std__head { margin-bottom: 0.25rem; }
.std__eyebrow {
  font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--nl-text-3); margin: 0 0 0.25rem 0; font-weight: 600;
}
.std__title { margin: 0 0 0.25rem 0; font-size: 1.75rem; color: var(--nl-text-1); letter-spacing: -0.02em; }
.std__subtitle { margin: 0; color: var(--nl-text-2); font-size: 0.9375rem; }

.std__stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem;
}
@media (max-width: 900px) { .std__stats { grid-template-columns: repeat(2, 1fr); } }

.std__grid {
  display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 1rem;
}
@media (max-width: 1100px) { .std__grid { grid-template-columns: 1fr; } }
.std__col { display: flex; flex-direction: column; gap: 1rem; }

.nl-card {
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  padding: 1.25rem;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.std__queue { border-left: 4px solid var(--nl-warn, #d97706); }

.std__card-head {
  display: flex; align-items: center; justify-content: space-between;
}
.std__card-head h2 {
  margin: 0; font-size: 1rem; font-weight: 600; color: var(--nl-text-1);
  display: inline-flex; align-items: center; gap: 0.5rem;
}
.std__card-head h2 i { color: var(--nl-accent, #1e9e8f); }
.std__link { font-size: 0.8125rem; color: var(--nl-accent); text-decoration: none; }
.std__link:hover { text-decoration: underline; }
.std__badge {
  background: var(--nl-danger); color: #fff;
  padding: 0 6px; border-radius: 999px;
  font-size: 0.75rem; font-weight: 600; line-height: 1.6;
}

.std__loading,
.std__empty {
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 0.5rem;
  padding: 2rem; color: var(--nl-text-3); text-align: center;
}
.std__empty--mini { padding: 1rem; }
.std__empty i { font-size: 1.5rem; color: var(--nl-success, #059669); }

/* Queue list */
.std__queue-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.std__queue-row {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--nl-border); border-radius: 6px;
  cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.std__queue-row:hover { border-color: var(--nl-accent); background: var(--nl-accent-light, #ecfdf5); }
.std__queue-row--rejected { border-left: 3px solid var(--nl-warn, #d97706); }
.std__queue-body { flex: 1; min-width: 0; }
.std__queue-name { font-weight: 600; font-size: 0.9375rem; color: var(--nl-text-1); }
.std__queue-meta { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.2rem; font-size: 0.75rem; color: var(--nl-text-3); }
.std__client { color: var(--nl-text-3); }
.std__manager { color: var(--nl-text-3); }
.std__queue-side { display: flex; align-items: flex-end; flex-direction: column; gap: 0.25rem; flex-shrink: 0; }
.std__queue-date { font-size: 0.6875rem; color: var(--nl-text-3); }

/* Project list */
.std__project-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.std__project {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--nl-border); border-radius: 6px;
  cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.std__project:hover { border-color: var(--nl-accent); background: var(--nl-surface-2, #fafafa); }
.std__project-body { flex: 1; min-width: 0; }
.std__project-name { font-weight: 600; font-size: 0.9375rem; color: var(--nl-text-1); }
.std__project-meta { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.2rem; font-size: 0.75rem; color: var(--nl-text-3); }
.std__project-chevron { color: var(--nl-text-3); }

/* Activity */
.std__activity-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.std__activity {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border-radius: 6px; cursor: pointer;
  transition: background 0.15s;
}
.std__activity:hover { background: var(--nl-surface-2, #fafafa); }
.std__activity i { font-size: 1rem; flex-shrink: 0; }
.std__activity-ok { color: var(--nl-success, #059669); }
.std__activity-ko { color: var(--nl-danger, #dc2626); }
.std__activity-body { flex: 1; min-width: 0; }
.std__activity-title { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8125rem; }
.std__activity-name { font-weight: 600; color: var(--nl-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.std__activity-verdict { color: var(--nl-text-3); font-size: 0.75rem; }
.std__activity-time { font-size: 0.6875rem; color: var(--nl-text-3); margin-top: 0.1rem; }

/* Notifications */
.std__notif-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.std__notif {
  display: flex; flex-direction: column; gap: 0.15rem;
  padding: 0.5rem 0.65rem;
  border-left: 3px solid var(--nl-border);
  background: var(--nl-surface-2, #fafafa);
  border-radius: 4px; cursor: pointer;
  transition: background 0.15s;
}
.std__notif--unread { border-left-color: var(--nl-accent); background: var(--nl-accent-light, #ecfdf5); }
.std__notif:hover { filter: brightness(0.97); }
.std__notif-title { font-size: 0.8125rem; font-weight: 600; color: var(--nl-text-1); }
.std__notif-msg {
  font-size: 0.75rem; color: var(--nl-text-3);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
</style>
