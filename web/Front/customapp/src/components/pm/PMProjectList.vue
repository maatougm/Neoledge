<template>
  <div class="pm-list">
    <div v-if="store.loading" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: #0d9488" />
    </div>
    <div v-else-if="store.projects.length === 0" class="empty-state">
      <i class="pi pi-folder-open" />
      <p>Aucun projet assigné.</p>
    </div>
    <div v-else class="project-grid">
      <div
        v-for="p in store.projects"
        :key="p.id"
        class="project-card hover-lift"
        @click="emit('select', p.id)"
      >
        <div class="card-top">
          <h3 class="card-name">{{ p.name }}</h3>
          <NeoTag
            :value="PROJECT_STATUS_LABELS[p.status]"
            :severity="statusSeverity(p.status)"
          />
        </div>
        <p class="card-client">{{ p.clientName }}</p>
        <div class="card-dates">
          <span><i class="pi pi-calendar" /> {{ formatDate(p.startDate) }}</span>
          <span>→ {{ formatDate(p.endDate) }}</span>
        </div>
        <div class="card-footer">
          <NeoButton label="Ouvrir" icon="pi pi-arrow-right" size="small" outlined class="w-full" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NeoTag, NeoButton } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'

const emit = defineEmits<{ select: [id: string] }>()
const store = usePmStore()

const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR') : '—'
</script>

<style scoped>
.loading-state, .empty-state {
  display: flex; flex-direction: column; align-items: center;
  gap: 0.75rem; padding: 3rem; color: var(--nl-text-3);
}
.empty-state i { font-size: 2.5rem; }

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.project-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 10px;
  padding: 1.25rem;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.project-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); border-color: var(--nl-accent); }

.card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
.card-name { font-size: 0.95rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.card-client { font-size: 0.82rem; color: var(--nl-text-3); margin: 0; }
.card-dates { display: flex; gap: 0.5rem; font-size: 0.78rem; color: var(--nl-text-3); align-items: center; }
.card-dates i { font-size: 0.75rem; }
.card-footer { margin-top: auto; padding-top: 0.5rem; }
</style>
