<!--
  @file     SavedFiltersPanel.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Panel listing saved filters with apply / edit / delete / set-default actions
-->
<template>
  <div class="sfp">
    <div class="sfp__header">
      <h3 class="sfp__title">Filtres sauvegardés</h3>
      <NeoButton
        label="Sauvegarder"
        icon="pi pi-bookmark"
        outlined
        size="small"
        @click="openSaveDialog"
      />
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="sfp__loading">
      <i class="pi pi-spin pi-spinner" />
    </div>

    <!-- Empty state -->
    <div v-else-if="store.filters.length === 0" class="sfp__empty">
      <i class="pi pi-filter-slash" />
      <p>Aucun filtre sauvegardé.</p>
    </div>

    <!-- Filter list -->
    <ul v-else class="sfp__list">
      <li
        v-for="filter in store.filters"
        :key="filter.id"
        :class="['sfp__item', { 'sfp__item--active': store.activeFilter?.id === filter.id }]"
      >
        <div class="sfp__item-header">
          <span class="sfp__item-name">{{ filter.name }}</span>
          <NeoTag
            v-if="filter.isDefault"
            value="Défaut"
            severity="success"
            class="sfp__default-tag"
          />
        </div>

        <!-- Criteria chips -->
        <div class="sfp__chips">
          <NeoTag
            v-for="chip in buildChips(filter.filters)"
            :key="chip.label"
            :value="chip.label"
            :severity="toTagSeverity(chip.severity)"
            class="sfp__chip"
          />
        </div>

        <!-- Actions -->
        <div class="sfp__actions">
          <NeoButton
            label="Appliquer"
            size="small"
            :outlined="store.activeFilter?.id !== filter.id"
            @click="applyFilter(filter)"
          />
          <NeoButton
            icon="pi pi-star"
            text
            severity="secondary"
            size="small"
            :title="filter.isDefault ? 'Filtre par défaut' : 'Définir comme défaut'"
            :disabled="filter.isDefault"
            @click="store.setDefault(filter.id)"
          />
          <NeoButton
            icon="pi pi-pencil"
            text
            severity="secondary"
            size="small"
            title="Renommer"
            @click="openEditDialog(filter)"
          />
          <NeoButton
            icon="pi pi-trash"
            text
            severity="danger"
            size="small"
            title="Supprimer"
            @click="confirmDelete(filter)"
          />
        </div>
      </li>
    </ul>

    <!-- Save dialog -->
    <Dialog
      v-model:visible="showSaveDialog"
      header="Sauvegarder le filtre"
      modal
      :style="{ width: '22rem' }"
    >
      <div class="sfp__dialog-body">
        <NeoInputText
          v-model="dialogName"
          label="Nom du filtre"
          placeholder="Ex : Projets urgents"
          @keyup.enter="handleSave"
        />
      </div>
      <template #footer>
        <NeoButton
          label="Annuler"
          outlined
          severity="secondary"
          @click="showSaveDialog = false"
        />
        <NeoButton
          label="Sauvegarder"
          :disabled="!dialogName.trim()"
          :loading="store.loading"
          @click="handleSave"
        />
      </template>
    </Dialog>

    <!-- Edit dialog -->
    <Dialog
      v-model:visible="showEditDialog"
      header="Renommer le filtre"
      modal
      :style="{ width: '22rem' }"
    >
      <div class="sfp__dialog-body">
        <NeoInputText
          v-model="dialogName"
          label="Nouveau nom"
          placeholder="Nom du filtre"
          @keyup.enter="handleEdit"
        />
      </div>
      <template #footer>
        <NeoButton
          label="Annuler"
          outlined
          severity="secondary"
          @click="showEditDialog = false"
        />
        <NeoButton
          label="Renommer"
          :disabled="!dialogName.trim()"
          :loading="store.loading"
          @click="handleEdit"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">

type NeoTagSeverity = 'success' | 'info' | 'warn' | 'warning' | 'danger' | 'secondary' | 'contrast'
const VALID_SEVERITIES = new Set<string>(['success', 'info', 'warn', 'warning', 'danger', 'secondary', 'contrast'])
function toTagSeverity(val: string | undefined): NeoTagSeverity {
  return (val !== undefined && VALID_SEVERITIES.has(val) ? val : 'secondary') as NeoTagSeverity
}

import { ref } from 'vue'
import { NeoButton, NeoTag, NeoInputText } from '@neolibrary/components'
import Dialog from 'primevue/dialog'
import { useNeoToast } from '@neolibrary/components'
import { useSavedFiltersStore } from '@/stores/savedFiltersStore'
import { PROJECT_STATUS_LABELS } from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'
import { PRIORITY_LABELS } from '@/types/filter.types'
import type { FilterCriteria, Priority, SavedFilter } from '@/types/filter.types'

// ─── Props & Emits ────────────────────────────────────────────────────────────
interface Props {
  currentCriteria?: FilterCriteria
}

const props = withDefaults(defineProps<Props>(), {
  currentCriteria: () => ({}),
})

const emit = defineEmits<{
  apply: [filter: SavedFilter]
}>()

// ─── Store & Toast ────────────────────────────────────────────────────────────
const store = useSavedFiltersStore()
const toast = useNeoToast()

// ─── Dialog state ─────────────────────────────────────────────────────────────
const showSaveDialog = ref(false)
const showEditDialog = ref(false)
const dialogName = ref('')
const editingFilterId = ref<string | null>(null)

// ─── Chip builder ─────────────────────────────────────────────────────────────
interface Chip { label: string; severity: string }

const buildChips = (criteria: FilterCriteria): Chip[] => {
  const chips: Chip[] = []
  if (criteria.search) {
    chips.push({ label: `"${criteria.search}"`, severity: 'secondary' })
  }
  for (const s of criteria.status ?? []) {
    chips.push({
      label: PROJECT_STATUS_LABELS[s as ProjectStatus] ?? s,
      severity: 'info',
    })
  }
  for (const p of criteria.priority ?? []) {
    chips.push({
      label: PRIORITY_LABELS[p as Priority] ?? p,
      severity: 'warning',
    })
  }
  if (criteria.assignedToMe) {
    chips.push({ label: 'Assigné à moi', severity: 'success' })
  }
  if (criteria.dateRange?.from || criteria.dateRange?.to) {
    const from = criteria.dateRange.from ?? '…'
    const to = criteria.dateRange.to ?? '…'
    chips.push({ label: `${from} → ${to}`, severity: 'secondary' })
  }
  return chips
}

// ─── Actions ──────────────────────────────────────────────────────────────────
const applyFilter = (filter: SavedFilter): void => {
  store.applyFilter(filter)
  emit('apply', filter)
}

const openSaveDialog = (): void => {
  dialogName.value = ''
  showSaveDialog.value = true
}

const openEditDialog = (filter: SavedFilter): void => {
  editingFilterId.value = filter.id
  dialogName.value = filter.name
  showEditDialog.value = true
}

const handleSave = async (): Promise<void> => {
  if (!dialogName.value.trim()) return
  const result = await store.create(dialogName.value, { ...props.currentCriteria })
  if (result) {
    toast.add({ severity: 'success', detail: `Filtre "${result.name}" sauvegardé.`, life: 3000 })
    showSaveDialog.value = false
  } else {
    toast.add({ severity: 'error', detail: store.error ?? 'Erreur lors de la sauvegarde.', life: 4000 })
  }
}

const handleEdit = async (): Promise<void> => {
  if (!editingFilterId.value || !dialogName.value.trim()) return
  const result = await store.update(editingFilterId.value, { name: dialogName.value })
  if (result) {
    toast.add({ severity: 'success', detail: 'Filtre renommé.', life: 3000 })
    showEditDialog.value = false
    editingFilterId.value = null
  } else {
    toast.add({ severity: 'error', detail: store.error ?? 'Erreur lors du renommage.', life: 4000 })
  }
}

const confirmDelete = async (filter: SavedFilter): Promise<void> => {
  await store.remove(filter.id)
  if (!store.error) {
    toast.add({ severity: 'success', detail: `Filtre "${filter.name}" supprimé.`, life: 3000 })
  } else {
    toast.add({ severity: 'error', detail: store.error, life: 4000 })
  }
}
</script>

<style scoped>
.sfp {
  background: var(--surface-0, #fff);
  border: 1px solid var(--surface-200, #e2e8f0);
  border-radius: 0.75rem;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 16rem;
}

.sfp__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sfp__title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-color, #1e293b);
  margin: 0;
}

.sfp__loading,
.sfp__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  color: var(--text-color-secondary, #64748b);
  font-size: 0.85rem;
}

.sfp__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sfp__item {
  border: 1px solid var(--surface-200, #e2e8f0);
  border-radius: 0.5rem;
  padding: 0.65rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  transition: border-color 0.15s;
}

.sfp__item--active {
  border-color: #0d9488;
  background: #f0fdfa;
}

.sfp__item-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.sfp__item-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-color, #1e293b);
  flex: 1;
}

.sfp__default-tag {
  font-size: 0.7rem;
}

.sfp__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.sfp__chip {
  font-size: 0.7rem;
}

.sfp__actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.sfp__dialog-body {
  padding: 0.5rem 0 1rem;
}
</style>
