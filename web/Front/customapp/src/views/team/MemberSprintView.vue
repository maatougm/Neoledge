<!-- @file MemberSprintView.vue — Phase A skeleton; built out in Phase D. -->
<template>
  <div class="ms">
    <h1 class="ms__title">Sprint</h1>
    <p class="ms__placeholder">La vue sprint membre arrive en Phase D (project={{ projectId }}, sprint={{ sprintId }}).</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ projectId: string; sprintId: string }>()
</script>

<style scoped>
.ms { padding: 2rem; max-width: 1400px; margin: 0 auto; }
.ms__title { margin: 0 0 1rem 0; }
.ms__placeholder {
  padding: 2rem; border: 1px dashed var(--nl-border); border-radius: 8px;
  color: var(--nl-text-3);
}
</style>
