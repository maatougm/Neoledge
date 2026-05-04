<template>
  <div class="tc">
    <NeoTag :value="task.type" :severity="typeSev" />
    <input
      class="tc__title"
      :value="task.title"
      @input="emitUpdate({ title: ($event.target as HTMLInputElement).value })"
      placeholder="Titre de la tâche"
    />
    <select
      class="tc__select"
      :value="task.priority"
      @change="emitUpdate({ priority: ($event.target as HTMLSelectElement).value as ProposedTask['priority'] })"
    >
      <option value="Low">Low</option>
      <option value="Normal">Normal</option>
      <option value="High">High</option>
      <option value="Critical">Critical</option>
    </select>
    <select
      class="tc__select tc__select--type"
      :value="task.type"
      @change="emitUpdate({ type: ($event.target as HTMLSelectElement).value as ProposedTask['type'] })"
    >
      <option value="Task">Task</option>
      <option value="Feature">Feature</option>
      <option value="Bug">Bug</option>
    </select>
    <input
      class="tc__hours"
      type="number"
      min="0"
      step="0.5"
      :value="task.estimatedHours"
      @input="emitUpdate({ estimatedHours: Number(($event.target as HTMLInputElement).value) })"
    />
    <span class="tc__h-suffix">h</span>
    <button class="tc__btn tc__btn--danger" @click="emit('remove')" title="Supprimer la tâche">
      <i class="pi pi-trash" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NeoTag } from '@neolibrary/components'
import type { ProposedTask } from '@/stores/backlogGeneratorStore'

const props = defineProps<{ task: ProposedTask; taskIdx: number }>()
const emit = defineEmits<{
  (e: 'update', patch: Partial<ProposedTask>): void
  (e: 'remove'): void
}>()

const typeSev = computed<'info' | 'success' | 'danger'>(() => {
  if (props.task.type === 'Feature') return 'success'
  if (props.task.type === 'Bug') return 'danger'
  return 'info'
})

function emitUpdate(patch: Partial<ProposedTask>): void {
  emit('update', patch)
}
</script>

<style scoped>
.tc {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 6px;
  margin: 0.375rem 0;
}
.tc__title {
  flex: 1;
  border: 1px solid transparent;
  background: transparent;
  font-size: 0.875rem;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}
.tc__title:hover, .tc__title:focus {
  border-color: var(--nl-border, #e5e7eb);
  background: var(--nl-bg, #f9fafb);
  outline: none;
}
.tc__select {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 4px;
  font-size: 0.8125rem;
  background: #fff;
}
.tc__select--type { min-width: 84px; }
.tc__hours {
  width: 60px;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 4px;
  font-size: 0.8125rem;
  text-align: right;
}
.tc__h-suffix { color: var(--nl-text-muted, #6b7280); font-size: 0.8125rem; margin-left: -0.25rem; }
.tc__btn {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0.375rem;
  border-radius: 4px;
  color: var(--nl-text-muted, #6b7280);
}
.tc__btn--danger:hover { background: #fee2e2; color: #dc2626; }
</style>
