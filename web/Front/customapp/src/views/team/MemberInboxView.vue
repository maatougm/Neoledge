<!-- @file MemberInboxView.vue — Phase A skeleton; built out in Phase F. -->
<template>
  <div class="mi">
    <h1 class="mi__title">Notifications</h1>
    <p class="mi__placeholder">La boîte de réception arrive en Phase F.</p>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.mi { padding: 2rem; max-width: 1400px; margin: 0 auto; }
.mi__title { margin: 0 0 1rem 0; }
.mi__placeholder {
  padding: 2rem; border: 1px dashed var(--nl-border); border-radius: 8px;
  color: var(--nl-text-3);
}
</style>
