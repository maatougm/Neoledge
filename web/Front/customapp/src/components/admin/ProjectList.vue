<!--
  @file     ProjectList.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-04-10
  @desc     Admin table of deployment projects — Rocketlane + Linear quality
-->
<template>
  <div class="project-list">
    <!-- Header -->
    <div class="project-list__header">
      <h2 class="project-list__title">Projets de déploiement</h2>
      <div class="project-list__header-actions">
        <NeoButton label="Export CSV" icon="pi pi-download" outlined severity="secondary" @click="handleExportCsv" />
        <NeoButton label="Export PDF" icon="pi pi-file-pdf" outlined severity="secondary" @click="handleExportPdf" />
        <NeoButton label="Nouveau projet" icon="pi pi-plus" @click="emit('create')" />
      </div>
    </div>

    <!-- Toolbar -->
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
      <NeoButton label="Réinitialiser" outlined severity="secondary" @click="resetFilters" />
      <span class="project-list__count">
        {{ store.totalProjects }} projet{{ store.totalProjects !== 1 ? 's' : '' }} trouvé{{ store.totalProjects !== 1 ? 's' : '' }}
      </span>
    </div>

    <NeoMessage v-if="store.error" severity="error" :text="store.error" :closable="true" class="project-list__error" />

    <!-- Bulk toolbar -->
    <ProjectBulkToolbar
      v-if="store.selectedProjectIds.length > 0"
      :selected-count="store.selectedProjectIds.length"
      :loading="store.loading"
      :status-options="bulkStatusOptions"
      :pm-options="pmOptions"
      class="project-list__bulk"
      @archive="handleBulkArchive"
      @set-status="handleBulkStatus"
      @assign-manager="handleBulkAssign"
      @clear="store.clearSelection()"
    />

    <!-- Table -->
    <div class="project-list__table-wrapper">
      <table class="project-list__table">
        <thead>
          <tr>
            <th class="project-list__th-check">
              <input type="checkbox" :checked="allSelected" :indeterminate="someSelected" class="project-list__checkbox" aria-label="Tout sélectionner" @change="toggleAll" />
            </th>
            <th>Projet</th>
            <th>Client</th>
            <th>Chef de projet</th>
            <th>Statut</th>
            <th>Progression</th>
            <th>Début</th>
            <th>Fin</th>
            <th class="project-list__th-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.loading">
            <td colspan="9">
              <div class="project-list__skeleton-wrap">
                <div v-for="n in 5" :key="n" class="project-list__skeleton-row" />
              </div>
            </td>
          </tr>
          <tr v-else-if="store.projects.length === 0">
            <td colspan="9">
              <div class="project-list__empty-state">
                <i class="pi pi-folder-open project-list__empty-icon" />
                <span>Aucun projet trouvé.</span>
              </div>
            </td>
          </tr>
          <ProjectTableRow
            v-for="project in store.projects"
            :key="project.id"
            :project="project"
            :selected="isSelected(project.id)"
            :progress="progressPercent(project)"
            @toggle-select="store.toggleSelection(project.id)"
            @view="emit('view', project.id)"
            @open="emit('open', project.id)"
            @edit="emit('edit', project.id)"
            @delete="emit('delete', project.id)"
            @assign-manager="emit('assign-manager', project.id)"
            @archive="handleArchive(project)"
            @duplicate="handleDuplicate(project)"
          />
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="project-list__pagination">
      <NeoButton label="Précédent" outlined severity="secondary" :disabled="currentSkip === 0" @click="prevPage" />
      <span class="project-list__page-info">Page {{ currentPage }} / {{ totalPages }}</span>
      <NeoButton label="Suivant" outlined severity="secondary" :disabled="currentSkip + PAGE_SIZE >= store.totalProjects" @click="nextPage" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { NeoButton, NeoMessage, NeoInputText, NeoSelect, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import { useProjectStore } from '@/stores/projectStore'
import { useUserStore } from '@/stores/userStore'
import { PROJECT_STATUS_LABELS } from '@/types/project.types'
import type { ProjectStatus, ProjectSummary } from '@/types/project.types'
import ProjectBulkToolbar from './ProjectBulkToolbar.vue'
import ProjectTableRow from './ProjectTableRow.vue'

const store = useProjectStore()
const userStore = useUserStore()
const toast = useNeoToast()
const confirm = useNeoConfirm()

const emit = defineEmits<{
  create: []
  view: [id: string]
  open: [id: string]
  edit: [id: string]
  delete: [id: string]
  'assign-manager': [id: string]
}>()

// ─── Pagination ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 20
const currentSkip = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(store.totalProjects / PAGE_SIZE)))
const currentPage = computed(() => Math.floor(currentSkip.value / PAGE_SIZE) + 1)

// ─── Search & filter ──────────────────────────────────────────────────────────

const localSearch = ref('')
const localStatus = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const statusOptions = [
  { label: 'Tous les statuts', value: '' },
  ...Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
]

watch(localSearch, () => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { currentSkip.value = 0; runSearch() }, 300)
})
watch(localStatus, () => { currentSkip.value = 0; runSearch() })

function runSearch() {
  store.searchProjects({ search: localSearch.value || undefined, status: localStatus.value || undefined, skip: currentSkip.value, take: PAGE_SIZE })
}

function resetFilters() { localSearch.value = ''; localStatus.value = ''; currentSkip.value = 0; runSearch() }
function prevPage() { if (currentSkip.value === 0) return; currentSkip.value = Math.max(0, currentSkip.value - PAGE_SIZE); runSearch() }
function nextPage() { if (currentSkip.value + PAGE_SIZE >= store.totalProjects) return; currentSkip.value += PAGE_SIZE; runSearch() }

onMounted(() => { runSearch(); userStore.fetchAll() })

onUnmounted(() => {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
})

// ─── Selection ────────────────────────────────────────────────────────────────

const isSelected = (id: string) => store.selectedProjectIds.includes(id)
const allSelected = computed(() => store.projects.length > 0 && store.projects.every((p) => store.selectedProjectIds.includes(p.id)))
const someSelected = computed(() => store.selectedProjectIds.length > 0 && !allSelected.value)
function toggleAll() { allSelected.value ? store.clearSelection() : store.selectAll(store.projects.map((p) => p.id)) }

// ─── Bulk options ─────────────────────────────────────────────────────────────

const bulkStatusOptions = computed(() =>
  (Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((key) => ({ label: PROJECT_STATUS_LABELS[key], value: key })),
)

const pmOptions = computed(() =>
  userStore.projectManagers.map((u) => ({ label: `${u.firstName} ${u.lastName}`, value: u.id })),
)

// ─── Bulk handlers ─────────────────────────────────────────────────────────────

function handleBulkArchive() {
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

async function handleBulkStatus(status: string) {
  const ids = [...store.selectedProjectIds]
  try {
    await store.bulkUpdateStatus(ids, status)
    store.clearSelection()
    toast.add({ severity: 'success', detail: `Statut mis à jour pour ${ids.length} projet(s).`, life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: 'Erreur lors du changement de statut.', life: 4000 })
  }
}

async function handleBulkAssign(managerId: string) {
  const ids = [...store.selectedProjectIds]
  try {
    await store.bulkAssignManager(ids, managerId)
    store.clearSelection()
    toast.add({ severity: 'success', detail: `Chef de projet assigné pour ${ids.length} projet(s).`, life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: "Erreur lors de l'assignation.", life: 4000 })
  }
}

// ─── Row action handlers ───────────────────────────────────────────────────────

function handleArchive(project: ProjectSummary): void {
  confirm.require({
    message: `Archiver le projet "${project.name}" ?`,
    header: "Confirmer l'archivage",
    icon: 'pi pi-exclamation-triangle',
    accept: async () => {
      try {
        await store.archiveProject(project.id)
        toast.add({ severity: 'success', detail: 'Projet archivé.', life: 3000 })
      } catch {
        toast.add({ severity: 'error', detail: "Erreur lors de l'archivage.", life: 4000 })
      }
    },
  })
}

async function handleDuplicate(project: ProjectSummary): Promise<void> {
  const newName = window.prompt('Nom du nouveau projet :', `${project.name} (copie)`)
  if (!newName || !newName.trim()) return
  const created = await store.duplicateProject(project.id, newName.trim())
  if (created) {
    toast.add({ severity: 'success', detail: `Projet dupliqué : ${created.name}`, life: 3000 })
  } else if (store.error) {
    toast.add({ severity: 'error', detail: store.error, life: 4000 })
  }
}

// ─── Export ────────────────────────────────────────────────────────────────────

async function handleExportCsv(): Promise<void> {
  try {
    const { default: api } = await import('@/lib/api')
    const response = await api.get<Blob>('/admin/project/export', { responseType: 'blob' })
    const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `projets_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.add({ severity: 'success', detail: 'Export CSV téléchargé.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: "Erreur lors de l'export.", life: 4000 })
  }
}

function handleExportPdf(): void {
  // Client-side PDF via print — simple, no library dependency.
  window.print()
}

// ─── Progress helper ──────────────────────────────────────────────────────────

function progressPercent(project: ProjectSummary): number {
  // Backend now ships `progressPct` (% of WPs in a terminal status) on every
  // ProjectSummary, so the frontend can render a meaningful progress bar
  // straight from the list endpoint without needing the full project detail.
  return project.progressPct ?? 0
}
</script>

<style scoped>
.project-list {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow-md);
  padding: 1.5rem;
}

.project-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}

.project-list__title {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
  letter-spacing: -0.01em;
}

.project-list__header-actions {
  display: flex;
  gap: 0.5rem;
}

@media print {
  .project-list__header-actions,
  .project-list__toolbar,
  .project-list__bulk,
  .project-list__pagination,
  .ptr__actions-cell,
  .ptr__td-check,
  .project-list__th-check {
    display: none !important;
  }
}

.project-list__toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.project-list__search { flex: 2; min-width: 200px; }
.project-list__filter { flex: 1; min-width: 180px; }
.project-list__count  { font-size: 0.75rem; color: var(--nl-text-3); white-space: nowrap; margin-left: auto; }
.project-list__error  { margin-bottom: 1rem; }
.project-list__bulk   { margin-bottom: 1rem; }

/* ── Checkbox column ──────────────────────────────────────────────────── */
.project-list__th-check { width: 2.5rem; padding: 0 0.5rem 0 1rem; }

.project-list__checkbox {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
  accent-color: var(--nl-accent);
}

/* ── Table ────────────────────────────────────────────────────────────── */
.project-list__table-wrapper { overflow-x: auto; }

.project-list__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.project-list__table th {
  padding: 0 1rem;
  height: 36px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--nl-text-3);
  background: var(--nl-surface-2);
  border-bottom: 1px solid var(--nl-border);
  white-space: nowrap;
}

.project-list__th-right { text-align: right; }

/* ── Skeleton / empty ────────────────────────────────────────────────── */
.project-list__skeleton-wrap { display: flex; flex-direction: column; gap: 8px; padding: 1rem 0; }

.project-list__skeleton-row {
  height: 40px;
  border-radius: var(--nl-radius);
  background: linear-gradient(90deg, var(--nl-surface-2) 25%, var(--nl-border) 50%, var(--nl-surface-2) 75%);
  background-size: 200% 100%;
  animation: pl-shimmer 1.4s infinite;
}

@keyframes pl-shimmer {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}

.project-list__empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.5rem;
  font-size: 0.875rem;
  color: var(--nl-text-3);
}

.project-list__empty-icon { font-size: 1.75rem; color: var(--nl-border-strong); }

/* ── Pagination ───────────────────────────────────────────────────────── */
.project-list__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--nl-border);
}

.project-list__page-info { font-size: 0.8125rem; color: var(--nl-text-3); }
</style>
