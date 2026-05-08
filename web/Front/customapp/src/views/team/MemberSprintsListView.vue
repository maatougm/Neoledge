<!-- @file MemberSprintsListView.vue — Phase A skeleton; built out in Phase F. -->
<template>
  <div class="msl">
    <h1 class="msl__title">Sprints actifs</h1>
    <p class="msl__placeholder">La liste arrive en Phase F.</p>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.msl { padding: 2rem; max-width: 1400px; margin: 0 auto; }
.msl__title { margin: 0 0 1rem 0; }
.msl__placeholder {
  padding: 2rem; border: 1px dashed var(--nl-border); border-radius: 8px;
  color: var(--nl-text-3);
}
</style>
