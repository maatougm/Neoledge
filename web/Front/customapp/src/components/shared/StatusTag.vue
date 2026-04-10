<!--
  @file     StatusTag.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Unified pill-shaped status tag with per-status color mapping
-->
<template>
  <span :class="['status-tag', `status-tag--${size}`, colorClass]" role="status" :aria-label="label">
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PROJECT_STATUS_LABELS } from '@/types/project.types'
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

type StatusColorKey =
  | 'Draft'
  | 'InProgress'
  | 'SpecificationValidation'
  | 'Realization'
  | 'DeploymentValidation'
  | 'Completed'
  | 'Archived'

const colorClass = computed(() => {
  const map: Record<string, string> = {
    Draft:                   'status-tag--draft',
    InProgress:              'status-tag--in-progress',
    SpecificationValidation: 'status-tag--spec-validation',
    Realization:             'status-tag--realization',
    DeploymentValidation:    'status-tag--deploy-validation',
    Completed:               'status-tag--completed',
    Archived:                'status-tag--archived',
  }
  return map[props.status] ?? 'status-tag--draft'
})
</script>

<style scoped>
/* ── Base pill ──────────────────────────────────────────────────────────────── */
.status-tag {
  display: inline-flex;
  align-items: center;
  border-radius: var(--nl-radius-pill, 9999px);
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
  white-space: nowrap;
  font-family: var(--nl-font, Inter, system-ui, sans-serif);
}

.status-tag--small {
  font-size: 11px;
  padding: 1px 8px;
}

/* ── Color variants ─────────────────────────────────────────────────────────── */
.status-tag--draft {
  background: #F4F4F5;
  color: #71717A;
}

.status-tag--in-progress {
  background: #EFF4FF;
  color: #0F62FE;
}

.status-tag--spec-validation {
  background: #F5F3FF;
  color: #7C3AED;
}

.status-tag--realization {
  background: #FFF7ED;
  color: #D97706;
}

.status-tag--deploy-validation {
  background: #F0FDFA;
  color: #0D9488;
}

.status-tag--completed {
  background: #F0FDF4;
  color: #16A34A;
}

.status-tag--archived {
  background: #F4F4F5;
  color: #A1A1AA;
}
</style>
