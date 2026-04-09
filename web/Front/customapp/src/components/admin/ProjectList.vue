<!--
  @file     ProjectList.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-26
  @desc     Admin table of deployment projects — search/filter, pagination, progress bar
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

    <!-- Search & Filter toolbar -->
    <div class="project-list__toolbar">
      <NeoInputText
        v-model="localSearch"
        label=""
        placeholder="Rechercher un projet ou client…"
        class="project-list__search"
      />
      <NeoSelect
        v-model="localStatus"
        :options="statusOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Tous les statuts"
        class="project-list__filter"
      />
      <NeoButton
        label="Réinitialiser"
        outlined
        severity="secondary"
        @click="resetFilters"
      />
      <span class="project-list__count">
        {{ store.totalProjects }} projet{{ store.totalProjects !== 1 ? 's' : '' }} trouvé{{ store.totalProjects !== 1 ? 's' : '' }}
      </span>
    </div>

    <!-- Error -->
    <NeoMessage
      v-if="store.error"
      severity="error"
      :text="store.error"
      :closable="true"
      class="project-list__error"
    />

    <!-- Bulk Action Toolbar -->
    <div
      v-if="store.selectedProjectIds.length > 0"
      class="project-list__bulk-toolbar"
    >
      <span class="project-list__bulk-count">
        {{ store.selectedProjectIds.length }} projet(s) sélectionné(s)
      </span>

      <div class="project-list__bulk-actions">
        <!-- Archive -->
        <NeoButton
          label="Archiver"
          icon="pi pi-inbox"
          severity="warning"
          size="small"
          :loading="store.loading"
          @click="handleBulkArchive"
        />

        <!-- Change status -->
        <div class="project-list__bulk-inline">
          <NeoSelect
            v-model="bulkStatusValue"
            :options="bulkStatusOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Choisir un statut"
            class="project-list__bulk-select"
          />
          <NeoButton
            label="Confirmer"
            outlined
            size="small"
            :disabled="!bulkStatusValue"
            :loading="store.loading"
            @click="handleBulkStatus"
          />
        </div>

        <!-- Assign manager -->
        <div class="project-list__bulk-inline">
          <NeoSelect
            v-model="bulkManagerId"
            :options="pmOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Choisir un chef"
            class="project-list__bulk-select"
          />
          <NeoButton
            label="Confirmer"
            outlined
            size="small"
            :disabled="!bulkManagerId"
            :loading="store.loading"
            @click="handleBulkAssign"
          />
        </div>

        <!-- Deselect -->
        <NeoButton
          label="Désélectionner"
          text
          size="small"
          @click="store.clearSelection()"
        />
      </div>
    </div>

    <!-- Table -->
    <div class="project-list__table-wrapper">
      <table class="project-list__table">
        <thead>
          <tr>
            <th class="project-list__th-check">
              <input
                type="checkbox"
                :checked="allSelected"
                :indeterminate="someSelected"
                @change="toggleAll"
                class="project-list__checkbox"
                aria-label="Tout sélectionner"
              />
            </th>
            <th>Projet</th>
            <th>Client</th>
            <th>Chef de projet</th>
            <th>Statut</th>
            <th>Progression</th>
            <th>Début</th>
            <th>Fin</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.loading">
            <td colspan="9" class="project-list__loading">Chargement…</td>
          </tr>
          <tr v-else-if="store.projects.length === 0">
            <td colspan="9" class="project-list__empty">Aucun projet trouvé.</td>
          </tr>
          <tr
            v-for="project in store.projects"
            :key="project.id"
            class="project-list__row"
            :class="{ 'project-list__row--selected': isSelected(project.id) }"
          >
            <td class="project-list__td-check">
              <input
                type="checkbox"
                :checked="isSelected(project.id)"
                @change="store.toggleSelection(project.id)"
                class="project-list__checkbox"
                :aria-label="`Sélectionner ${project.name}`"
              />
            </td>
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
            <td class="project-list__progress-cell">
              <span v-if="!hasFields(project)" class="project-list__progress-na">—</span>
              <template v-else>
                <div class="progress-bar-wrap">
                  <div
                    class="progress-bar-fill"
                    :style="progressStyle(project)"
                  />
                </div>
                <span class="progress-bar-label">{{ progressPercent(project) }}%</span>
              </template>
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

    <NeoToast />

    <!-- Pagination -->
    <div class="project-list__pagination">
      <NeoButton
        label="Précédent"
        outlined
        severity="secondary"
        :disabled="currentSkip === 0"
        @click="prevPage"
      />
      <span class="project-list__page-info">
        Page {{ currentPage }} / {{ totalPages }}
      </span>
      <NeoButton
        label="Suivant"
        outlined
        severity="secondary"
        :disabled="currentSkip + PAGE_SIZE >= store.totalProjects"
        @click="nextPage"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { NeoButton, NeoTag, NeoMessage, NeoInputText, NeoSelect, NeoToast, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import { useProjectStore, computeProgress } from '@/stores/projectStore'
import { useUserStore } from '@/stores/userStore'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_SEVERITY,
} from '@/types/project.types'
import type { ProjectStatus, ProjectSummary } from '@/types/project.types'

// ─── Store & emits ───────────────────────────────────────────────────────────

const store = useProjectStore()
const userStore = useUserStore()
const toast = useNeoToast()
const confirm = useNeoConfirm()

const emit = defineEmits<{
  create: []
  view: [id: string]
  edit: [id: string]
  delete: [id: string]
  'assign-manager': [id: string]
}>()

// ─── Pagination ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 20
const currentSkip = ref(0)

const totalPages = computed(() =>
  Math.max(1, Math.ceil(store.totalProjects / PAGE_SIZE)),
)
const currentPage = computed(() => Math.floor(currentSkip.value / PAGE_SIZE) + 1)

// ─── Search & filter state ───────────────────────────────────────────────────

const localSearch = ref('')
const localStatus = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const statusOptions = [
  { label: 'Tous les statuts', value: '' },
  ...Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
]

// ─── Watchers (debounced search) ─────────────────────────────────────────────

watch(localSearch, () => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    currentSkip.value = 0
    runSearch()
  }, 300)
})

watch(localStatus, () => {
  currentSkip.value = 0
  runSearch()
})

// ─── Actions ─────────────────────────────────────────────────────────────────

function runSearch() {
  store.searchProjects({
    search: localSearch.value || undefined,
    status: localStatus.value || undefined,
    skip: currentSkip.value,
    take: PAGE_SIZE,
  })
}

function resetFilters() {
  localSearch.value = ''
  localStatus.value = ''
  currentSkip.value = 0
  runSearch()
}

function prevPage() {
  if (currentSkip.value === 0) return
  currentSkip.value = Math.max(0, currentSkip.value - PAGE_SIZE)
  runSearch()
}

function nextPage() {
  if (currentSkip.value + PAGE_SIZE >= store.totalProjects) return
  currentSkip.value += PAGE_SIZE
  runSearch()
}

onMounted(() => {
  runSearch()
  userStore.fetchAll()
})

// ─── Bulk action state ────────────────────────────────────────────────────────

const bulkStatusValue = ref<string>('')
const bulkManagerId = ref<string>('')

// ─── Selection computed ───────────────────────────────────────────────────────

const isSelected = (id: string): boolean => store.selectedProjectIds.includes(id)

const allSelected = computed(
  () =>
    store.projects.length > 0 &&
    store.projects.every((p) => store.selectedProjectIds.includes(p.id)),
)

const someSelected = computed(
  () => store.selectedProjectIds.length > 0 && !allSelected.value,
)

const toggleAll = (): void => {
  if (allSelected.value) {
    store.clearSelection()
  } else {
    store.selectAll(store.projects.map((p) => p.id))
  }
}

// ─── Bulk option lists ────────────────────────────────────────────────────────

const bulkStatusOptions = computed(() =>
  (Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((key) => ({
    label: PROJECT_STATUS_LABELS[key],
    value: key,
  })),
)

const pmOptions = computed(() =>
  userStore.projectManagers.map((u) => ({
    label: `${u.firstName} ${u.lastName}`,
    value: u.id,
  })),
)

// ─── Bulk handlers ────────────────────────────────────────────────────────────

const handleBulkArchive = (): void => {
  const ids = [...store.selectedProjectIds]
  confirm.require({
    message: `Archiver ${ids.length} projet(s) ?`,
    header: "Confirmer l'archivage",
    icon: 'pi pi-exclamation-triangle',
    accept: async () => {
      try {
        await store.bulkArchive(ids)
        store.clearSelection()
        toast.add({ severity: 'success', detail: `${ids.length} projet(s) archivé(s).`, life: 3000 })
      } catch {
        toast.add({ severity: 'error', detail: "Erreur lors de l'archivage.", life: 4000 })
      }
    },
  })
}

const handleBulkStatus = async (): Promise<void> => {
  if (!bulkStatusValue.value) return
  const ids = [...store.selectedProjectIds]
  const status = bulkStatusValue.value
  try {
    await store.bulkUpdateStatus(ids, status)
    store.clearSelection()
    bulkStatusValue.value = ''
    toast.add({ severity: 'success', detail: `Statut mis à jour pour ${ids.length} projet(s).`, life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: 'Erreur lors du changement de statut.', life: 4000 })
  }
}

const handleBulkAssign = async (): Promise<void> => {
  if (!bulkManagerId.value) return
  const ids = [...store.selectedProjectIds]
  const managerId = bulkManagerId.value
  try {
    await store.bulkAssignManager(ids, managerId)
    store.clearSelection()
    bulkManagerId.value = ''
    toast.add({ severity: 'success', detail: `Chef de projet assigné pour ${ids.length} projet(s).`, life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: "Erreur lors de l'assignation.", life: 4000 })
  }
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const statusLabel = (s: ProjectStatus) => PROJECT_STATUS_LABELS[s] ?? s

const statusSeverity = (
  s: ProjectStatus,
): 'secondary' | 'info' | 'success' | 'warn' | 'danger' | 'contrast' | 'primary' => {
  const val = PROJECT_STATUS_SEVERITY[s]
  if (
    val === 'secondary' ||
    val === 'info' ||
    val === 'success' ||
    val === 'warn' ||
    val === 'danger' ||
    val === 'contrast' ||
    val === 'primary'
  )
    return val
  return 'secondary'
}

// ─── Progress helpers ─────────────────────────────────────────────────────────

/**
 * ProjectSummary does not carry fields/fieldValues — only ProjectDetail does.
 * We cast to check presence so the progress column stays dormant for summaries.
 */
type MaybeDetailFields = ProjectSummary & {
  fields?: { id: string; isRequired: boolean }[]
  fieldValues?: { projectFieldId: string; value: string | null }[]
}

function hasFields(project: ProjectSummary): boolean {
  const p = project as MaybeDetailFields
  return Array.isArray(p.fields) && p.fields.length > 0
}

function progressPercent(project: ProjectSummary): number {
  const p = project as MaybeDetailFields
  if (!p.fields || !p.fieldValues) return 0
  // computeProgress requires ProjectDetail shape; satisfy it with a cast
  return computeProgress({
    ...(p as unknown as import('@/types/project.types').ProjectDetail),
    fields: p.fields as import('@/types/project.types').ProjectField[],
    fieldValues: p.fieldValues as import('@/types/project.types').ProjectFieldValue[],
  })
}

function progressStyle(project: ProjectSummary): Record<string, string> {
  const pct = progressPercent(project)
  let color = '#E11D48' // red — < 50%
  if (pct >= 80) color = '#059669' // green
  else if (pct >= 50) color = '#D97706' // orange
  return { width: `${pct}%`, background: color }
}

// ─── Date helper ─────────────────────────────────────────────────────────────

const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: '2-digit' }) : '—'
</script>

<style scoped>
.project-list {
  background: var(--nl-surface);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow);
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
  color: var(--nl-text-1);
  margin: 0;
}

/* ── Bulk toolbar ── */
.project-list__bulk-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: var(--nl-accent-light);
  border: 1px solid var(--nl-accent);
  border-radius: var(--nl-radius);
}

.project-list__bulk-count {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--nl-accent);
  white-space: nowrap;
}

.project-list__bulk-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  flex: 1;
}

.project-list__bulk-inline {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.project-list__bulk-select { min-width: 160px; }

/* ── Checkbox column ── */
.project-list__th-check,
.project-list__td-check {
  width: 2.5rem;
  padding: 0.75rem 0.5rem 0.75rem 1rem;
}

.project-list__checkbox {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
  accent-color: var(--nl-accent);
}

.project-list__row--selected td {
  background: var(--nl-accent-light);
}

/* ── Toolbar ── */
.project-list__toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.project-list__search { flex: 2; min-width: 200px; }
.project-list__filter { flex: 1; min-width: 180px; }

.project-list__count {
  font-size: 0.8rem;
  color: var(--nl-text-3);
  white-space: nowrap;
  margin-left: auto;
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
  border-bottom: 1px solid var(--nl-surface-2);
}

.project-list__table th {
  font-weight: 600;
  color: var(--nl-text-3);
  background: var(--nl-surface-2);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.project-list__row:hover td { background: var(--nl-surface-2); }

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
  color: var(--nl-text-3);
  padding: 2rem;
}

/* ── Progress bar ── */
.project-list__progress-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 120px;
}

.project-list__progress-na {
  color: var(--nl-text-3);
  font-size: 0.85rem;
}

.progress-bar-wrap {
  flex: 1;
  height: 6px;
  background: var(--nl-border);
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-bar-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--nl-text-2);
  white-space: nowrap;
}

/* ── Pagination ── */
.project-list__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--nl-border);
}

.project-list__page-info {
  font-size: 0.8rem;
  color: var(--nl-text-3);
}
</style>
