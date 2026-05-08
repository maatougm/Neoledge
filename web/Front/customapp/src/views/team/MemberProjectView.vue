<!-- @file MemberProjectView.vue — Member-tuned per-project view.
     Removes everything PM-only (questionnaire, validation, settings).
     Pinned "Mes tâches sur ce projet" + tabs for Cahier / Comments / Activity. -->
<template>
  <div class="mp">
    <header class="mp__header">
      <button class="mp__back" type="button" @click="goBack">
        <i class="pi pi-arrow-left" /> Mes projets
      </button>
      <div class="mp__title-block">
        <p class="mp__client">{{ project?.clientName ?? '—' }}</p>
        <h1 class="mp__title">{{ project?.name ?? 'Chargement…' }}</h1>
      </div>
      <div v-if="project" class="mp__header-right">
        <NeoTag :value="PROJECT_STATUS_LABELS[project.status] ?? project.status" :severity="statusSeverity" />
      </div>
    </header>

    <section class="mp__my-tasks nl-card">
      <header class="mp__card-head">
        <h2><i class="pi pi-bolt" /> Mes tâches sur ce projet</h2>
        <RouterLink :to="`/app/team/my-tasks?projectId=${id}`" class="mp__link">
          Tout voir <i class="pi pi-arrow-right" />
        </RouterLink>
      </header>
      <div v-if="myTasks.length === 0" class="mp__empty">
        <i class="pi pi-check-circle" />
        <p>Aucune tâche assignée sur ce projet.</p>
      </div>
      <div v-else class="mp__tasks">
        <TaskCard
          v-for="task in myTasks.slice(0, 5)"
          :key="task.id"
          :task="task"
          compact
          @open="onOpenTask"
          @transition="onTransition"
        />
      </div>
    </section>

    <nav class="mp__tabs" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.value"
        role="tab"
        :aria-selected="activeTab === t.value"
        class="mp__tab"
        :class="{ 'mp__tab--active': activeTab === t.value }"
        @click="activeTab = t.value"
      >
        <i :class="`pi ${t.icon}`" />
        {{ t.label }}
      </button>
    </nav>

    <div class="mp__body">
      <CahierDesChargesSection v-if="activeTab === 'cahier'" :project-id="id" />
      <CommentsSection         v-else-if="activeTab === 'comments'" :project-id="id" />
      <ActivityFeed            v-else-if="activeTab === 'activity'" :activities="activities" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { NeoTag } from '@neolibrary/components'
import api from '@/lib/api'
import TaskCard from '@/components/team/TaskCard.vue'
import CahierDesChargesSection from '@/components/pm/CahierDesChargesSection.vue'
import CommentsSection from '@/components/pm/CommentsSection.vue'
import ActivityFeed from '@/components/pm/ActivityFeed.vue'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { MemberTaskCard } from '@/stores/memberDashboardStore'
import type { ProjectActivity, ProjectStatus } from '@/types/project.types'

const props = defineProps<{ id: string }>()
const router = useRouter()

interface ProjectDetail {
  id: string
  name: string
  clientName: string
  status: ProjectStatus
}

const project = ref<ProjectDetail | null>(null)
const myTasks = ref<MemberTaskCard[]>([])
const activities = ref<ProjectActivity[]>([])
const activeTab = ref<'cahier' | 'comments' | 'activity'>('cahier')

const TABS = [
  { value: 'cahier'   as const, label: 'Cahier des charges', icon: 'pi-file-word' },
  { value: 'comments' as const, label: 'Commentaires',       icon: 'pi-comments' },
  { value: 'activity' as const, label: 'Activité',           icon: 'pi-history' },
]

const statusSeverity = computed(() =>
  project.value
    ? (PROJECT_STATUS_SEVERITY[project.value.status] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast')
    : 'secondary',
)

function goBack(): void { void router.push({ name: 'team-projects' }) }

function onOpenTask(task: MemberTaskCard): void {
  void router.push({
    name: 'team-my-tasks',
    query: { projectId: task.project.id, ...(task.sprint ? { sprintId: task.sprint.id } : {}) },
  })
}

async function onTransition(task: MemberTaskCard, newStatus: string): Promise<void> {
  const before = task.status
  task.status = newStatus
  try {
    await api.patch(`/pm/projects/${task.project.id}/work-packages/${task.id}`, { status: newStatus })
    if (newStatus === 'Resolved' || newStatus === 'Closed') {
      myTasks.value = myTasks.value.filter((t) => t.id !== task.id)
    }
  } catch {
    task.status = before
  }
}

async function load(): Promise<void> {
  try {
    const { data } = await api.get<ProjectDetail>(`/pm/projects/${props.id}`)
    project.value = data
  } catch { /* fallback in header */ }

  try {
    const { data } = await api.get<{ items: MemberTaskCard[] }>(
      `/pm/my-tasks?projectId=${props.id}&limit=50`,
    )
    myTasks.value = (data.items ?? []).filter(
      (t) => t.status === 'New' || t.status === 'InProgress' || t.status === 'AwaitingReview',
    )
  } catch { myTasks.value = [] }

  try {
    const { data } = await api.get<ProjectActivity[]>(`/pm/projects/${props.id}/activity`)
    activities.value = Array.isArray(data) ? data : []
  } catch { activities.value = [] }
}

onMounted(() => { void load() })
</script>

<style scoped>
.mp { padding: 1.75rem; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }

.mp__header {
  display: flex; align-items: center; gap: 1rem;
  flex-wrap: wrap;
}
.mp__back {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--nl-border); border-radius: 6px;
  background: transparent;
  color: var(--nl-text-2);
  font-size: 0.8125rem;
  cursor: pointer;
}
.mp__back:hover { border-color: var(--nl-accent); color: var(--nl-accent); }
.mp__title-block { flex: 1; min-width: 0; }
.mp__client {
  margin: 0;
  font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--nl-text-3);
}
.mp__title { margin: 0; font-size: 1.5rem; color: var(--nl-text-1); }
.mp__header-right { display: flex; align-items: center; gap: 0.5rem; }

.nl-card {
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  padding: 1.25rem;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.mp__card-head { display: flex; align-items: center; justify-content: space-between; }
.mp__card-head h2 {
  margin: 0; font-size: 1rem; font-weight: 600;
  display: inline-flex; align-items: center; gap: 0.5rem; color: var(--nl-text-1);
}
.mp__card-head h2 i { color: var(--nl-accent); }
.mp__link {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-size: 0.8125rem; color: var(--nl-accent); text-decoration: none;
}
.mp__link:hover { text-decoration: underline; }
.mp__tasks { display: flex; flex-direction: column; gap: 0.5rem; }
.mp__empty {
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 0.4rem;
  padding: 1rem; color: var(--nl-text-3); text-align: center;
}
.mp__empty i { color: var(--nl-success); font-size: 1.25rem; }

.mp__tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--nl-border); }
.mp__tab {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.6rem 1rem;
  border: none; border-bottom: 2px solid transparent;
  background: transparent;
  font-size: 0.875rem; font-weight: 500;
  color: var(--nl-text-3);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.mp__tab:hover { color: var(--nl-text-1); }
.mp__tab--active { color: var(--nl-accent); border-bottom-color: var(--nl-accent); }

.mp__body {
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  min-height: 300px;
  padding: 1rem;
}
</style>
