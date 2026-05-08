<!-- @file MemberSprintsListView.vue — cross-project list of sprints
     where the Member has at least one assigned WP. -->
<template>
  <div class="msl">
    <header class="msl__head">
      <h1 class="msl__title">Sprints actifs</h1>
      <p class="msl__subtitle">{{ subtitle }}</p>
    </header>

    <div v-if="store.loading && store.activeSprints.length === 0" class="msl__loading">
      <i class="pi pi-spin pi-spinner" /> Chargement…
    </div>
    <div v-else-if="store.activeSprints.length === 0" class="msl__empty">
      <i class="pi pi-forward" />
      <p>Tu n'as pas de sprints actifs en ce moment.</p>
    </div>
    <div v-else class="msl__grid">
      <SprintWidget
        v-for="s in store.activeSprints"
        :key="s.sprint.id"
        :sprint="s"
        :project-name="s.projectName"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useMemberDashboardStore } from '@/stores/memberDashboardStore'
import SprintWidget from '@/components/team/SprintWidget.vue'

const store = useMemberDashboardStore()

const subtitle = computed<string>(() => {
  const n = store.activeSprints.length
  if (n === 0) return 'Aucun sprint actif.'
  if (n === 1) return '1 sprint actif sur tes projets.'
  return `${n} sprints actifs sur tes projets.`
})

onMounted(() => {
  if (store.activeSprints.length === 0) void store.fetchAll()
})
</script>

<style scoped>
.msl { padding: 1.75rem; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }

.msl__head { margin-bottom: 0.25rem; }
.msl__title { margin: 0 0 0.25rem 0; font-size: 1.5rem; color: var(--nl-text-1); }
.msl__subtitle { margin: 0; color: var(--nl-text-3); font-size: 0.8125rem; }

.msl__loading,
.msl__empty {
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 0.5rem;
  padding: 3rem 2rem;
  background: var(--nl-card-bg, #fff);
  border: 1px dashed var(--nl-border);
  border-radius: 8px;
  color: var(--nl-text-3);
}
.msl__empty i { font-size: 1.75rem; }

.msl__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.75rem; }
</style>
