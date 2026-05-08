<!-- @file MemberTimeView.vue — Phase A skeleton; built out in Phase F. -->
<template>
  <div class="mtv">
    <h1 class="mtv__title">Mon temps</h1>
    <p class="mtv__placeholder">Le suivi du temps arrive en Phase F.</p>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.mtv { padding: 2rem; max-width: 1400px; margin: 0 auto; }
.mtv__title { margin: 0 0 1rem 0; }
.mtv__placeholder {
  padding: 2rem; border: 1px dashed var(--nl-border); border-radius: 8px;
  color: var(--nl-text-3);
}
</style>
