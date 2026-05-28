<!-- @file src/views/WorkPackagesView.vue — Work Packages list + detail with split panel -->
<template>
  <ProjectModuleShell :project-id="projectId" title="Work Packages">
    <template #actions>
      <NeoButton
        v-if="canUseAi"
        label="Générer backlog IA"
        icon="pi pi-sparkles"
        severity="secondary"
        @click="showAiBacklog = true"
      />
      <NeoButton label="Nouveau" icon="pi pi-plus" @click="showCreate = true" />
    </template>

    <div class="wp-view__toolbar">
      <!-- Quick filter pills -->
      <div class="wp-view__pills">
        <button
          v-for="p in pills"
          :key="p.key"
          class="nl-pill"
          :class="{ 'nl-pill--active': activePill === p.key }"
          @click="activatePill(p.key)"
        >
          <i class="pi" :class="p.icon" />
          {{ p.label }}
          <span v-if="pillCount(p.key) > 0" class="wp-view__pill-count">{{ pillCount(p.key) }}</span>
        </button>
      </div>

      <div class="wp-view__controls">
        <NeoInputText v-model="filters.q" placeholder="Rechercher… (/)" @input="load" />
        <NeoSelect
          v-model="filters.status" :options="statusOptions"
          optionLabel="label" optionValue="value" placeholder="Statut"
          @change="load"
        />
        <NeoSelect
          v-model="filters.type" :options="typeOptions"
          optionLabel="label" optionValue="value" placeholder="Type"
          @change="load"
        />
        <NeoSelect
          v-model="groupBy" :options="groupByOptions"
          optionLabel="label" optionValue="value" placeholder="Grouper"
        />
      </div>
    </div>

    <!-- Bulk action bar (only when selection present) -->
    <div v-if="selectedIds.size > 0" class="wp-view__bulk">
      <span class="wp-view__bulk-count">{{ selectedIds.size }} sélectionné(s)</span>
      <NeoSelect
        v-model="bulkStatus" :options="statusOptions.slice(1)"
        optionLabel="label" optionValue="value" placeholder="→ Changer statut"
        @change="onBulkStatus"
      />
      <NeoButton label="Effacer" severity="secondary" outlined size="small" @click="clearSelection" />
    </div>

    <SplitPanel :show-detail="!!selectedId">
      <template #list>
        <table class="wp-table">
          <thead>
            <tr>
              <th class="wp-table__check">
                <input
                  id="wp-select-all"
                  type="checkbox"
                  :checked="allVisibleSelected"
                  :indeterminate="someVisibleSelected"
                  aria-label="Tout sélectionner"
                  @change="toggleSelectAll"
                />
              </th>
              <th>Titre</th>
              <th>Type</th>
              <th>Statut</th>
              <th>Priorité</th>
              <th>Assigné à</th>
              <th>Échéance</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody v-for="group in groupedRows" :key="group.key">
            <tr v-if="groupBy !== 'none' && group.label" class="wp-table__group">
              <td colspan="8">
                <i class="pi pi-angle-down" /> <strong>{{ group.label }}</strong>
                <span class="wp-table__group-count">· {{ group.items.length }}</span>
              </td>
            </tr>
            <tr
              v-for="wp in group.items"
              :key="wp.id"
              class="wp-table__row"
              :class="{ 'wp-table__row--active': selectedId === wp.id, 'wp-table__row--selected': selectedIds.has(wp.id) }"
              @click="selectedId = wp.id"
            >
              <td class="wp-table__check" @click.stop>
                <input
                  :id="`wp-check-${wp.id}`"
                  type="checkbox"
                  :checked="selectedIds.has(wp.id)"
                  aria-label="Sélectionner"
                  @change="toggleOne(wp.id)"
                />
              </td>
              <td class="wp-table__title">{{ wp.title }}</td>
              <td><NeoTag :value="wp.type" severity="secondary" /></td>
              <td><WpStatusTag :status="wp.status" /></td>
              <td><PriorityDot :priority="wp.priority" /> {{ wp.priority }}</td>
              <td>{{ wp.assignee ? `${wp.assignee.firstName} ${wp.assignee.lastName}` : '—' }}</td>
              <td>{{ wp.dueDate ? formatDate(wp.dueDate) : '—' }}</td>
              <td>
                <div class="wp-progress">
                  <div class="wp-progress__bar" :style="{ width: wp.percentDone + '%' }" />
                </div>
              </td>
            </tr>
          </tbody>
          <tbody v-if="!store.loading && visibleRows.length === 0">
            <tr><td colspan="8" class="wp-empty">Aucun work package.</td></tr>
          </tbody>
        </table>
      </template>

      <template #detail>
        <WorkPackageDetail
          v-if="selectedId"
          :project-id="projectId"
          :work-package-id="selectedId"
          @close="selectedId = null"
          @deleted="onDeleted"
        />
      </template>
    </SplitPanel>

  </ProjectModuleShell>

  <AppModal v-model:visible="showCreate" header="Nouveau work package" width="520px">
      <div class="wp-form">
        <NeoInputText v-model="form.title" label="Titre *" placeholder="Titre" />
        <NeoSelect v-model="form.type" :options="typeOptions" optionLabel="label" optionValue="value" placeholder="Type" />
        <NeoSelect v-model="form.priority" :options="priorityOptions" optionLabel="label" optionValue="value" placeholder="Priorité" />
        <NeoDatePicker v-model="form.dueDate" dateFormat="yy-mm-dd" placeholder="Échéance" />
        <textarea v-model="form.description" class="wp-form__textarea" placeholder="Description" />
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showCreate = false" />
        <NeoButton label="Créer" icon="pi pi-check" :loading="creating" @click="submitCreate" />
      </template>
    </AppModal>

  <AiBacklogPreviewModal
    v-model:visible="showAiBacklog"
    :project-id="projectId"
    @accepted="onAiBacklogAccepted"
  />
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { NeoButton, NeoInputText, NeoSelect, NeoDatePicker, NeoTag, useNeoToast } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import { formatDate } from '@/lib/formatDate'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import SplitPanel from '@/components/common/SplitPanel.vue'
import PriorityDot from '@/components/common/PriorityDot.vue'
import WpStatusTag from '@/components/common/WpStatusTag.vue'
import WorkPackageDetail from '@/components/workpackages/WorkPackageDetail.vue'
import AiBacklogPreviewModal from '@/components/pm/AiBacklogPreviewModal.vue'
import { useWorkPackageStore } from '@/stores/workPackageStore'
import { useAuthStore } from '@/stores/authStore'
import type { WpType, WpPriority, WpStatus, WorkPackage } from '@/types/work-package.types'

const props = defineProps<{ id: string }>()
const route = useRoute()
const toast = useNeoToast()
const store = useWorkPackageStore()
const authStore = useAuthStore()

const projectId = ref(props.id || (route.params.id as string))
const selectedId = ref<string | null>(null)
const showCreate = ref(false)
const showAiBacklog = ref(false)
const canUseAi = computed(
  () => authStore.userRole === 'ProjectManager' || authStore.userRole === 'Admin',
)
const creating = ref(false)

const filters = reactive<{ q: string; status: string; type: string }>({ q: '', status: '', type: '' })

// Quick-filter pills
type PillKey = 'all' | 'due-soon' | 'overdue' | 'unassigned'
const pills: { key: PillKey; label: string; icon: string }[] = [
  { key: 'all',        label: 'Tout',         icon: 'pi-list' },
  { key: 'due-soon',   label: 'Dues ≤ 7 j',   icon: 'pi-calendar' },
  { key: 'overdue',    label: 'En retard',    icon: 'pi-exclamation-triangle' },
  { key: 'unassigned', label: 'Non assignés', icon: 'pi-user-minus' },
]
const activePill = ref<PillKey>('all')
function activatePill(key: PillKey): void { activePill.value = key }

function matchesPill(wp: WorkPackage, key: PillKey): boolean {
  const now = Date.now()
  switch (key) {
    case 'all':        return true
    case 'due-soon': {
      if (!wp.dueDate) return false
      const d = new Date(wp.dueDate).getTime()
      return d >= now && d <= now + 7 * 24 * 60 * 60 * 1000
    }
    case 'overdue':    return !!wp.dueDate && new Date(wp.dueDate).getTime() < now && wp.status !== 'Closed' && wp.status !== 'Resolved'
    case 'unassigned': return !wp.assigneeId
  }
}

function pillCount(key: PillKey): number {
  if (key === 'all') return 0
  return store.items.filter((wp) => matchesPill(wp, key)).length
}

// Selection
const selectedIds = ref<Set<string>>(new Set())
function toggleOne(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  selectedIds.value = next
}
function clearSelection(): void { selectedIds.value = new Set() }
const allVisibleSelected  = computed<boolean>(() => visibleRows.value.length > 0 && visibleRows.value.every((wp) => selectedIds.value.has(wp.id)))
const someVisibleSelected = computed<boolean>(() => visibleRows.value.some((wp) => selectedIds.value.has(wp.id)) && !allVisibleSelected.value)
function toggleSelectAll(): void {
  if (allVisibleSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(visibleRows.value.map((wp) => wp.id))
  }
}

// Bulk status change
const bulkStatus = ref<string>('')
async function onBulkStatus(): Promise<void> {
  if (!bulkStatus.value || selectedIds.value.size === 0) return
  const ids = Array.from(selectedIds.value)
  const newStatus = bulkStatus.value as WpStatus
  const results = await Promise.allSettled(ids.map((id) => store.update(projectId.value, id, { status: newStatus })))
  const failures = results.filter((r) => r.status === 'rejected').length
  const successes = results.length - failures
  if (failures === 0) {
    toast.add({ severity: 'success', detail: `${successes} WP mis à jour`, life: 3000 })
  } else {
    toast.add({ severity: 'warn', detail: `${successes} mis à jour, ${failures} échec(s)`, life: 4000 })
  }
  clearSelection()
  bulkStatus.value = ''
  await load()
}

// Group-by
type GroupKey = 'none' | 'status' | 'priority' | 'assignee'
const groupBy = ref<GroupKey>('none')
const groupByOptions: { label: string; value: GroupKey }[] = [
  { label: 'Sans groupe',      value: 'none' },
  { label: 'Par statut',       value: 'status' },
  { label: 'Par priorité',     value: 'priority' },
  { label: "Par assigné",      value: 'assignee' },
]

const visibleRows = computed<WorkPackage[]>(() =>
  store.items.filter((wp) => matchesPill(wp, activePill.value)),
)

const groupedRows = computed<{ key: string; label: string; items: WorkPackage[] }[]>(() => {
  if (groupBy.value === 'none') {
    return [{ key: 'all', label: '', items: visibleRows.value }]
  }
  const buckets = new Map<string, WorkPackage[]>()
  for (const wp of visibleRows.value) {
    let key = 'Autre'
    if (groupBy.value === 'status')   key = wp.status
    if (groupBy.value === 'priority') key = wp.priority
    if (groupBy.value === 'assignee') key = wp.assignee ? `${wp.assignee.firstName} ${wp.assignee.lastName}` : 'Non assigné'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(wp)
  }
  return Array.from(buckets.entries()).map(([k, items]) => ({ key: k, label: k, items }))
})

const form = reactive<{
  title: string
  type: WpType
  priority: WpPriority
  dueDate: string | null
  description: string
}>({ title: '', type: 'Task', priority: 'Normal', dueDate: null, description: '' })

const statusOptions: { label: string; value: WpStatus | '' }[] = [
  { label: 'Tous statuts', value: '' },
  { label: 'Nouveau', value: 'New' },
  { label: 'En cours', value: 'InProgress' },
  { label: 'En attente de validation', value: 'AwaitingReview' },
  { label: 'Résolu', value: 'Resolved' },
]
const typeOptions: { label: string; value: WpType | '' }[] = [
  { label: 'Tous types', value: '' },
  { label: 'Tâche', value: 'Task' },
  { label: 'Bug', value: 'Bug' },
  { label: 'Feature', value: 'Feature' },
  { label: 'Epic', value: 'Epic' },
  { label: 'Jalon', value: 'Milestone' },
  { label: 'Incident', value: 'Incident' },
]
const priorityOptions: { label: string; value: WpPriority }[] = [
  { label: 'Basse', value: 'Low' },
  { label: 'Normale', value: 'Normal' },
  { label: 'Haute', value: 'High' },
  { label: 'Urgente', value: 'Urgent' },
  { label: 'Immédiate', value: 'Immediate' },
]

// Keyboard shortcut: `c` dispatches window event `neoleadge:create-wp` — listen for it
function onCreateShortcut() { showCreate.value = true }
onMounted(() => window.addEventListener('neoleadge:create-wp', onCreateShortcut))
onUnmounted(() => window.removeEventListener('neoleadge:create-wp', onCreateShortcut))

async function load() {
  await store.fetchAll(projectId.value, {
    q: filters.q || undefined,
    status: filters.status || undefined,
    type: filters.type || undefined,
  })
}

async function onAiBacklogAccepted() {
  await load()
}

async function submitCreate() {
  if (!form.title.trim()) {
    toast.add({ severity: 'warn', detail: 'Titre requis.', life: 3000 })
    return
  }
  creating.value = true
  try {
    const wp = await store.create(projectId.value, {
      title: form.title.trim(),
      type: form.type,
      priority: form.priority,
      dueDate: form.dueDate ?? undefined,
      description: form.description || undefined,
    })
    if (wp) {
      toast.add({ severity: 'success', detail: 'Work package créé.', life: 3000 })
      showCreate.value = false
      form.title = ''
      form.description = ''
      form.dueDate = null
      selectedId.value = wp.id
    } else {
      toast.add({ severity: 'error', detail: 'Échec.', life: 3000 })
    }
  } finally {
    creating.value = false
  }
}

function onDeleted(id: string) {
  toast.add({ severity: 'success', detail: 'Supprimé.', life: 3000 })
  if (selectedId.value === id) selectedId.value = null
}

onMounted(load)
</script>

<style scoped>
.wp-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--nl-bg, #f5f7f9);
}
.wp-view__filters {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background: var(--nl-card-bg, #fff);
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
  flex-wrap: wrap;
  align-items: center;
}
.wp-view__filters > * { min-width: 160px; }

.wp-view__toolbar {
  display: flex; flex-direction: column; gap: var(--nl-sp-2);
  padding: var(--nl-sp-3) var(--nl-sp-6);
  background: var(--nl-surface);
  border-bottom: 1px solid var(--nl-border);
}
.wp-view__pills {
  display: flex; gap: var(--nl-sp-1); flex-wrap: wrap;
}
.wp-view__pills .nl-pill { cursor: pointer; border: 1px solid transparent; background: transparent; }
.wp-view__pills .nl-pill:hover { background: var(--nl-surface-2); }
.wp-view__pill-count {
  background: var(--nl-surface-2); color: var(--nl-text-2);
  padding: 0 6px; border-radius: var(--nl-radius-pill);
  font-size: 10px; font-weight: 700;
}
.wp-view__pills .nl-pill--active .wp-view__pill-count {
  background: var(--nl-accent); color: #fff;
}
.wp-view__controls {
  display: flex; gap: var(--nl-sp-2); align-items: center; flex-wrap: wrap;
}
.wp-view__controls > *:first-child { flex: 1; min-width: 200px; }
.wp-view__controls > :not(:first-child) { min-width: 160px; }

.wp-view__bulk {
  display: flex; align-items: center; gap: var(--nl-sp-2);
  padding: var(--nl-sp-2) var(--nl-sp-6);
  background: var(--nl-accent-light);
  border-bottom: 1px solid var(--nl-accent);
}
.wp-view__bulk-count { font-weight: 600; color: var(--nl-accent); font-size: var(--nl-fs-sm); }

.wp-table__check { width: 36px; text-align: center; }
.wp-table__check input[type="checkbox"] { cursor: pointer; }
.wp-table__row--selected { background: var(--nl-row-selected) !important; }
.wp-table__group {
  background: var(--nl-surface-2);
}
.wp-table__group td {
  padding: var(--nl-sp-2) var(--nl-sp-3) !important;
  font-size: var(--nl-fs-sm); color: var(--nl-text-2);
}
.wp-table__group td .pi { margin-right: 4px; font-size: 10px; }
.wp-table__group-count { color: var(--nl-text-3); margin-left: 4px; }
:deep(.split-panel) { flex: 1; min-height: 0; }

.wp-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--nl-card-bg, #fff);
  font-size: 0.875rem;
}
.wp-table thead th {
  text-align: left;
  padding: 0.75rem 0.75rem;
  background: var(--nl-table-header-bg, #f3f4f6);
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
  font-weight: 600;
  color: var(--nl-text-muted, #6b7280);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.wp-table__row { cursor: pointer; border-bottom: 1px solid var(--nl-border, #e5e7eb); }
.wp-table__row:hover { background: var(--nl-row-hover); }
.wp-table__row--active { background: var(--nl-row-selected); }
.wp-table__row td { padding: 0.75rem 0.75rem; vertical-align: middle; }
.wp-table__title { font-weight: 500; color: var(--nl-text, #111827); }
.wp-empty { text-align: center; color: var(--nl-text-muted, #6b7280); padding: 2rem !important; }

.wp-progress {
  width: 60px;
  height: 6px;
  background: var(--nl-border, #e5e7eb);
  border-radius: 3px;
  overflow: hidden;
}
.wp-progress__bar {
  height: 100%;
  background: var(--nl-accent, #1e9e8f);
  transition: width 0.3s;
}

.wp-form { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.5rem 0; }
.wp-form__textarea {
  min-height: 100px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--nl-border, #d1d5db);
  border-radius: 6px;
  font-family: inherit;
  resize: vertical;
}
</style>
