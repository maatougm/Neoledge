<!--
  @file     TrashSection.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-04-09
  @desc     Corbeille — liste des projets supprimés, restauration et purge définitive
-->
<template>
  <div class="section">
    <div class="section-header">
      <div>
        <h2 class="section-title">
          Corbeille
          <span v-if="store.deletedProjects.length > 0" class="trash-badge">
            {{ store.deletedProjects.length }}
          </span>
        </h2>
        <p class="section-sub">Projets supprimés — restaurez-les ou supprimez-les définitivement.</p>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="state-block">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: #0d9488" />
    </div>

    <!-- Error -->
    <NeoMessage v-else-if="store.error" severity="error" :text="store.error" />

    <!-- Empty -->
    <div v-else-if="store.deletedProjects.length === 0" class="state-block">
      <i class="pi pi-trash" style="font-size: 2.5rem; color: var(--nl-text-3)" />
      <p class="state-text">La corbeille est vide.</p>
    </div>

    <!-- Table -->
    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Nom du projet</th>
            <th>Client</th>
            <th>Statut</th>
            <th>Supprimé le</th>
            <th>Supprimé par</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in store.deletedProjects" :key="p.id">
            <td class="cell-name">{{ p.name }}</td>
            <td>{{ p.clientName }}</td>
            <td>
              <NeoTag
                :value="PROJECT_STATUS_LABELS[p.status] ?? p.status"
                :severity="statusSeverity(p.status)"
              />
            </td>
            <td class="cell-date">{{ formatDate(p.deletedAt) }}</td>
            <td>{{ p.deletedByName ?? '—' }}</td>
            <td>
              <div class="action-row">
                <NeoButton
                  label="Restaurer"
                  icon="pi pi-undo"
                  outlined
                  size="small"
                  :disabled="store.loading"
                  @click="handleRestore(p.id, p.name)"
                />
                <NeoButton
                  label="Supprimer définitivement"
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  size="small"
                  :disabled="store.loading"
                  @click="handlePurge(p.id, p.name)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { NeoButton, NeoTag, NeoMessage, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import { useProjectStore } from '@/stores/projectStore'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'

const store   = useProjectStore()
const toast   = useNeoToast()
const confirm = useNeoConfirm()

onMounted(() => store.fetchDeletedProjects())

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusSeverity = (s: ProjectStatus): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' => {
  const val = PROJECT_STATUS_SEVERITY[s]
  if (
    val === 'success' ||
    val === 'info' ||
    val === 'warn' ||
    val === 'danger' ||
    val === 'secondary' ||
    val === 'contrast'
  )
    return val
  return 'secondary'
}

const formatDate = (iso: string): string =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: '2-digit' }) : '—'

// ─── Actions ──────────────────────────────────────────────────────────────────

const handleRestore = (id: string, name: string) => {
  confirm.require({
    message: `Restaurer le projet « ${name} » ?`,
    header: 'Confirmer la restauration',
    icon: 'pi pi-undo',
    acceptLabel: 'Restaurer',
    rejectLabel: 'Annuler',
    accept: async () => {
      await store.restoreProject(id)
      if (!store.error) {
        toast.add({ severity: 'success', detail: `Projet « ${name} » restauré.`, life: 3000 })
      } else {
        toast.add({ severity: 'error', detail: store.error, life: 4000 })
      }
    },
  })
}

const handlePurge = (id: string, name: string) => {
  confirm.require({
    message: `Supprimer définitivement le projet « ${name} » ? Cette action est irréversible.`,
    header: 'Suppression définitive',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    accept: async () => {
      await store.purgeProject(id)
      if (!store.error) {
        toast.add({ severity: 'success', detail: `Projet « ${name} » définitivement supprimé.`, life: 3000 })
      } else {
        toast.add({ severity: 'error', detail: store.error, life: 4000 })
      }
    },
  })
}
</script>

<style scoped>
.section { display: flex; flex-direction: column; gap: 1.5rem; }

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.section-sub { font-size: 0.85rem; color: var(--nl-text-3); margin: 0.2rem 0 0; }

.trash-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 9999px;
  background: #ef4444;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
}

.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem;
  color: var(--nl-text-3);
}

.state-text { font-size: 0.95rem; color: var(--nl-text-3); margin: 0; }

.table-wrap { overflow-x: auto; }

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.data-table th {
  background: var(--nl-surface-2);
  padding: 0.65rem 1rem;
  text-align: left;
  font-weight: 600;
  color: var(--nl-text-2);
  border-bottom: 2px solid var(--nl-border);
  white-space: nowrap;
}

.data-table td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--nl-surface-2);
  color: var(--nl-text-2);
  vertical-align: middle;
}

.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--nl-surface-2); }

.cell-name { font-weight: 600; color: var(--nl-text-1); }
.cell-date { white-space: nowrap; color: var(--nl-text-3); font-size: 0.8rem; }

.action-row { display: flex; gap: 0.4rem; flex-wrap: wrap; }
</style>
