<!-- @file src/components/common/StatusChip.vue — Compact work-package status chip. -->
<template>
  <span class="chip" :style="{ color, background, borderColor: color + '33' }">
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getWpStatus } from '@/lib/wpStatusMap'

const props = defineProps<{ status: string }>()

const entry      = computed(() => getWpStatus(props.status))
const label      = computed(() => entry.value.label || props.status)
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
