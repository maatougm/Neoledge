<template>
  <div class="vt-root">
    <!-- Loading -->
    <div v-if="loading" class="vt-loading">
      <span class="vt-spinner" />
    </div>

    <!-- Empty state -->
    <div v-else-if="validations.length === 0" class="vt-empty">
      <i class="pi pi-history" />
      <p>Aucune validation enregistrée pour ce projet</p>
    </div>

    <!-- Timeline -->
    <div v-else class="vt-timeline">
      <div
        v-for="(v, i) in validations"
        :key="v.id"
        class="vt-entry"
      >
        <!-- Vertical connector line (hidden for last entry) -->
        <div class="vt-line-col">
          <div
            :class="['vt-dot', v.isApproved ? 'vt-dot--approved' : 'vt-dot--rejected']"
          />
          <div v-if="i < validations.length - 1" class="vt-connector" />
        </div>

        <!-- Card -->
        <div class="vt-card">
          <div class="vt-card__header">
            <span class="vt-phase">{{ PHASE_LABELS[v.phase] ?? v.phase }}</span>
            <NeoTag
              :value="v.isApproved ? 'Approuvé ✓' : 'Rejeté ✗'"
              :severity="v.isApproved ? 'success' : 'danger'"
            />
          </div>
          <div class="vt-card__meta">
            <span class="vt-validator">
              <i class="pi pi-user" />
              {{ v.validatedByName }}
              <span class="vt-role">— {{ ROLE_LABELS[v.validatedByRole] ?? v.validatedByRole }}</span>
            </span>
            <span class="vt-date">{{ formatDate(v.validatedAt) }}</span>
          </div>
          <p v-if="v.comment" class="vt-comment">{{ v.comment }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoTag } from '@neolibrary/components'
import api from '@/lib/api'
import type { ProjectValidation } from '@/types/pm.types'
import type { ProjectStatus } from '@/types/project.types'

const props = defineProps<{ projectId: string }>()

const PHASE_LABELS: Record<ProjectStatus | string, string> = {
  Draft:            'Brouillon',
  Kickoff:          'Lancement',
  CadrageTechnique: 'Cadrage technique',
  Environnement:    'Environnement',
  Parametrage:      'Paramétrage',
  Integration:      'Intégration',
  Recette:          'Recette',
  MEP:              'Mise en production',
  Cloture:          'Clôture',
  Archived:         'Archivé',
}

const ROLE_LABELS: Record<string, string> = {
  Admin:             'Admin',
  ProjectManager:    'Chef de projet',
  SpecificationTeam: 'Équipe spéc.',
  Member:            'Membre',
}

const validations = ref<ProjectValidation[]>([])
const loading     = ref(false)

const formatDate = (iso: string): string => {
  const date = new Date(iso)
  const datePart = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
  const timePart = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  return `${datePart} à ${timePart.replace(':', 'h')}`
}

onMounted(async () => {
  loading.value = true
  try {
    const { data } = await api.get<ProjectValidation[]>(
      `/pm/projects/${props.projectId}/validations`,
    )
    validations.value = [...data]
  } catch {
    validations.value = []
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.vt-root { padding: 0.5rem 0; }

/* Loading */
.vt-loading {
  display: flex;
  justify-content: center;
  padding: 3rem;
}
.vt-spinner {
  display: inline-block;
  width: 28px;
  height: 28px;
  border: 3px solid var(--nl-border);
  border-top-color: var(--nl-accent);
  border-radius: 50%;
  animation: vt-spin 0.7s linear infinite;
}
@keyframes vt-spin {
  to { transform: rotate(360deg); }
}

/* Empty state */
.vt-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem;
  color: var(--nl-text-3);
  background: var(--nl-surface-2);
  border: 1px dashed var(--nl-border);
  border-radius: var(--nl-radius);
  text-align: center;
}
.vt-empty i { font-size: 2rem; }
.vt-empty p { margin: 0; font-size: 0.875rem; }

/* Timeline wrapper */
.vt-timeline {
  display: flex;
  flex-direction: column;
}

/* Each entry row */
.vt-entry {
  display: flex;
  gap: 1rem;
  align-items: stretch;
}

/* Left column: dot + connector line */
.vt-line-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 20px;
  padding-top: 0.25rem;
}

.vt-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid transparent;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}
.vt-dot--approved {
  background: var(--nl-success);
  border-color: var(--nl-success-light);
  box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.15);
}
.vt-dot--rejected {
  background: var(--nl-danger);
  border-color: var(--nl-danger-light);
  box-shadow: 0 0 0 3px rgba(225, 29, 72, 0.15);
}

.vt-connector {
  flex: 1;
  width: 2px;
  background: var(--nl-border);
  margin: 0.2rem 0;
  min-height: 1rem;
}

/* Card */
.vt-card {
  flex: 1;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 0.875rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}

.vt-card__header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.vt-phase {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--nl-text-1);
}

.vt-card__meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.vt-validator {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.82rem;
  color: var(--nl-text-2);
}
.vt-validator i { font-size: 0.78rem; color: var(--nl-text-3); }

.vt-role {
  color: var(--nl-text-3);
  font-size: 0.78rem;
}

.vt-date {
  margin-left: auto;
  font-size: 0.78rem;
  color: var(--nl-text-3);
  white-space: nowrap;
}

.vt-comment {
  margin: 0;
  font-size: 0.82rem;
  color: var(--nl-text-3);
  font-style: italic;
  padding-top: 0.2rem;
  border-top: 1px solid var(--nl-surface-2);
}
</style>
