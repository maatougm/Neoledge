<template>
  <div class="stepper">
    <div
      v-for="(phase, i) in PHASES"
      :key="phase.key"
      :class="['step', stepState(phase.key)]"
    >
      <div class="step-connector" v-if="i > 0" />
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

const PHASES: { key: ProjectStatus; label: string }[] = [
  { key: 'Draft',                  label: 'Brouillon' },
  { key: 'InProgress',             label: 'En cours' },
  { key: 'SpecificationValidation',label: 'Questionnaire' },
  { key: 'Realization',            label: 'Réalisation' },
  { key: 'DeploymentValidation',   label: 'Validation' },
  { key: 'Completed',              label: 'Terminé' },
]

const ORDER: Record<ProjectStatus, number> = {
  Draft: 0, InProgress: 1, SpecificationValidation: 2,
  Realization: 3, DeploymentValidation: 4, Completed: 5, Archived: 6,
}

const stepState = (key: ProjectStatus) => {
  const cur = ORDER[props.status] ?? 0
  const idx = ORDER[key] ?? 0
  if (idx < cur)  return 'done'
  if (idx === cur) return 'active'
  return 'pending'
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
}

.step-connector {
  position: absolute;
  top: 14px;
  right: 50%;
  width: 100%;
  height: 2px;
  background: #e5e7eb;
  z-index: 0;
}
.step.done  .step-connector,
.step.active .step-connector { background: #0d9488; }

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
  background: #e5e7eb;
  color: #9ca3af;
  border: 2px solid #e5e7eb;
  transition: all 0.2s;
}
.step.done   .step-circle { background: #0d9488; color: #fff; border-color: #0d9488; }
.step.active .step-circle { background: #fff; color: #0d9488; border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13,148,136,0.15); }

.step-label {
  font-size: 0.72rem;
  color: #9ca3af;
  margin-top: 0.4rem;
  text-align: center;
  line-height: 1.2;
}
.step.active .step-label { color: #0d9488; font-weight: 600; }
.step.done   .step-label { color: #374151; }
</style>
