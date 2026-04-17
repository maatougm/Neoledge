<!-- @file src/components/common/PriorityDot.vue — Colored dot indicating WP priority -->
<template>
  <span class="priority-dot" :class="`priority-dot--${(priority || 'normal').toLowerCase()}`" :title="priority || 'Normal'" />
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
.priority-dot--low       { background: #10b981; }
.priority-dot--normal    { background: #3b82f6; }
.priority-dot--high      { background: #f59e0b; }
.priority-dot--urgent    { background: #ef4444; }
.priority-dot--immediate { background: #dc2626; }
</style>
