<template>
  <div class="stepper">
    <div
      v-for="(phase, i) in PHASES"
      :key="phase.key"
      :class="['step', stepState(phase.key), { clickable: isAdjacent(phase.key) }]"
      :title="phase.label"
      @click="handleClick(phase.key)"
    >
      <div v-if="i > 0" class="step-connector" />
      <div class="step-circle">
        <i v-if="stepState(phase.key) === 'done'" class="pi pi-check" />
        <span v-else>{{ i + 1 }}</span>
      </div>
      <span class="step-label">{{ phase.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ProjectStatus } from '@/types/project.types'

const props = defineProps<{ status: ProjectStatus }>()
const emit = defineEmits<{ 'change-status': [newStatus: ProjectStatus] }>()

const PHASES: readonly { key: ProjectStatus; label: string }[] = [
  { key: 'Draft',       label: 'Brouillon' },
  { key: 'Kickoff',     label: 'Lancement' },
  { key: 'Realisation', label: 'Réalisation' },
  { key: 'Cloture',     label: 'Clôture' },
]

const ORDER: Record<ProjectStatus, number> = {
  Draft: 0, Kickoff: 1, Realisation: 2, Cloture: 3, Archived: 4,
}

const stepState = (key: ProjectStatus): 'done' | 'active' | 'pending' => {
  const cur = ORDER[props.status] ?? 0
  const idx = ORDER[key] ?? 0
  if (idx < cur) return 'done'
  if (idx === cur) return 'active'
  return 'pending'
}

const isAdjacent = (key: ProjectStatus): boolean => {
  const cur = ORDER[props.status] ?? 0
  const idx = ORDER[key] ?? 0
  return Math.abs(idx - cur) === 1
}

const handleClick = (key: ProjectStatus): void => {
  if (isAdjacent(key)) {
    emit('change-status', key)
  }
}
</script>

<style scoped>
.stepper {
  display: flex;
  align-items: flex-start;
  gap: 0;
  overflow-x: auto;
  padding: 0.5rem 0 1rem;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 80px;
  position: relative;
  cursor: default;
}

.step.clickable {
  cursor: pointer;
}
.step.clickable:hover .step-circle {
  transform: scale(1.12);
  box-shadow: 0 0 0 4px rgba(13, 148, 136, 0.18);
}
.step.clickable:hover .step-label {
  color: var(--nl-accent);
}

.step-connector {
  position: absolute;
  top: 14px;
  right: 50%;
  width: 100%;
  height: 2px;
  background: var(--nl-border);
  z-index: 0;
}
.step.done  .step-connector,
.step.active .step-connector { background: var(--nl-accent); }

.step-circle {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  position: relative;
  z-index: 1;
  background: var(--nl-border);
  color: var(--nl-text-3);
  border: 2px solid var(--nl-border);
  transition: all 0.2s;
}
.step.done   .step-circle { background: var(--nl-accent); color: #fff; border-color: var(--nl-accent); }
.step.active .step-circle { background: var(--nl-surface); color: var(--nl-accent); border-color: var(--nl-accent); box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.15); }
.step.pending .step-circle { opacity: 0.5; }

.step-label {
  font-size: 0.72rem;
  color: var(--nl-text-3);
  margin-top: 0.4rem;
  text-align: center;
  line-height: 1.2;
  transition: color 0.15s;
}
.step.active  .step-label { color: var(--nl-accent); font-weight: 600; }
.step.done    .step-label { color: var(--nl-text-2); }
.step.pending .step-label { opacity: 0.5; }
</style>
