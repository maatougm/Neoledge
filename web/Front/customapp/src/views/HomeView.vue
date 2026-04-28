<!-- @file src/views/HomeView.vue — Unified inbox: "what should I work on today". -->
<template>
  <div class="home">
    <!-- Greeting + quick actions -->
    <header class="home__header">
      <div>
        <p class="home__eyebrow">{{ today }}</p>
        <h1 class="home__title">{{ greeting }}, {{ firstName }}.</h1>
        <p class="home__subtitle">Voici ce qui nécessite votre attention aujourd'hui.</p>
      </div>
      <div class="home__actions">
        <button class="home__cmdk" @click="openCmdK">
          <i class="pi pi-search" />
          <span>Rechercher…</span>
          <span class="nl-kbd">Ctrl</span><span class="nl-kbd">K</span>
        </button>
      </div>
    </header>

    <!-- Stat row -->
    <section class="home__stats">
      <StatCard icon="pi-list" label="Tâches ouvertes" :value="stats.openTasks"         tone="normal" />
      <StatCard icon="pi-exclamation-triangle" label="En retard" :value="stats.overdue" tone="danger" />
      <StatCard icon="pi-calendar" label="Dues cette semaine" :value="stats.dueThisWeek" tone="warning" />
      <StatCard icon="pi-check-circle" label="Validations à faire" :value="stats.pendingValidations" tone="normal" />
    </section>

    <!-- 2-column split -->
    <section class="home__grid">
      <!-- ── Left column: my tasks + validations ── -->
      <div class="home__col home__col--main">

        <!-- My tasks -->
        <div class="nl-card">
          <div class="home__card-head">
            <h2 class="home__card-title">
              <i class="pi pi-list" />
              Mes tâches
            </h2>
            <RouterLink to="/app/pm/my-tasks" class="home__see-all">Tout voir →</RouterLink>
          </div>
          <div v-if="loadingTasks" class="nl-empty">Chargement…</div>
          <div v-else-if="myTasks.length === 0" class="nl-empty">
            <div class="nl-empty__icon"><i class="pi pi-check" /></div>
            <p>Aucune tâche assignée. Boulot terminé ?</p>
          </div>
          <ul v-else class="home__task-list">
            <li
              v-for="t in myTasks.slice(0, 6)"
              :key="t.id"
              class="home__task nl-row"
              :class="{ 'home__task--overdue': isOverdue(t.dueDate) }"
              @click="openTask(t)"
            >
              <span class="nl-prio-dot" :class="`nl-prio-dot--${prioClass(t.priority)}`" />
              <div class="home__task-body">
                <div class="home__task-title">{{ t.title }}</div>
                <div class="home__task-meta">
                  <span v-if="t.project?.name" class="home__task-project">{{ t.project.name }}</span>
                  <StatusChip :status="t.status" />
                </div>
              </div>
              <div class="home__task-due">
                <span v-if="t.dueDate" :class="{ 'home__task-due--danger': isOverdue(t.dueDate) }">
                  {{ formatDueDate(t.dueDate) }}
                </span>
              </div>
            </li>
          </ul>
        </div>

        <!-- Pending validations (for roles that validate) -->
        <div v-if="showValidations" class="nl-card">
          <div class="home__card-head">
            <h2 class="home__card-title">
              <i class="pi pi-check-circle" />
              Validations en attente
            </h2>
          </div>
          <div v-if="loadingValidations" class="nl-empty">Chargement…</div>
          <div v-else-if="pendingValidations.length === 0" class="nl-empty">
            <div class="nl-empty__icon"><i class="pi pi-check" /></div>
            <p>Aucune validation en attente.</p>
          </div>
          <ul v-else class="home__val-list">
            <li
              v-for="v in pendingValidations.slice(0, 5)"
              :key="v.projectId"
              class="home__val nl-row"
              @click="goTo(`/app/pm/projects/${v.projectId}`)"
            >
              <i class="pi pi-flag home__val-icon" />
              <div class="home__val-body">
                <div class="home__val-title">{{ v.projectName }}</div>
                <div class="home__val-phase">Phase : {{ v.phase }}</div>
              </div>
              <button class="home__val-cta">Examiner →</button>
            </li>
          </ul>
        </div>
      </div>

      <!-- ── Right column: activity + upcoming + recents ── -->
      <div class="home__col home__col--side">

        <!-- Upcoming milestones -->
        <div class="nl-card">
          <div class="home__card-head">
            <h2 class="home__card-title">
              <i class="pi pi-flag" />
              Prochains jalons
            </h2>
          </div>
          <div v-if="loadingMilestones" class="nl-empty">Chargement…</div>
          <div v-else-if="milestones.length === 0" class="nl-empty">
            <p>Aucun jalon à venir.</p>
          </div>
          <ul v-else class="home__mile-list">
            <li
              v-for="m in milestones.slice(0, 5)"
              :key="m.id"
              class="home__mile nl-row"
              @click="goTo(`/app/pm/projects/${m.projectId}/gantt`)"
            >
              <div class="home__mile-date">
                <span class="home__mile-day">{{ new Date(m.date).getDate() }}</span>
                <span class="home__mile-mon">{{ monthShort(m.date) }}</span>
              </div>
              <div class="home__mile-body">
                <div class="home__mile-title">{{ m.title }}</div>
                <div class="home__mile-proj">{{ m.projectName }}</div>
              </div>
            </li>
          </ul>
        </div>

        <!-- Notifications preview -->
        <div class="nl-card">
          <div class="home__card-head">
            <h2 class="home__card-title">
              <i class="pi pi-bell" />
              Notifications
              <span v-if="unreadCount > 0" class="home__badge">{{ unreadCount }}</span>
            </h2>
          </div>
          <div v-if="notifStore.notifications.length === 0" class="nl-empty">
            <p>Tout est à jour.</p>
          </div>
          <ul v-else class="home__notif-list">
            <li
              v-for="n in notifStore.notifications.slice(0, 4)"
              :key="n.id"
              class="home__notif nl-row"
              :class="{ 'home__notif--unread': !n.isRead }"
              @click="onNotifClick(n)"
            >
              <i class="pi home__notif-icon" :class="notifIcon(n.type)" />
              <div class="home__notif-body">
                <div class="home__notif-title">{{ n.title }}</div>
                <div class="home__notif-msg">{{ n.message }}</div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import StatCard from '@/components/common/StatCard.vue'
import StatusChip from '@/components/common/StatusChip.vue'

interface Task {
  id: string
  title: string
  status: string
  priority: string
  dueDate: string | null
  project?: { id: string; name: string } | null
}

interface PendingValidation {
  projectId: string
  projectName: string
  phase: string
}

interface Milestone {
  id: string
  projectId: string
  projectName: string
  title: string
  date: string
}

interface ProjectLite { id: string; name: string; clientName?: string | null; status: string }

const router    = useRouter()
const authStore = useAuthStore()
const notifStore = useNotificationStore()
const kb        = useKeyboardShortcuts()

const firstName = computed<string>(() => authStore.userFullName.split(' ')[0] || 'Vous')
const today     = computed<string>(() =>
  new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
)
const greeting = computed<string>(() => {
  const h = new Date().getHours()
  if (h < 12) return 'Bonjour'
  if (h < 18) return 'Bon après-midi'
  return 'Bonsoir'
})

const myTasks             = ref<Task[]>([])
const pendingValidations  = ref<PendingValidation[]>([])
const milestones          = ref<Milestone[]>([])
const loadingTasks        = ref<boolean>(true)
const loadingValidations  = ref<boolean>(true)
const loadingMilestones   = ref<boolean>(true)

const unreadCount = computed<number>(() => notifStore.notifications.filter((n: { isRead: boolean }) => !n.isRead).length)

const showValidations = computed<boolean>(() => {
  const r = authStore.userRole
  return r === 'Admin' || r === 'SpecificationTeam' || r === 'Member'
})

const stats = computed(() => {
  const now = Date.now()
  const weekFromNow = now + 7 * 24 * 60 * 60 * 1000
  const open = myTasks.value.filter((t) => t.status !== 'Closed' && t.status !== 'Resolved')
  return {
    openTasks: open.length,
    overdue: open.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now).length,
    dueThisWeek: open.filter((t) => {
      if (!t.dueDate) return false
      const d = new Date(t.dueDate).getTime()
      return d >= now && d <= weekFromNow
    }).length,
    pendingValidations: pendingValidations.value.length,
  }
})

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

function notifIcon(type: string): string {
  if (type.includes('validation_approved')) return 'pi-check-circle'
  if (type.includes('validation_rejected')) return 'pi-times-circle'
  if (type.includes('mention'))             return 'pi-at'
  if (type.includes('deadline'))            return 'pi-calendar'
  return 'pi-info-circle'
}

function openTask(t: Task): void {
  if (t.project?.id) void router.push(`/app/pm/projects/${t.project.id}/workpackages?wpId=${t.id}`)
}
function goTo(path: string): void { void router.push(path) }

function onNotifClick(n: { id: string; isRead: boolean; link?: string | null }): void {
  if (!n.isRead) void notifStore.markAsRead(n.id)
  if (n.link) void router.push(n.link)
}

function openCmdK(): void { kb.searchVisible.value = true }

async function loadMyTasks(): Promise<void> {
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

async function loadPendingValidations(): Promise<void> {
  loadingValidations.value = true
  try {
    // Fetch projects visible to user, then check validations per phase.
    const endpoint = authStore.userRole === 'Admin' ? '/admin/project' : '/pm/team-projects'
    const { data } = await api.get<{ items: ProjectLite[] } | ProjectLite[]>(endpoint)
    const projects = Array.isArray(data) ? data : data.items
    const pending: PendingValidation[] = []
    for (const p of projects) {
      const phase = projectStatusToPhase(p.status)
      if (phase && canValidatePhase(authStore.userRole || '', phase)) {
        pending.push({ projectId: p.id, projectName: p.name, phase })
      }
    }
    pendingValidations.value = pending
  } catch {
    pendingValidations.value = []
  } finally {
    loadingValidations.value = false
  }
}

async function loadMilestones(): Promise<void> {
  loadingMilestones.value = true
  try {
    const endpoint = authStore.userRole === 'Admin' ? '/admin/project' : '/pm/projects'
    const { data } = await api.get<{ items: ProjectLite[] } | ProjectLite[]>(endpoint)
    const projects = Array.isArray(data) ? data : data.items
    const results: Milestone[] = []
    await Promise.all(
      projects.slice(0, 10).map(async (p) => {
        try {
          interface MilestoneRow { id: string; title: string; date: string; isReached: boolean }
          const { data: ms } = await api.get<MilestoneRow[]>(`/pm/projects/${p.id}/milestones`, { suppressErrorToast: true } as never)
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
  } catch {
    milestones.value = []
  } finally {
    loadingMilestones.value = false
  }
}

function projectStatusToPhase(status: string): string | null {
  if (status === 'Parametrage') return 'Parametrage'
  if (status === 'MEP')         return 'MEP'
  return null
}

function canValidatePhase(role: string, phase: string): boolean {
  if (role === 'Admin') return true
  if (phase === 'Parametrage') return role === 'SpecificationTeam'
  if (phase === 'MEP')         return role === 'ProjectManager'
  return false
}

onMounted(() => {
  void loadMyTasks()
  void loadPendingValidations()
  void loadMilestones()
})
</script>

<style scoped>
.home { padding: var(--nl-sp-6) var(--nl-sp-6); max-width: 1400px; margin: 0 auto; }

.home__header {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: var(--nl-sp-4); margin-bottom: var(--nl-sp-6);
  flex-wrap: wrap;
}
.home__eyebrow {
  font-size: var(--nl-fs-xs); text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--nl-text-3);
  margin: 0 0 var(--nl-sp-1) 0; font-weight: 600;
}
.home__title {
  margin: 0; font-size: var(--nl-fs-2xl); font-weight: 700;
  color: var(--nl-text-1); letter-spacing: -0.02em;
}
.home__subtitle {
  margin: var(--nl-sp-1) 0 0 0; color: var(--nl-text-3);
  font-size: var(--nl-fs-md);
}

.home__actions { display: flex; align-items: center; gap: var(--nl-sp-2); }
.home__cmdk {
  display: inline-flex; align-items: center; gap: var(--nl-sp-2);
  padding: 8px 12px; background: var(--nl-surface);
  border: 1px solid var(--nl-border); border-radius: var(--nl-radius);
  color: var(--nl-text-3); font-size: var(--nl-fs-sm);
  cursor: pointer; transition: background 0.15s;
  font-family: var(--nl-font);
}
.home__cmdk:hover { background: var(--nl-surface-2); }

.home__stats {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: var(--nl-sp-3); margin-bottom: var(--nl-sp-6);
}

.home__grid {
  display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: var(--nl-sp-4);
}
.home__col { display: flex; flex-direction: column; gap: var(--nl-sp-4); }

.home__card-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: var(--nl-sp-3);
}
.home__card-title {
  display: flex; align-items: center; gap: var(--nl-sp-2);
  margin: 0; font-size: var(--nl-fs-md); font-weight: 600;
  color: var(--nl-text-1);
}
.home__card-title .pi { color: var(--nl-text-3); font-size: 14px; }
.home__see-all {
  font-size: var(--nl-fs-sm); color: var(--nl-accent);
  font-weight: 500; text-decoration: none;
}
.home__see-all:hover { text-decoration: underline; }
.home__badge {
  background: var(--nl-danger); color: #fff;
  padding: 0 6px; border-radius: var(--nl-radius-pill);
  font-size: var(--nl-fs-xs); font-weight: 600; line-height: 1.6;
}

/* Task list */
.home__task-list { list-style: none; padding: 0; margin: 0; }
.home__task {
  display: flex; align-items: center; gap: var(--nl-sp-3);
  padding: var(--nl-sp-3); border-radius: var(--nl-radius);
}
.home__task-body { flex: 1; min-width: 0; }
.home__task-title {
  font-size: var(--nl-fs-base); font-weight: 500; color: var(--nl-text-1);
  margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.home__task-meta {
  display: flex; align-items: center; gap: var(--nl-sp-2);
  font-size: var(--nl-fs-sm); color: var(--nl-text-3);
}
.home__task-project {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;
}
.home__task-due {
  font-size: var(--nl-fs-sm); color: var(--nl-text-3);
  flex-shrink: 0;
}
.home__task-due--danger { color: var(--nl-danger); font-weight: 600; }

/* Validations */
.home__val-list { list-style: none; padding: 0; margin: 0; }
.home__val {
  display: flex; align-items: center; gap: var(--nl-sp-3);
  padding: var(--nl-sp-3); border-radius: var(--nl-radius);
}
.home__val-icon { color: var(--nl-warning); font-size: 16px; }
.home__val-body { flex: 1; min-width: 0; }
.home__val-title { font-size: var(--nl-fs-base); font-weight: 500; color: var(--nl-text-1); }
.home__val-phase { font-size: var(--nl-fs-sm); color: var(--nl-text-3); }
.home__val-cta {
  background: transparent; border: 1px solid var(--nl-border);
  color: var(--nl-text-1); font-size: var(--nl-fs-sm);
  padding: 4px 10px; border-radius: var(--nl-radius);
  cursor: pointer;
}
.home__val-cta:hover { background: var(--nl-surface-2); }

/* Milestones */
.home__mile-list { list-style: none; padding: 0; margin: 0; }
.home__mile {
  display: flex; align-items: center; gap: var(--nl-sp-3);
  padding: var(--nl-sp-3); border-radius: var(--nl-radius);
}
.home__mile-date {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 44px; height: 44px; background: var(--nl-accent-light);
  color: var(--nl-accent); border-radius: var(--nl-radius);
  flex-shrink: 0; font-weight: 600;
}
.home__mile-day { font-size: var(--nl-fs-lg); line-height: 1; }
.home__mile-mon { font-size: var(--nl-fs-xs); text-transform: uppercase; line-height: 1.4; }
.home__mile-body { flex: 1; min-width: 0; }
.home__mile-title { font-size: var(--nl-fs-base); font-weight: 500; color: var(--nl-text-1); }
.home__mile-proj { font-size: var(--nl-fs-sm); color: var(--nl-text-3); }

/* Notifications */
.home__notif-list { list-style: none; padding: 0; margin: 0; }
.home__notif {
  display: flex; align-items: flex-start; gap: var(--nl-sp-3);
  padding: var(--nl-sp-3); border-radius: var(--nl-radius);
}
.home__notif--unread { background: var(--nl-accent-light); }
.home__notif-icon { color: var(--nl-accent); font-size: 14px; margin-top: 2px; }
.home__notif-body { flex: 1; min-width: 0; }
.home__notif-title { font-size: var(--nl-fs-base); font-weight: 500; color: var(--nl-text-1); }
.home__notif-msg {
  font-size: var(--nl-fs-sm); color: var(--nl-text-3); line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}

/* Mobile */
@media (max-width: 900px) {
  .home__grid  { grid-template-columns: 1fr; }
  .home__stats { grid-template-columns: repeat(2, 1fr); }
  .home__header { flex-direction: column; align-items: flex-start; }
}
</style>
