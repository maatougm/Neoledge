<!-- @file TaskCard.vue — reusable Member task row. -->
<template>
  <div class="tc" :class="`tc--${priorityClass}`">
    <div class="tc__main" @click="onOpen">
      <div class="tc__top">
        <NeoTag :value="STATUS_LABEL[task.status] ?? task.status" :severity="statusSeverity" />
        <span class="tc__type">{{ TYPE_LABEL[task.type] ?? task.type }}</span>
        <span v-if="dueLabel" class="tc__due" :class="{ 'tc__due--overdue': overdue }">
          <i class="pi pi-clock" /> {{ dueLabel }}
        </span>
      </div>
      <h3 class="tc__title">{{ task.title }}</h3>
      <div class="tc__meta">
        <span class="tc__project"><i class="pi pi-briefcase" /> {{ task.project.name }}</span>
        <span v-if="task.sprint" class="tc__sprint"><i class="pi pi-forward" /> {{ task.sprint.name }}</span>
        <span v-if="task.estimatedHours" class="tc__hours">{{ task.estimatedHours }} h estimées</span>
      </div>
    </div>
    <div v-if="!compact" class="tc__actions">
      <NeoButton
        v-if="task.status === 'New'"
        label="Démarrer"
        icon="pi pi-play"
        size="small"
        :loading="busy"
        @click="onStart"
      />
      <NeoButton
        v-else-if="task.status === 'InProgress'"
        label="À valider"
        icon="pi pi-flag"
        severity="secondary"
        outlined
        size="small"
        :loading="busy"
        @click="onReview"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NeoTag, NeoButton } from '@neolibrary/components'
import type { MemberTaskCard } from '@/stores/memberDashboardStore'

const props = defineProps<{ task: MemberTaskCard; compact?: boolean }>()
const emit = defineEmits<{
  open: [task: MemberTaskCard]
  transition: [task: MemberTaskCard, newStatus: string]
}>()

const busy = ref(false)

const STATUS_LABEL: Record<string, string> = {
  New: 'À faire',
  InProgress: 'En cours',
  AwaitingReview: 'En revue',
  Resolved: 'Résolu',
  Closed: 'Fermé',
}
const TYPE_LABEL: Record<string, string> = {
  Task: 'Tâche',
  Feature: 'Fonctionnalité',
  Bug: 'Bug',
  Epic: 'Epic',
}

const statusSeverity = computed<'info' | 'success' | 'warn' | 'secondary'>(() => {
  switch (props.task.status) {
    case 'New':            return 'info'
    case 'InProgress':     return 'warn'
    case 'AwaitingReview': return 'warn'
    case 'Resolved':
    case 'Closed':         return 'success'
    default:               return 'secondary'
  }
})

const priorityClass = computed<string>(() => {
  const p = props.task.priority
  if (p === 'Critical') return 'critical'
  if (p === 'High')     return 'high'
  if (p === 'Low')      return 'low'
  return 'normal'
})

const dueLabel = computed<string | null>(() => {
  if (!props.task.dueDate) return null
  try {
    const d = new Date(props.task.dueDate)
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  } catch {
    return null
  }
})

const overdue = computed<boolean>(() => {
  if (!props.task.dueDate) return false
  try {
    return new Date(props.task.dueDate).getTime() < Date.now()
  } catch {
    return false
  }
})

function onOpen(): void { emit('open', props.task) }
async function onStart(): Promise<void> {
  busy.value = true
  emit('transition', props.task, 'InProgress')
  setTimeout(() => { busy.value = false }, 300)
}
async function onReview(): Promise<void> {
  busy.value = true
  emit('transition', props.task, 'AwaitingReview')
  setTimeout(() => { busy.value = false }, 300)
}
</script>

<style scoped>
.tc {
  display: flex; align-items: stretch; gap: 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  background: var(--nl-card-bg, #fff);
  border-left-width: 3px;
  transition: box-shadow 0.15s, transform 0.15s;
}
.tc:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
.tc--critical { border-left-color: var(--nl-danger, #dc2626); }
.tc--high     { border-left-color: var(--nl-warn, #d97706); }
.tc--normal   { border-left-color: var(--nl-info, #2563eb); }
.tc--low      { border-left-color: var(--nl-text-3, #9ca3af); }

.tc__main { flex: 1; cursor: pointer; min-width: 0; }
.tc__top {
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em;
  margin-bottom: 0.4rem;
}
.tc__type { color: var(--nl-text-3); }
.tc__due { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--nl-text-2); }
.tc__due--overdue { color: var(--nl-danger, #dc2626); font-weight: 600; }
.tc__title {
  margin: 0 0 0.4rem 0; font-size: 0.9375rem; font-weight: 600;
  color: var(--nl-text-1);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tc__meta {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  font-size: 0.75rem; color: var(--nl-text-3);
}
.tc__meta i { margin-right: 0.25rem; }
.tc__actions { display: flex; align-items: center; gap: 0.5rem; }
</style>
