<!-- @file MemberDashboardView.vue — Phase A skeleton; built out in Phase B. -->
<template>
  <div class="md">
    <header class="md__head">
      <p class="md__eyebrow">Espace équipe</p>
      <h1 class="md__title">Bonjour {{ firstName }}</h1>
      <p class="md__subtitle">Voici ce qui t'attend aujourd'hui.</p>
    </header>
    <div class="md__placeholder">
      <i class="pi pi-clock" />
      <p>Le tableau de bord membre arrive en Phase B.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/authStore'

const auth = useAuthStore()
const firstName = computed<string>(() => {
  const full = auth.userFullName
  return full ? full.split(' ')[0] : 'Coéquipier(ère)'
})
</script>

<style scoped>
.md { padding: 2rem; max-width: 1400px; margin: 0 auto; }
.md__head { margin-bottom: 1.5rem; }
.md__eyebrow {
  font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--nl-text-3); margin: 0 0 0.25rem 0;
}
.md__title { margin: 0 0 0.25rem 0; font-size: 1.75rem; color: var(--nl-text-1); }
.md__subtitle { margin: 0; color: var(--nl-text-2); }
.md__placeholder {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 2rem; border: 1px dashed var(--nl-border); border-radius: 8px;
  color: var(--nl-text-3);
}
</style>
