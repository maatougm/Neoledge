<template>
  <section class="ec">
    <header class="ec__head">
      <button class="ec__toggle" @click="collapsed = !collapsed">
        <i :class="collapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" />
      </button>
      <input
        class="ec__title"
        :value="epic.title"
        @input="emitUpdate({ title: ($event.target as HTMLInputElement).value })"
        placeholder="Titre de l'epic"
      />
      <select
        class="ec__select"
        :value="epic.priority"
        @change="emitUpdate({ priority: ($event.target as HTMLSelectElement).value as ProposedEpic['priority'] })"
      >
        <option value="Low">Low</option>
        <option value="Normal">Normal</option>
        <option value="High">High</option>
        <option value="Critical">Critical</option>
      </select>
      <input
        class="ec__hours"
        type="number"
        min="0"
        step="1"
        :value="epic.estimatedHours"
        @input="emitUpdate({ estimatedHours: Number(($event.target as HTMLInputElement).value) })"
      />
      <span class="ec__h-suffix">h</span>
      <span class="ec__count">{{ epic.children.length }} tâche{{ epic.children.length === 1 ? '' : 's' }}</span>
      <button class="ec__btn ec__btn--danger" @click="emit('remove')" title="Supprimer l'epic">
        <i class="pi pi-trash" />
      </button>
    </header>

    <div v-if="!collapsed" class="ec__body">
      <textarea
        class="ec__desc"
        :value="epic.description"
        @input="emitUpdate({ description: ($event.target as HTMLTextAreaElement).value })"
        placeholder="Description de l'epic"
        rows="2"
      />
      <TaskCard
        v-for="(t, ti) in epic.children"
        :key="ti"
        :task="t"
        :task-idx="ti"
        @update="(patch) => emit('update-task', ti, patch)"
        @remove="emit('remove-task', ti)"
      />
      <button class="ec__add" @click="emit('add-task')">
        <i class="pi pi-plus" /> Ajouter une tâche
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import TaskCard from './TaskCard.vue'
import type { ProposedEpic, ProposedTask } from '@/stores/backlogGeneratorStore'

defineProps<{ epic: ProposedEpic; epicIdx: number }>()
const emit = defineEmits<{
  (e: 'update', patch: Partial<ProposedEpic>): void
  (e: 'remove'): void
  (e: 'update-task', taskIdx: number, patch: Partial<ProposedTask>): void
  (e: 'remove-task', taskIdx: number): void
  (e: 'add-task'): void
}>()

const collapsed = ref(false)

function emitUpdate(patch: Partial<ProposedEpic>): void {
  emit('update', patch)
}
</script>

<style scoped>
.ec {
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  margin-bottom: 1rem;
  overflow: hidden;
}
.ec__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--nl-surface-2, #f3f4f6);
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
}
.ec__toggle {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0.25rem;
  color: var(--nl-text-muted, #6b7280);
}
.ec__title {
  flex: 1;
  border: 1px solid transparent;
  background: transparent;
  font-size: 1rem;
  font-weight: 600;
  padding: 0.375rem 0.5rem;
  border-radius: 4px;
}
.ec__title:hover, .ec__title:focus {
  border-color: var(--nl-border, #e5e7eb);
  background: #fff;
  outline: none;
}
.ec__select {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 4px;
  font-size: 0.875rem;
  background: #fff;
}
.ec__hours {
  width: 64px;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 4px;
  font-size: 0.875rem;
  text-align: right;
}
.ec__h-suffix { color: var(--nl-text-muted, #6b7280); font-size: 0.8125rem; margin-left: -0.25rem; }
.ec__count {
  font-size: 0.75rem;
  color: var(--nl-text-muted, #6b7280);
  white-space: nowrap;
  background: #fff;
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  border: 1px solid var(--nl-border, #e5e7eb);
}
.ec__btn {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0.375rem;
  border-radius: 4px;
  color: var(--nl-text-muted, #6b7280);
}
.ec__btn--danger:hover { background: #fee2e2; color: #dc2626; }
.ec__body {
  padding: 0.75rem 1rem 1rem;
}
.ec__desc {
  width: 100%;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  font-family: inherit;
  resize: vertical;
  margin-bottom: 0.75rem;
}
.ec__add {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.5rem;
  border: 1px dashed var(--nl-border, #d1d5db);
  background: transparent;
  color: var(--nl-text-muted, #6b7280);
  padding: 0.375rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.8125rem;
}
.ec__add:hover { color: var(--nl-accent, #1e9e8f); border-color: var(--nl-accent, #1e9e8f); }
</style>
