<!--
  @file     ProjectList.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-26
  @desc     Admin table of deployment projects with status badges and action buttons
-->
<template>
  <div class="project-list">
    <!-- Header -->
    <div class="project-list__header">
      <h2 class="project-list__title">Projets de déploiement</h2>
      <NeoButton
        label="Nouveau projet"
        icon="pi pi-plus"
        @click="emit('create')"
      />
    </div>

    <!-- Error -->
    <NeoMessage
      v-if="store.error"
      severity="error"
      :text="store.error"
      :closable="true"
      class="project-list__error"
    />

    <!-- Table -->
    <div class="project-list__table-wrapper">
      <table class="project-list__table">
        <thead>
          <tr>
            <th>Projet</th>
            <th>Client</th>
            <th>Chef de projet</th>
            <th>Statut</th>
            <th>Début</th>
            <th>Fin</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.loading">
            <td colspan="7" class="project-list__loading">Chargement…</td>
          </tr>
          <tr v-else-if="store.projects.length === 0">
            <td colspan="7" class="project-list__empty">Aucun projet trouvé.</td>
          </tr>
          <tr
            v-for="project in store.projects"
            :key="project.id"
            class="project-list__row"
          >
            <td class="project-list__name" @click="emit('view', project.id)">
              {{ project.name }}
            </td>
            <td>{{ project.clientName }}</td>
            <td>
              <span v-if="project.projectManagerName">{{ project.projectManagerName }}</span>
              <NeoButton
                v-else
                label="Assigner"
                severity="secondary"
                text
                size="small"
                @click="emit('assign-manager', project.id)"
              />
            </td>
            <td>
              <NeoTag
                :value="statusLabel(project.status)"
                :severity="statusSeverity(project.status)"
              />
            </td>
            <td>{{ formatDate(project.startDate) }}</td>
            <td>{{ formatDate(project.endDate) }}</td>
            <td class="project-list__actions">
              <NeoButton
                icon="pi pi-eye"
                severity="secondary"
                text
                size="small"
                @click="emit('view', project.id)"
                title="Voir"
              />
              <NeoButton
                icon="pi pi-pencil"
                severity="secondary"
                text
                size="small"
                @click="emit('edit', project.id)"
                title="Modifier"
              />
              <NeoButton
                icon="pi pi-user-plus"
                severity="info"
                text
                size="small"
                @click="emit('assign-manager', project.id)"
                title="Assigner un chef de projet"
              />
              <NeoButton
                icon="pi pi-trash"
                severity="danger"
                text
                size="small"
                @click="emit('delete', project.id)"
                title="Supprimer"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { NeoButton, NeoTag, NeoMessage } from '@neolibrary/components'
import { useProjectStore } from '@/stores/projectStore'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'

const store = useProjectStore()

const emit = defineEmits<{
  create: []
  view: [id: string]
  edit: [id: string]
  delete: [id: string]
  'assign-manager': [id: string]
}>()

onMounted(() => store.fetchAll())

const statusLabel = (s: ProjectStatus) => PROJECT_STATUS_LABELS[s] ?? s
const statusSeverity = (s: ProjectStatus): "secondary" | "info" | "success" | "warn" | "danger" | "contrast" | "primary" => {
  const val = PROJECT_STATUS_SEVERITY[s]
  if (val === 'secondary' || val === 'info' || val === 'success' || val === 'warn' || val === 'danger' || val === 'contrast' || val === 'primary') return val
  return 'secondary'
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: '2-digit' })
</script>

<style scoped>
.project-list {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  padding: 1.5rem;
}

.project-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}

.project-list__title {
  font-size: 1.25rem;
  font-weight: 700;
  color: #111827;
  margin: 0;
}

.project-list__error { margin-bottom: 1rem; }

.project-list__table-wrapper { overflow-x: auto; }

.project-list__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.project-list__table th,
.project-list__table td {
  padding: 0.75rem 1rem;
  text-align: left;
  border-bottom: 1px solid #f3f4f6;
}

.project-list__table th {
  font-weight: 600;
  color: #6b7280;
  background: #f9fafb;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.project-list__row:hover td { background: #f9fafb; }

.project-list__name {
  font-weight: 600;
  color: #0a6e89;
  cursor: pointer;
}
.project-list__name:hover { text-decoration: underline; }

.project-list__actions { display: flex; gap: 0.25rem; }

.project-list__loading,
.project-list__empty {
  text-align: center;
  color: #9ca3af;
  padding: 2rem;
}
</style>
