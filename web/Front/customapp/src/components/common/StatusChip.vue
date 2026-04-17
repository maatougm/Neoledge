<!-- @file src/components/common/StatusChip.vue — Compact work-package status chip. -->
<template>
  <span class="chip" :style="{ color, background, borderColor: color + '33' }">
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ status: string }>()

const MAP: Record<string, { label: string; color: string; background: string }> = {
  New:          { label: 'Nouveau',       color: '#6B7280', background: '#F4F4F5' },
  InProgress:   { label: 'En cours',      color: '#0F62FE', background: '#EFF4FF' },
  Resolved:     { label: 'Résolu',        color: '#10B981', background: '#ECFDF5' },
  Closed:       { label: 'Clôturé',       color: '#71717A', background: '#F4F4F5' },
  OnHold:       { label: 'En pause',      color: '#F59E0B', background: '#FFFBEB' },
  Blocked:      { label: 'Bloqué',        color: '#DC2626', background: '#FEF2F2' },
}

const entry = computed(() => MAP[props.status] ?? { label: props.status, color: '#6B7280', background: '#F4F4F5' })
const label      = computed(() => entry.value.label)
const color      = computed(() => entry.value.color)
const background = computed(() => entry.value.background)
</script>

<style scoped>
.chip {
  display: inline-flex; align-items: center;
  padding: 1px 7px;
  font-size: var(--nl-fs-xs); font-weight: 500;
  border-radius: var(--nl-radius-pill);
  border: 1px solid;
  line-height: 1.6; white-space: nowrap;
}
</style>
