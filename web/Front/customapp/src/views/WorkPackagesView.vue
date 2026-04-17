<!-- @file src/views/WorkPackagesView.vue — Work Packages list + detail with split panel -->
<template>
  <ProjectModuleShell :project-id="projectId" title="Work Packages">
    <template #actions>
      <NeoButton label="Nouveau" icon="pi pi-plus" @click="showCreate = true" />
    </template>

    <div class="wp-view__filters">
      <NeoInputText v-model="filters.q" placeholder="Rechercher..." />
      <NeoSelect
        v-model="filters.status"
        :options="statusOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Statut"
      />
      <NeoSelect
        v-model="filters.type"
        :options="typeOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Type"
      />
      <NeoButton label="Appliquer" icon="pi pi-filter" outlined @click="load" />
    </div>

    <SplitPanel :show-detail="!!selectedId">
      <template #list>
        <table class="wp-table">
          <thead>
            <tr>
              <th>Titre</th>
              <th>Type</th>
              <th>Statut</th>
              <th>Priorité</th>
              <th>Assigné à</th>
              <th>Échéance</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="wp in store.items"
              :key="wp.id"
              class="wp-table__row"
              :class="{ 'wp-table__row--active': selectedId === wp.id }"
              @click="selectedId = wp.id"
            >
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
            <tr v-if="!store.loading && store.items.length === 0">
              <td colspan="7" class="wp-empty">Aucun work package.</td>
            </tr>
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
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { NeoButton, NeoInputText, NeoSelect, NeoDatePicker, NeoTag, useNeoToast } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import { formatDate } from '@/lib/formatDate'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import SplitPanel from '@/components/common/SplitPanel.vue'
import PriorityDot from '@/components/common/PriorityDot.vue'
import WpStatusTag from '@/components/common/WpStatusTag.vue'
import WorkPackageDetail from '@/components/workpackages/WorkPackageDetail.vue'
import { useWorkPackageStore } from '@/stores/workPackageStore'
import type { WpType, WpPriority, WpStatus } from '@/types/work-package.types'

const props = defineProps<{ id: string }>()
const route = useRoute()
const toast = useNeoToast()
const store = useWorkPackageStore()

const projectId = ref(props.id || (route.params.id as string))
const selectedId = ref<string | null>(null)
const showCreate = ref(false)
const creating = ref(false)

const filters = reactive<{ q: string; status: string; type: string }>({ q: '', status: '', type: '' })

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
  { label: 'Résolu', value: 'Resolved' },
  { label: 'Fermé', value: 'Closed' },
  { label: 'En attente', value: 'OnHold' },
]
const typeOptions: { label: string; value: WpType | '' }[] = [
  { label: 'Tous types', value: '' },
  { label: 'Tâche', value: 'Task' },
  { label: 'Bug', value: 'Bug' },
  { label: 'Feature', value: 'Feature' },
  { label: 'Epic', value: 'Epic' },
  { label: 'Jalon', value: 'Milestone' },
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
.wp-table__row:hover { background: rgba(30,158,143,0.04); }
.wp-table__row--active { background: rgba(30,158,143,0.10); }
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
