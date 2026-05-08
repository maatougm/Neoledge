<!-- @file MemberProjectView.vue — Phase A skeleton; built out in Phase E. -->
<template>
  <div class="mp">
    <h1 class="mp__title">Projet</h1>
    <p class="mp__placeholder">La vue projet membre arrive en Phase E (id={{ id }}).</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ id: string }>()
</script>

<style scoped>
.mp { padding: 2rem; max-width: 1400px; margin: 0 auto; }
.mp__title { margin: 0 0 1rem 0; }
.mp__placeholder {
  padding: 2rem; border: 1px dashed var(--nl-border); border-radius: 8px;
  color: var(--nl-text-3);
}
</style>
