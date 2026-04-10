<!--
  @file     StatusTag.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Maps ProjectStatus string to NeoTag severity + French label with colored dot
-->
<template>
  <NeoTag :value="label" :severity="severity" :class="['status-tag', `status-tag--${size}`]">
    <template #default>
      <span class="status-dot" :class="`status-dot--${severity}`" aria-hidden="true" />
      {{ label }}
    </template>
  </NeoTag>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NeoTag } from '@neolibrary/components'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'

interface Props {
  status: string
  size?: 'small' | 'normal'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'normal',
})

const label = computed(
  () => PROJECT_STATUS_LABELS[props.status as ProjectStatus] ?? props.status,
)

type NeoTagSeverity = 'primary' | 'secondary' | 'success' | 'info' | 'warn' | 'danger' | 'contrast'
const severity = computed(
  () => (PROJECT_STATUS_SEVERITY[props.status as ProjectStatus] ?? 'secondary') as NeoTagSeverity,
)
</script>

<style scoped>
.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.status-tag--small {
  font-size: 0.7rem;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot--success   { background: var(--nl-success); }
.status-dot--info      { background: var(--nl-accent); }
.status-dot--warn      { background: var(--nl-warning); }
.status-dot--danger    { background: var(--nl-danger); }
.status-dot--secondary { background: var(--nl-text-3); }
.status-dot--contrast  { background: var(--nl-text-1); }
</style>
