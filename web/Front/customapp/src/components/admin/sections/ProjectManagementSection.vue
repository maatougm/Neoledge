<!--
  @file     ProjectManagementSection.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-27
  @desc     Gestion des projets — list with bulk selection, archive, duplicate, delete actions
-->
<template>
  <div class="section">
    <div class="section-header">
      <div>
        <h2 class="section-title">Gestion des projets</h2>
        <p class="section-sub">{{ store.projects.length }} projet(s) au total</p>
      </div>
      <div v-if="!selectedProjectId" class="header-actions">
        <NeoButton
          label="Exporter CSV"
          icon="pi pi-download"
          outlined
          @click="exportCsv"
        />
        <NeoButton
          label="Nouveau projet"
          icon="pi pi-plus"
          @click="showForm = true"
        />
      </div>
    </div>

    <!-- Project detail panel -->
    <ProjectDetailPanel
      v-if="selectedProjectId"
      :project-id="selectedProjectId"
      @close="selectedProjectId = null"
    />

    <!-- Create form inline -->
    <ProjectCreateForm v-else-if="showForm" @cancel="showForm = false" @created="showForm = false" />

    <!-- Project table -->
    <template v-else>
      <div v-if="store.loading" class="loading-state">
        <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: var(--nl-accent)" />
      </div>
      <div v-else-if="store.projects.length === 0" class="empty-state">
        <i class="pi pi-folder-open" />
        <p>Aucun projet. Créez-en un pour commencer.</p>
      </div>
      <div v-else class="project-table-wrap">
        <!-- Saved filters panel -->
        <div class="saved-filters-row">
          <SavedFiltersPanel
            :current-criteria="currentFilterCriteria"
            @apply="onSavedFilterApply"
          />
        </div>

        <!-- Advanced filter builder (collapsible) -->
        <div class="filter-builder-row">
          <NeoButton
            :label="showFilterBuilder ? 'Masquer les filtres' : 'Filtres avancés'"
            icon="pi pi-filter"
            text
            severity="secondary"
            size="small"
            @click="showFilterBuilder = !showFilterBuilder"
          />
          <span v-if="activeFilterCount > 0" class="filter-active-badge">{{ activeFilterCount }} actif(s)</span>
        </div>
        <FilterBuilder
          v-if="showFilterBuilder"
          ref="filterBuilderRef"
          :model-value="currentFilterCriteria"
          class="filter-builder-panel"
          @change="onFilterChange"
        />

        <!-- Simple search bar (quick filter when builder is closed) -->
        <div v-if="!showFilterBuilder" class="filter-bar">
          <NeoInputText
            v-model="searchText"
            placeholder="Rechercher par nom ou client…"
            class="filter-search"
          />
          <NeoSelect
            v-model="statusFilter"
            :options="statusFilterOptions"
            option-label="label"
            option-value="value"
            placeholder="Tous les statuts"
            class="filter-status"
          />
        </div>

        <!-- Bulk action bar -->
        <div v-if="selectedIds.size > 0" class="bulk-bar">
          <span class="bulk-count">{{ selectedIds.size }} projet(s) sélectionné(s)</span>
          <NeoButton
            label="Archiver"
            icon="pi pi-inbox"
            severity="warn"
            size="small"
            @click="handleBulkArchive"
          />
          <NeoButton
            label="Désélectionner"
            severity="secondary"
            outlined
            size="small"
            @click="clearSelection"
          />
        </div>

        <table class="data-table">
          <thead>
            <tr>
              <th class="col-check">
                <input
                  id="project-select-all"
                  name="project-select-all"
                  type="checkbox"
                  :checked="allSelected"
                  :indeterminate="someSelected"
                  class="row-checkbox"
                  aria-label="Tout sélectionner"
                  @change="toggleSelectAll"
                />
              </th>
              <th>Nom</th>
              <th>Client</th>
              <th>Chef de projet</th>
              <th>Statut</th>
              <th>Créé le</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in filteredProjects"
              :key="p.id"
              :class="{ 'row--selected': selectedIds.has(p.id) }"
            >
              <td class="col-check">
                <input
                  :id="`project-select-${p.id}`"
                  :name="`project-select-${p.id}`"
                  type="checkbox"
                  :checked="selectedIds.has(p.id)"
                  class="row-checkbox"
                  :aria-label="`Sélectionner ${p.name}`"
                  @change="toggleRow(p.id)"
                />
              </td>
              <td class="cell-name">
                {{ p.name }}
                <span
                  v-if="isNearDeadline(p)"
                  title="Échéance dans moins de 7 jours"
                  style="color:#f59e0b;margin-left:4px"
                >
                  <i class="pi pi-exclamation-triangle" />
                </span>
              </td>
              <td>{{ p.clientName }}</td>
              <td>{{ p.projectManagerName ?? '—' }}</td>
              <td>
                <NeoTag
                  :value="PROJECT_STATUS_LABELS[p.status]"
                  :severity="statusSeverity(p.status)"
                />
              </td>
              <td class="cell-date">{{ formatDate(p.createdAt) }}</td>
              <td>
                <div class="action-row" @click.stop>
                  <NeoButton
                    icon="pi pi-eye"
                    size="small"
                    outlined
                    title="Aperçu administrateur"
                    @click="selectedProjectId = p.id"
                  />
                  <NeoButton
                    icon="pi pi-external-link"
                    size="small"
                    outlined
                    title="Ouvrir en détail (modules)"
                    @click="openProjectModules(p.id)"
                  />
                  <NeoButton
                    icon="pi pi-ellipsis-v"
                    size="small"
                    outlined
                    severity="secondary"
                    :title="`Plus d'actions pour ${p.name}`"
                    :aria-label="`Menu d'actions pour ${p.name}`"
                    @click="toggleMenu($event, p)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Row overflow menu — single shared instance, positioned per row click -->
    <Teleport to="body">
      <div
        v-if="menuOpenProject"
        class="ptr__overflow-menu"
        role="menu"
        :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }"
        @click="closeMenu"
      >
        <div class="ptr__overflow-group">Modules</div>
        <button role="menuitem" @click="goToModule('pm-project-questionnaire')">
          <i class="pi pi-list-check" /> Questionnaire
        </button>
        <button role="menuitem" @click="goToModule('pm-project-cahier')">
          <i class="pi pi-file-word" /> Cahier des charges
        </button>
        <button role="menuitem" @click="goToModule('pm-workpackages')">
          <i class="pi pi-list" /> Backlog (Work Packages)
        </button>
        <button role="menuitem" @click="goToModule('pm-gantt')">
          <i class="pi pi-calendar" /> Gantt
        </button>
        <button role="menuitem" @click="goToModule('pm-project-validations')">
          <i class="pi pi-shield" /> Validations
        </button>
        <button role="menuitem" @click="goToModule('pm-project-meetings')">
          <i class="pi pi-microphone" /> Réunions
        </button>
        <div class="ptr__overflow-sep" />
        <div class="ptr__overflow-group">Gestion</div>
        <button role="menuitem" @click="onEditFromMenu">
          <i class="pi pi-pencil" /> Modifier
        </button>
        <button role="menuitem" @click="onAssignFromMenu">
          <i class="pi pi-user-edit" /> Changer le chef de projet
        </button>
        <button role="menuitem" @click="onDuplicateFromMenu">
          <i class="pi pi-copy" /> Dupliquer
        </button>
        <button
          role="menuitem"
          :disabled="menuOpenProject.status === 'Archived'"
          @click="onArchiveFromMenu"
        >
          <i class="pi pi-inbox" /> Archiver
        </button>
        <div class="ptr__overflow-sep" />
        <button class="ptr__overflow-danger" role="menuitem" @click="onDeleteFromMenu">
          <i class="pi pi-trash" /> Supprimer
        </button>
      </div>
    </Teleport>

    <!-- Edit project dialog -->
    <ProjectEditDialog
      v-model:visible="showEdit"
      :project="editingProject"
      @updated="onProjectUpdated"
    />

    <!-- Assign manager dialog -->
    <AssignManagerDialog
      :visible="showAssign"
      :project-id="assignId"
      :project-name="assignName"
      @close="showAssign = false"
      @assigned="showAssign = false"
    />

    <!-- Duplicate dialog (AppModal — Esc closes, click-outside does NOT, so typed name isn't lost) -->
    <AppModal v-model:visible="showDuplicate" header="Dupliquer le projet" width="420px">
      <div class="dialog-body">
        <p class="dialog-hint">Saisissez le nom du nouveau projet (copie de « {{ duplicateSrcName }} »).</p>
        <div class="field-wrap">
          <label class="field-label">Nom du projet</label>
          <NeoInputText
            v-model="duplicateName"
            placeholder="Nom du projet dupliqué"
            class="w-full"
          />
        </div>
        <NeoMessage v-if="duplicateError" severity="error" :text="duplicateError" />
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="closeDuplicate" />
        <NeoButton
          label="Dupliquer"
          icon="pi pi-copy"
          :loading="duplicateLoading"
          :disabled="!duplicateName.trim()"
          @click="confirmDuplicate"
        />
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { NeoButton, NeoTag, NeoInputText, NeoSelect, NeoMessage, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import ProjectCreateForm from '@/components/admin/ProjectCreateForm.vue'
import ProjectDetailPanel from '@/components/admin/ProjectDetailPanel.vue'
import ProjectEditDialog from '@/components/admin/ProjectEditDialog.vue'
import AssignManagerDialog from '@/components/admin/AssignManagerDialog.vue'
import SavedFiltersPanel from '@/components/filters/SavedFiltersPanel.vue'
import FilterBuilder from '@/components/filters/FilterBuilder.vue'
import { useProjectStore } from '@/stores/projectStore'
import { useSavedFiltersStore } from '@/stores/savedFiltersStore'
import api from '@/lib/api'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus, ProjectSummary } from '@/types/project.types'
import type { FilterCriteria, SavedFilter } from '@/types/filter.types'

const store        = useProjectStore()
const filtersStore = useSavedFiltersStore()
const toast        = useNeoToast()
const confirm      = useNeoConfirm()
const router       = useRouter()

function openProjectModules(id: string) {
  router.push(`/app/pm/projects/${id}`)
}

// ─── Row overflow menu (single shared instance) ──────────────────────────────
const menuOpenProject = ref<ProjectSummary | null>(null)
const menuPos         = ref<{ top: number; left: number }>({ top: 0, left: 0 })

function toggleMenu(event: MouseEvent, project: ProjectSummary): void {
  if (menuOpenProject.value?.id === project.id) {
    menuOpenProject.value = null
    return
  }
  const btn = (event.currentTarget as HTMLElement | null) ?? (event.target as HTMLElement | null)
  if (btn) {
    const rect = btn.getBoundingClientRect()
    const MENU_WIDTH = 220
    // Approximate menu height: 11 items × ~30px + 2 group headers + 2 separators + padding ≈ 380px.
    // Flip the menu UP when there's not enough room below the trigger so the
    // delete button never falls off the viewport (especially when the page has
    // few projects and isn't scrollable). Pre-clamp inside the viewport too.
    const MENU_HEIGHT = 380
    const VIEWPORT_PAD = 8
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PAD
    const spaceAbove = rect.top - VIEWPORT_PAD
    const top = spaceBelow >= MENU_HEIGHT || spaceBelow >= spaceAbove
      ? rect.bottom + 4
      : Math.max(VIEWPORT_PAD, rect.top - MENU_HEIGHT - 4)
    menuPos.value = {
      top,
      left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
    }
  }
  menuOpenProject.value = project
}

function closeMenu(): void {
  menuOpenProject.value = null
}

function goToModule(routeName: string): void {
  const project = menuOpenProject.value
  if (!project) return
  closeMenu()
  router.push({ name: routeName, params: { id: project.id } })
}

function onAssignFromMenu(): void {
  const project = menuOpenProject.value
  if (!project) return
  closeMenu()
  openAssign(project.id, project.name)
}

function onEditFromMenu(): void {
  const project = menuOpenProject.value
  if (!project) return
  closeMenu()
  editingProject.value = project
  showEdit.value = true
}

async function onProjectUpdated(): Promise<void> {
  // The store's updateProject already patches the row in `store.projects`,
  // but we refetch to make sure derived fields the row didn't carry
  // (e.g. progressPct after a date change) stay in sync with the server.
  await store.fetchAll()
}

function onDuplicateFromMenu(): void {
  const project = menuOpenProject.value
  if (!project) return
  closeMenu()
  openDuplicate(project.id, project.name)
}

function onArchiveFromMenu(): void {
  const project = menuOpenProject.value
  if (!project || project.status === 'Archived') return
  closeMenu()
  handleArchive(project.id, project.name)
}

function onDeleteFromMenu(): void {
  const project = menuOpenProject.value
  if (!project) return
  closeMenu()
  handleDelete(project.id, project.name)
}

onMounted(() => document.addEventListener('click', closeMenu))
onUnmounted(() => document.removeEventListener('click', closeMenu))

const showForm          = ref(false)
const selectedProjectId = ref<string | null>(null)
const showAssign        = ref(false)
const assignId          = ref('')
const assignName        = ref('')
const showEdit          = ref(false)
const editingProject    = ref<ProjectSummary | null>(null)

// ─── Advanced filter state ────────────────────────────────────────────────────
const showFilterBuilder       = ref(false)
const filterBuilderRef        = ref<InstanceType<typeof FilterBuilder> | null>(null)
const currentFilterCriteria   = ref<FilterCriteria>({})
const activeFilterCount       = computed(() => {
  const c = currentFilterCriteria.value
  let n = 0
  if (c.search) n++
  if (c.status?.length) n++
  if (c.priority?.length) n++
  if (c.assignedToMe) n++
  if (c.dateRange?.from || c.dateRange?.to) n++
  return n
})

const onFilterChange = (criteria: FilterCriteria): void => {
  currentFilterCriteria.value = { ...criteria }
}

const onSavedFilterApply = (filter: SavedFilter): void => {
  currentFilterCriteria.value = { ...filter.filters }
  showFilterBuilder.value = true
}

// ─── Search & filter ──────────────────────────────────────────────────────────
const searchText   = ref('')
const statusFilter = ref<ProjectStatus | ''>('')

const statusFilterOptions = [
  { label: 'Tous les statuts', value: '' },
  ...Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({ label, value })),
]

const filteredProjects = computed(() => {
  const c = currentFilterCriteria.value

  // When advanced filter builder is open, use its criteria
  if (showFilterBuilder.value) {
    return store.projects.filter((p) => {
      if (c.search) {
        const q = c.search.toLowerCase()
        if (!p.name.toLowerCase().includes(q) && !p.clientName.toLowerCase().includes(q)) return false
      }
      if (c.status && c.status.length > 0 && !c.status.includes(p.status)) return false
      if (c.dateRange?.from && p.startDate && new Date(p.startDate) < new Date(c.dateRange.from)) return false
      if (c.dateRange?.to && p.endDate && new Date(p.endDate) > new Date(c.dateRange.to)) return false
      return true
    })
  }

  // Simple bar fallback
  const q = searchText.value.trim().toLowerCase()
  const s = statusFilter.value
  return store.projects.filter((p) => {
    const matchText = !q || p.name.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q)
    const matchStatus = !s || p.status === s
    return matchText && matchStatus
  })
})

// ─── CSV export ───────────────────────────────────────────────────────────────
const exportCsv = () => {
  const headers = ['Nom', 'Client', 'Statut', 'Chef de projet', 'Date début', 'Date fin', 'Créé le']
  const rows = store.projects.map((p) => [
    p.name,
    p.clientName,
    PROJECT_STATUS_LABELS[p.status],
    p.projectManagerName ?? '',
    p.startDate ? new Date(p.startDate).toLocaleDateString('fr-FR') : '',
    p.endDate   ? new Date(p.endDate).toLocaleDateString('fr-FR')   : '',
    new Date(p.createdAt).toLocaleDateString('fr-FR'),
  ])
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `projets_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Deadline badge helper ─────────────────────────────────────────────────────
const isNearDeadline = (p: ProjectSummary): boolean => {
  if (!p.endDate || p.status === 'Cloture' || p.status === 'Archived') return false
  const diff = new Date(p.endDate).getTime() - Date.now()
  return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000
}

// ─── Bulk selection ───────────────────────────────────────────────────────────
const selectedIds = ref<Set<string>>(new Set())

const allSelected = computed(
  () => filteredProjects.value.length > 0 && filteredProjects.value.every((p) => selectedIds.value.has(p.id)),
)
const someSelected = computed(
  () => filteredProjects.value.some((p) => selectedIds.value.has(p.id)) && !allSelected.value,
)

const toggleRow = (id: string) => {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

const toggleSelectAll = () => {
  if (allSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(filteredProjects.value.map((p) => p.id))
  }
}

const clearSelection = () => {
  selectedIds.value = new Set()
}

// ─── Duplicate ────────────────────────────────────────────────────────────────
const showDuplicate     = ref(false)
const duplicateSrcId    = ref('')
const duplicateSrcName  = ref('')
const duplicateName     = ref('')
const duplicateError    = ref('')
const duplicateLoading  = ref(false)

const openDuplicate = (id: string, name: string) => {
  duplicateSrcId.value   = id
  duplicateSrcName.value = name
  duplicateName.value    = `Copie de ${name}`
  duplicateError.value   = ''
  showDuplicate.value    = true
}

const closeDuplicate = () => {
  showDuplicate.value  = false
  duplicateError.value = ''
}

const confirmDuplicate = async () => {
  if (!duplicateName.value.trim()) return
  duplicateLoading.value = true
  duplicateError.value   = ''
  try {
    await api.post(
      `/admin/project/${duplicateSrcId.value}/duplicate`,
      { name: duplicateName.value.trim() },
    )
    toast.add({ severity: 'success', detail: `Projet dupliqué : « ${duplicateName.value.trim()} ».`, life: 3000 })
    closeDuplicate()
    await store.fetchAll()
  } catch {
    duplicateError.value = 'Erreur lors de la duplication du projet.'
  } finally {
    duplicateLoading.value = false
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(() => store.fetchAll())

// ─── Helpers ─────────────────────────────────────────────────────────────────
const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR') : '—'

const openAssign = (id: string, name: string) => {
  assignId.value   = id
  assignName.value = name
  showAssign.value = true
}

// ─── Actions ──────────────────────────────────────────────────────────────────
const handleArchive = (id: string, name: string) => {
  confirm.require({
    message: `Archiver le projet « ${name} » ?`,
    header: "Confirmer l'archivage",
    icon: 'pi pi-inbox',
    acceptLabel: 'Archiver',
    rejectLabel: 'Annuler',
    accept: async () => {
      await store.archiveProject(id)
      toast.add({ severity: 'info', detail: `Projet « ${name} » archivé.`, life: 3000 })
    },
  })
}

const handleDelete = (id: string, name: string) => {
  confirm.require({
    message: `Supprimer définitivement le projet « ${name} » ? Cette action est irréversible.`,
    header: 'Confirmer la suppression',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    accept: async () => {
      await store.deleteProject(id)
      toast.add({ severity: 'success', detail: `Projet « ${name} » supprimé.`, life: 3000 })
    },
  })
}

const handleBulkArchive = () => {
  if (selectedIds.value.size === 0) return
  confirm.require({
    message: `Archiver ${selectedIds.value.size} projet(s) ?`,
    header: 'Confirmation',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Archiver',
    rejectLabel: 'Annuler',
    accept: async () => {
      try {
        await api.post('/admin/project/bulk-archive', { projectIds: [...selectedIds.value] })
        toast.add({ severity: 'success', detail: `${selectedIds.value.size} projet(s) archivé(s).`, life: 3000 })
        selectedIds.value = new Set()
        await store.fetchAll()
      } catch {
        toast.add({ severity: 'error', detail: "Erreur lors de l'archivage.", life: 4000 })
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

.section-title { font-size: 1.25rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.section-sub   { font-size: 0.85rem; color: var(--nl-text-3); margin: 0.2rem 0 0; }

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem;
  color: var(--nl-text-3);
}
.empty-state i { font-size: 2.5rem; }

.project-table-wrap { overflow-x: auto; }

/* ── Header actions ──────────────────────────────────────────────────────────── */
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* ── Filter bar ──────────────────────────────────────────────────────────────── */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.filter-search {
  flex: 1;
  min-width: 200px;
}

.filter-status {
  min-width: 200px;
}

/* ── Bulk action bar ─────────────────────────────────────────────────────────── */
.bulk-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: var(--nl-radius);
  padding: 0.6rem 1rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}
.bulk-count {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1d4ed8;
  flex: 1;
}
:global(.dark) .bulk-bar { background: rgba(59,130,246,0.12); border-color: rgba(59,130,246,0.25); }
:global(.dark) .bulk-count { color: #93c5fd; }

/* ── Table ───────────────────────────────────────────────────────────────────── */
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

.col-check { width: 2.5rem; text-align: center; }
.row-checkbox { cursor: pointer; width: 1rem; height: 1rem; accent-color: var(--nl-accent); }

.row--selected td { background: #f0fdfa !important; }
:global(.dark) .row--selected td { background: rgba(13,148,136,0.12) !important; }

.cell-name { font-weight: 600; color: var(--nl-text-1); }
.cell-date { white-space: nowrap; color: var(--nl-text-3); font-size: 0.8rem; }

.action-row { display: flex; gap: 0.4rem; }

/* ── Duplicate dialog ────────────────────────────────────────────────────────── */
.dialog-body { display: flex; flex-direction: column; gap: 1rem; padding: 0.25rem 0; }
.dialog-hint { margin: 0; font-size: 0.85rem; color: var(--nl-text-3); }
.field-wrap { display: flex; flex-direction: column; gap: 0.3rem; }
.field-label { font-size: 0.82rem; color: var(--nl-text-3); font-weight: 500; }

/* ── Saved filters & builder ─────────────────────────────────────────────────── */
.saved-filters-row {
  margin-bottom: 0.75rem;
}

.filter-builder-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.filter-active-badge {
  background: var(--nl-accent);
  color: #fff;
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
}

.filter-builder-panel {
  margin-bottom: 0.75rem;
}
</style>
