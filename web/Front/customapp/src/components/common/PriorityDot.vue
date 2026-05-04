<!-- @file src/components/common/PriorityDot.vue — Colored dot indicating WP priority -->
<template>
  <span class="priority-dot" :class="`priority-dot--${(priority || 'medium').toLowerCase()}`" :title="priority || 'Medium'" />
</template>

<script setup lang="ts">
defineProps<{ priority?: string }>()
</script>

<style scoped>
.priority-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
/* Aligned with filter.types.ts: Low | Medium | High | Critical (#24) */
.priority-dot--low      { background: #10b981; }
.priority-dot--medium   { background: #3b82f6; }
.priority-dot--high     { background: #f59e0b; }
.priority-dot--critical { background: #dc2626; }
</style>
