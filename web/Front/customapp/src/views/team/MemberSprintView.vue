<!-- @file MemberSprintView.vue — Member's personal kanban for one sprint.
     4 columns (À faire / En cours / En revue / Terminé) of THE MEMBER's
     own tasks. HTML5 native drag-drop with mandatory dragend reset to
     prevent the leak documented in CLAUDE.md.
     A teammates panel shows count-per-assignee for context. -->
<template>
  <div class="ms">
    <header class="ms__header">
      <button class="ms__back" type="button" @click="goBack">
        <i class="pi pi-arrow-left" /> Retour
      </button>
      <div class="ms__title-block">
        <p class="ms__eyebrow">Sprint</p>
        <h1 class="ms__title">{{ store.sprint?.name ?? 'Chargement…' }}</h1>
        <p v-if="store.sprint?.goal" class="ms__goal">{{ store.sprint.goal }}</p>
      </div>
      <div v-if="store.sprint" class="ms__meta">
        <span class="ms__chip"><i class="pi pi-calendar" /> {{ daysLeftLabel }}</span>
        <span class="ms__chip"><i class="pi pi-list" /> {{ store.myTasks.length }} tâche(s)</span>
      </div>
    </header>

    <NeoMessage v-if="store.error" severity="error" :text="store.error" class="mb-3" />

    <div class="ms__board">
      <div
        v-for="col in COLUMNS"
        :key="col.status"
        class="ms__col"
        @dragover.prevent
        @drop="onDrop(col.status)"
      >
        <header class="ms__col-head">
          <span class="ms__col-icon" :class="`ms__col-icon--${col.tone}`"><i :class="`pi ${col.icon}`" /></span>
          <h3>{{ col.label }}</h3>
          <span class="ms__col-count">{{ tasksFor(col.status).length }}</span>
        </header>
        <div class="ms__col-body">
          <div
            v-for="task in tasksFor(col.status)"
            :key="task.id"
            class="ms__card"
            draggable="true"
            @dragstart="onDragStart(task.id)"
            @dragend="draggingId = null"
            @click="goToTask(task)"
          >
            <span class="ms__card-priority" :class="`ms__card-priority--${task.priority.toLowerCase()}`" />
            <div class="ms__card-body">
              <p class="ms__card-title">{{ task.title }}</p>
              <p v-if="task.dueDate" class="ms__card-due">
                <i class="pi pi-clock" /> {{ formatDate(task.dueDate) }}
              </p>
            </div>
          </div>
          <div v-if="tasksFor(col.status).length === 0" class="ms__col-empty">
            <i class="pi pi-circle" />
            <span>Vide</span>
          </div>
        </div>
      </div>
    </div>

    <section class="ms__teammates">
      <header class="ms__teammates-head">
        <h2><i class="pi pi-users" /> Le reste de l'équipe sur ce sprint</h2>
      </header>
      <div v-if="store.teammates.length === 0" class="ms__col-empty">
        <span>Tu es seul(e) sur ce sprint.</span>
      </div>
      <ul v-else class="ms__teammates-list">
        <li v-for="t in store.teammates" :key="t.userId" class="ms__teammate">
          <span class="ms__teammate-avatar">{{ initials(t.fullName) }}</span>
          <span class="ms__teammate-name">{{ t.fullName }}</span>
          <span class="ms__teammate-count">{{ t.count }} tâche(s)</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NeoMessage, useNeoToast } from '@neolibrary/components'
import { useMemberSprintStore } from '@/stores/memberSprintStore'
import { useAuthStore } from '@/stores/authStore'
import type { MemberTaskCard } from '@/stores/memberDashboardStore'

const props = defineProps<{ projectId: string; sprintId: string }>()

const router = useRouter()
const toast = useNeoToast()
const auth = useAuthStore()
const store = useMemberSprintStore()

const draggingId = ref<string | null>(null)

const COLUMNS = [
  { status: 'New',            label: 'À faire',  icon: 'pi-list',         tone: 'info' },
  { status: 'InProgress',     label: 'En cours', icon: 'pi-spinner',      tone: 'warn' },
  { status: 'AwaitingReview', label: 'En revue', icon: 'pi-flag',         tone: 'warn' },
  { status: 'Resolved',       label: 'Terminé',  icon: 'pi-check-circle', tone: 'success' },
] as const

function tasksFor(status: string): MemberTaskCard[] {
  return store.myTasks.filter((t) => t.status === status)
}

function onDragStart(id: string): void { draggingId.value = id }

async function onDrop(targetStatus: string): Promise<void> {
  const id = draggingId.value
  draggingId.value = null
  if (!id) return
  const task = store.myTasks.find((t) => t.id === id)
  if (!task) return
  if (task.status === targetStatus) return
  const ok = await store.transition(props.projectId, id, targetStatus)
  if (!ok) toast.add({ severity: 'error', detail: 'Mise à jour échouée.', life: 3000 })
}

function goBack(): void {
  void router.push({ name: 'team-project-detail', params: { id: props.projectId } })
}
function goToTask(task: MemberTaskCard): void {
  void router.push({ name: 'team-my-tasks', query: { projectId: task.project.id, sprintId: props.sprintId } })
}

const daysLeftLabel = computed<string>(() => {
  if (!store.sprint?.endDate) return '—'
  try {
    const days = Math.ceil((new Date(store.sprint.endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    return days >= 0 ? `J−${days}` : `J+${-days} (en retard)`
  } catch { return '—' }
})

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) }
  catch { return iso }
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

onMounted(async () => {
  store.reset()
  await store.load(props.projectId, props.sprintId, auth.userId ?? '')
})
</script>

<style scoped>
.ms { padding: 1.75rem; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }

.ms__header {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
}
.ms__back {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--nl-border); border-radius: 6px;
  background: transparent; color: var(--nl-text-2);
  font-size: 0.8125rem; cursor: pointer;
}
.ms__back:hover { border-color: var(--nl-accent); color: var(--nl-accent); }
.ms__title-block { flex: 1; min-width: 0; }
.ms__eyebrow {
  margin: 0; font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--nl-text-3);
}
.ms__title { margin: 0; font-size: 1.4rem; color: var(--nl-text-1); }
.ms__goal {
  margin: 0.2rem 0 0 0; font-size: 0.8125rem; color: var(--nl-text-2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ms__meta { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.ms__chip {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.25rem 0.65rem; border-radius: 999px;
  background: var(--nl-surface-2, #f3f4f6);
  color: var(--nl-text-2);
  font-size: 0.75rem;
}

.ms__board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; min-height: 320px; }
@media (max-width: 1100px) { .ms__board { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 700px)  { .ms__board { grid-template-columns: 1fr; } }

.ms__col {
  display: flex; flex-direction: column;
  background: var(--nl-surface-2, #fafafa);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  min-height: 320px;
}
.ms__col-head {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.65rem 0.85rem;
  border-bottom: 1px solid var(--nl-border);
}
.ms__col-head h3 { margin: 0; font-size: 0.875rem; font-weight: 600; flex: 1; color: var(--nl-text-1); }
.ms__col-icon {
  width: 22px; height: 22px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.6875rem;
}
.ms__col-icon--info    { background: var(--nl-info-light, #dbeafe); color: var(--nl-info, #2563eb); }
.ms__col-icon--warn    { background: var(--nl-warn-bg, #fef3c7); color: var(--nl-warn-fg, #d97706); }
.ms__col-icon--success { background: var(--nl-accent-light, #ecfdf5); color: var(--nl-success, #059669); }
.ms__col-count {
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 999px;
  padding: 0.1rem 0.55rem;
  font-size: 0.75rem; font-weight: 600;
}
.ms__col-body { flex: 1; padding: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; }
.ms__col-empty {
  margin: auto; padding: 1rem;
  display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
  font-size: 0.75rem; color: var(--nl-text-3);
}

.ms__card {
  display: flex; gap: 0.5rem;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  padding: 0.55rem 0.65rem;
  cursor: grab;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ms__card:hover { border-color: var(--nl-accent); box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
.ms__card:active { cursor: grabbing; }
.ms__card-priority { width: 4px; border-radius: 2px; flex-shrink: 0; }
.ms__card-priority--critical { background: var(--nl-danger, #dc2626); }
.ms__card-priority--high     { background: var(--nl-warn, #d97706); }
.ms__card-priority--normal   { background: var(--nl-info, #2563eb); }
.ms__card-priority--low      { background: var(--nl-text-3, #9ca3af); }
.ms__card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.ms__card-title {
  margin: 0; font-size: 0.8125rem; font-weight: 600; color: var(--nl-text-1);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ms__card-due { margin: 0; font-size: 0.6875rem; color: var(--nl-text-3); }

.ms__teammates {
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  display: flex; flex-direction: column; gap: 0.5rem;
}
.ms__teammates-head { display: flex; align-items: center; }
.ms__teammates-head h2 {
  margin: 0; font-size: 0.9375rem; font-weight: 600;
  display: inline-flex; align-items: center; gap: 0.5rem; color: var(--nl-text-1);
}
.ms__teammates-head h2 i { color: var(--nl-accent); }
.ms__teammates-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.ms__teammate { display: flex; align-items: center; gap: 0.6rem; font-size: 0.8125rem; }
.ms__teammate-avatar {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--nl-accent, #1e9e8f); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-weight: 600; font-size: 0.75rem;
}
.ms__teammate-name { flex: 1; color: var(--nl-text-1); font-weight: 500; }
.ms__teammate-count { color: var(--nl-text-3); font-size: 0.75rem; }
</style>
