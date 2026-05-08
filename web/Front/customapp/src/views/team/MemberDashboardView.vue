<!-- @file MemberDashboardView.vue — Member home dashboard.
     Sections, top to bottom:
       1. Greeting + context line
       2. À faire aujourd'hui (top 6 urgent open tasks) + side column with
          weekly time + recent notifications
       3. Sprints en cours (cross-project list)
       4. Mes projets (grid) -->
<template>
  <div class="md">
    <header class="md__head">
      <p class="md__eyebrow">Espace équipe</p>
      <h1 class="md__title">Bonjour {{ firstName }}</h1>
      <p class="md__subtitle">{{ subtitle }}</p>
    </header>

    <NeoMessage v-if="store.error" severity="error" :text="store.error" class="mb-3" />

    <!-- Top row: Today + Time + Notifications -->
    <div class="md__row md__row--top">
      <section class="md__col md__col--main nl-card">
        <header class="md__card-head">
          <h2><i class="pi pi-bolt" /> À faire aujourd'hui</h2>
          <RouterLink class="md__link" to="/app/team/my-tasks">Voir tout</RouterLink>
        </header>
        <div v-if="store.loading && store.todayTasks.length === 0" class="md__loading">
          <i class="pi pi-spin pi-spinner" /> Chargement…
        </div>
        <div v-else-if="store.todayTasks.length === 0" class="md__empty">
          <i class="pi pi-check-circle" />
          <p>Tu es à jour. Aucune tâche urgente pour aujourd'hui.</p>
        </div>
        <div v-else class="md__tasks">
          <TaskCard
            v-for="task in store.todayTasks"
            :key="task.id"
            :task="task"
            @open="onOpenTask"
            @transition="onTransition"
          />
        </div>
      </section>

      <aside class="md__col md__col--side">
        <section class="nl-card md__time">
          <header class="md__card-head">
            <h2><i class="pi pi-clock" /> Mon temps cette semaine</h2>
          </header>
          <div class="md__time-value">{{ weekHoursLabel }}</div>
          <p class="md__time-hint">Semaine du {{ weekStartLabel }}</p>
          <NeoButton
            label="Logger du temps"
            icon="pi pi-pencil"
            severity="secondary"
            outlined
            size="small"
            @click="goToTime"
          />
        </section>

        <section class="nl-card md__notif">
          <header class="md__card-head">
            <h2><i class="pi pi-bell" /> Notifications</h2>
            <RouterLink class="md__link" to="/app/team/inbox">Voir toutes</RouterLink>
          </header>
          <div v-if="recentNotifications.length === 0" class="md__empty md__empty--mini">
            <p>Aucune notification non lue.</p>
          </div>
          <ul v-else class="md__notif-list">
            <li
              v-for="n in recentNotifications"
              :key="n.id"
              class="md__notif-item"
              @click="openNotification(n)"
            >
              <span class="md__notif-title">{{ n.title }}</span>
              <span class="md__notif-msg">{{ n.message }}</span>
            </li>
          </ul>
        </section>
      </aside>
    </div>

    <!-- Sprints row -->
    <section class="nl-card md__sprints">
      <header class="md__card-head">
        <h2><i class="pi pi-forward" /> Sprints en cours</h2>
        <RouterLink class="md__link" to="/app/team/sprints">Voir tous</RouterLink>
      </header>
      <div v-if="store.activeSprints.length === 0" class="md__empty md__empty--mini">
        <p>Aucun sprint actif sur tes projets pour l'instant.</p>
      </div>
      <div v-else class="md__sprint-grid">
        <SprintWidget
          v-for="s in store.activeSprints.slice(0, 3)"
          :key="s.sprint.id"
          :sprint="s"
          :project-name="s.projectName"
        />
      </div>
    </section>

    <!-- Projects row -->
    <section class="nl-card md__projects">
      <header class="md__card-head">
        <h2><i class="pi pi-briefcase" /> Mes projets</h2>
        <RouterLink class="md__link" to="/app/team/projects">Voir tous</RouterLink>
      </header>
      <div v-if="store.myProjects.length === 0" class="md__empty md__empty--mini">
        <p>Tu n'es membre d'aucun projet pour l'instant.</p>
      </div>
      <div v-else class="md__project-grid">
        <MemberProjectCard
          v-for="p in store.myProjects.slice(0, 6)"
          :key="p.id"
          :project="p"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { NeoButton, NeoMessage } from '@neolibrary/components'
import { useAuthStore } from '@/stores/authStore'
import { useMemberDashboardStore } from '@/stores/memberDashboardStore'
import { useNotificationStore } from '@/stores/notificationStore'
import TaskCard from '@/components/team/TaskCard.vue'
import SprintWidget from '@/components/team/SprintWidget.vue'
import MemberProjectCard from '@/components/team/MemberProjectCard.vue'
import type { MemberTaskCard } from '@/stores/memberDashboardStore'

const router = useRouter()
const auth = useAuthStore()
const store = useMemberDashboardStore()
const notifStore = useNotificationStore()

const firstName = computed<string>(() => {
  const full = auth.userFullName
  return full ? full.split(' ')[0] : 'Coéquipier(ère)'
})

const subtitle = computed<string>(() => {
  const total = store.todayTasks.length
  if (total === 0) return 'Aucune tâche urgente — bon travail !'
  if (total === 1) return '1 tâche prioritaire à traiter aujourd\'hui.'
  return `${total} tâches prioritaires à traiter aujourd'hui.`
})

const weekHoursLabel = computed<string>(() => {
  const t = store.weeklyTotals?.totalHours ?? 0
  return `${t.toFixed(1)} h`
})

const weekStartLabel = computed<string>(() => {
  const iso = store.weeklyTotals?.weekStart
  if (!iso) {
    const d = new Date()
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  }
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) }
  catch { return iso }
})

const ACTION_TYPES = new Set([
  'work_package_assigned',
  'wp_bulk_assigned',
  'wp_status_changed',
  'mention',
  'comment',
])
const recentNotifications = computed(() =>
  (notifStore.notifications ?? [])
    .filter((n) => !n.isRead && (ACTION_TYPES.has(n.type) || true))
    .slice(0, 5),
)

function onOpenTask(task: MemberTaskCard): void {
  void router.push({
    name: 'team-my-tasks',
    query: { projectId: task.project.id, ...(task.sprint ? { sprintId: task.sprint.id } : {}) },
  })
}

async function onTransition(task: MemberTaskCard, newStatus: string): Promise<void> {
  await store.transitionTask(task, newStatus)
}

function goToTime(): void { void router.push('/app/team/time') }
function openNotification(n: unknown): void {
  const link = (n as { link?: string | null }).link
  if (typeof link === 'string' && link.length > 0) void router.push(link)
  else void router.push('/app/team/inbox')
}

onMounted(() => {
  store.reset()
  void store.fetchAll()
  void notifStore.fetchNotifications().catch(() => undefined)
})
</script>

<style scoped>
.md { padding: 1.75rem; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }

.md__head { margin-bottom: 0.5rem; }
.md__eyebrow {
  font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--nl-text-3); margin: 0 0 0.25rem 0;
}
.md__title { margin: 0 0 0.25rem 0; font-size: 1.75rem; color: var(--nl-text-1); }
.md__subtitle { margin: 0; color: var(--nl-text-2); font-size: 0.9375rem; }

.nl-card {
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  padding: 1.25rem;
  display: flex; flex-direction: column; gap: 0.875rem;
}
.md__card-head { display: flex; align-items: center; justify-content: space-between; }
.md__card-head h2 {
  margin: 0; font-size: 1rem; font-weight: 600; color: var(--nl-text-1);
  display: inline-flex; align-items: center; gap: 0.5rem;
}
.md__card-head h2 i { color: var(--nl-accent, #1e9e8f); }
.md__link { font-size: 0.8125rem; color: var(--nl-accent); text-decoration: none; }
.md__link:hover { text-decoration: underline; }

.md__row { display: grid; gap: 1rem; }
.md__row--top { grid-template-columns: 2fr 1fr; }
@media (max-width: 1100px) { .md__row--top { grid-template-columns: 1fr; } }
.md__col { display: flex; flex-direction: column; gap: 1rem; }

.md__tasks { display: flex; flex-direction: column; gap: 0.5rem; }

.md__loading,
.md__empty {
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 0.5rem;
  padding: 2rem; color: var(--nl-text-3);
  text-align: center;
}
.md__empty--mini { padding: 1rem; }
.md__empty i { font-size: 1.5rem; color: var(--nl-success, #059669); }

.md__time { gap: 0.5rem; }
.md__time-value { font-size: 1.75rem; font-weight: 700; color: var(--nl-text-1); }
.md__time-hint { margin: 0 0 0.5rem 0; font-size: 0.75rem; color: var(--nl-text-3); }

.md__notif-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.md__notif-item {
  display: flex; flex-direction: column; gap: 0.15rem;
  padding: 0.5rem 0.75rem;
  border-left: 3px solid var(--nl-accent);
  background: var(--nl-surface-2, #fafafa);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}
.md__notif-item:hover { background: var(--nl-accent-light, #ecfdf5); }
.md__notif-title { font-size: 0.8125rem; font-weight: 600; color: var(--nl-text-1); }
.md__notif-msg {
  font-size: 0.75rem; color: var(--nl-text-3);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

.md__sprint-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.75rem; }
.md__project-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; }
</style>
