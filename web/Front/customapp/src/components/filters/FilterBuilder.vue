<!--
  @file     FilterBuilder.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Visual filter builder — status, priority, assignedToMe, search, date range
-->
<template>
  <div class="filter-builder">
    <div class="filter-builder__header">
      <h3 class="filter-builder__title">Filtres</h3>
      <span v-if="activeCount > 0" class="filter-builder__badge">{{ activeCount }}</span>
      <NeoButton
        v-if="activeCount > 0"
        label="Réinitialiser"
        text
        severity="secondary"
        size="small"
        @click="resetAll"
      />
    </div>

    <div class="filter-builder__fields">
      <!-- Search -->
      <div class="filter-builder__field">
        <label class="filter-builder__label">Recherche</label>
        <NeoInputText
          v-model="localSearch"
          placeholder="Nom ou client…"
          @input="emitChange"
        />
      </div>

      <!-- Status multi-select -->
      <div class="filter-builder__field">
        <label class="filter-builder__label">Statut</label>
        <NeoSelect
          v-model="localStatus"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les statuts"
          @change="emitChange"
        />
        <div v-if="localStatus.length > 0" class="filter-builder__chips">
          <NeoTag
            v-for="s in localStatus"
            :key="s"
            :value="PROJECT_STATUS_LABELS[s as ProjectStatus] ?? s"
            :severity="toTagSeverity(PROJECT_STATUS_SEVERITY[s as ProjectStatus])"
            class="filter-builder__chip"
          >
            <template #default>
              {{ PROJECT_STATUS_LABELS[s as ProjectStatus] ?? s }}
              <button class="filter-builder__chip-remove" @click="removeStatus(s)">×</button>
            </template>
          </NeoTag>
        </div>
      </div>

      <!-- Priority multi-select -->
      <div class="filter-builder__field">
        <label class="filter-builder__label">Priorité</label>
        <NeoSelect
          v-model="localPriority"
          :options="priorityOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Toutes les priorités"
          @change="emitChange"
        />
        <div v-if="localPriority.length > 0" class="filter-builder__chips">
          <NeoTag
            v-for="p in localPriority"
            :key="p"
            :value="PRIORITY_LABELS[p as Priority] ?? p"
            :severity="toTagSeverity(PRIORITY_SEVERITY[p as Priority])"
            class="filter-builder__chip"
          >
            <template #default>
              {{ PRIORITY_LABELS[p as Priority] ?? p }}
              <button class="filter-builder__chip-remove" @click="removePriority(p)">×</button>
            </template>
          </NeoTag>
        </div>
      </div>

      <!-- Assigned to me toggle -->
      <div class="filter-builder__field filter-builder__field--inline">
        <label class="filter-builder__label">Assigné à moi</label>
        <button
          :class="['filter-builder__toggle', { 'filter-builder__toggle--on': localAssignedToMe }]"
          role="switch"
          :aria-checked="localAssignedToMe"
          @click="toggleAssignedToMe"
        >
          <span class="filter-builder__toggle-knob" />
        </button>
      </div>

      <!-- Date range -->
      <div class="filter-builder__field">
        <label class="filter-builder__label">Période (date de début)</label>
        <div class="filter-builder__date-row">
          <NeoDatePicker
            v-model="localDateFrom"
            placeholder="Du…"
            @update:modelValue="emitChange"
          />
          <span class="filter-builder__date-sep">→</span>
          <NeoDatePicker
            v-model="localDateTo"
            placeholder="Au…"
            @update:modelValue="emitChange"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NeoButton, NeoInputText, NeoSelect, NeoTag, NeoDatePicker } from '@neolibrary/components'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_SEVERITY,
} from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'
import {
  PRIORITY_LABELS,
  PRIORITY_SEVERITY,
} from '@/types/filter.types'
import type { FilterCriteria, Priority } from '@/types/filter.types'

type NeoTagSeverity = 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | 'primary'
const VALID_SEVERITIES = new Set<string>(['success', 'info', 'warn', 'danger', 'secondary', 'contrast', 'primary'])
function toTagSeverity(val: string | undefined): NeoTagSeverity {
  return (val !== undefined && VALID_SEVERITIES.has(val) ? val : 'secondary') as NeoTagSeverity
}


// ─── Props & Emits ────────────────────────────────────────────────────────────
interface Props {
  modelValue?: FilterCriteria
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => ({}),
})

const emit = defineEmits<{
  change: [criteria: FilterCriteria]
}>()

// ─── Local state (initialised from modelValue) ────────────────────────────────
const localSearch = ref<string>(props.modelValue.search ?? '')
const localStatus = ref<string[]>(props.modelValue.status ? [...props.modelValue.status] : [])
const localPriority = ref<string[]>(props.modelValue.priority ? [...props.modelValue.priority] : [])
const localAssignedToMe = ref<boolean>(props.modelValue.assignedToMe ?? false)
const localDateFrom = ref<string | null>(props.modelValue.dateRange?.from ?? null)
const localDateTo = ref<string | null>(props.modelValue.dateRange?.to ?? null)

// ─── Options ──────────────────────────────────────────────────────────────────
const statusOptions = Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({ value, label }))
const priorityOptions = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))

// ─── Active filter count ──────────────────────────────────────────────────────
const activeCount = computed<number>(() => {
  let count = 0
  if (localSearch.value) count++
  if (localStatus.value.length) count++
  if (localPriority.value.length) count++
  if (localAssignedToMe.value) count++
  if (localDateFrom.value || localDateTo.value) count++
  return count
})

// ─── Emit helpers ─────────────────────────────────────────────────────────────
const buildCriteria = (): FilterCriteria => ({
  ...(localSearch.value ? { search: localSearch.value } : {}),
  ...(localStatus.value.length ? { status: [...localStatus.value] } : {}),
  ...(localPriority.value.length ? { priority: [...localPriority.value] } : {}),
  ...(localAssignedToMe.value ? { assignedToMe: true } : {}),
  ...((localDateFrom.value || localDateTo.value) ? {
    dateRange: {
      ...(localDateFrom.value ? { from: localDateFrom.value } : {}),
      ...(localDateTo.value ? { to: localDateTo.value } : {}),
    },
  } : {}),
})

const emitChange = (): void => {
  emit('change', buildCriteria())
}

// ─── Actions ──────────────────────────────────────────────────────────────────
const removeStatus = (status: string): void => {
  localStatus.value = localStatus.value.filter((s) => s !== status)
  emitChange()
}

const removePriority = (priority: string): void => {
  localPriority.value = localPriority.value.filter((p) => p !== priority)
  emitChange()
}

const toggleAssignedToMe = (): void => {
  localAssignedToMe.value = !localAssignedToMe.value
  emitChange()
}

const resetAll = (): void => {
  localSearch.value = ''
  localStatus.value = []
  localPriority.value = []
  localAssignedToMe.value = false
  localDateFrom.value = null
  localDateTo.value = null
  emitChange()
}

// ─── Expose reset for parent use ──────────────────────────────────────────────
defineExpose({ resetAll, buildCriteria })
</script>

<style scoped>
.filter-builder {
  background: var(--surface-0, #fff);
  border: 1px solid var(--surface-200, #e2e8f0);
  border-radius: 0.75rem;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.filter-builder__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.filter-builder__title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-color, #1e293b);
  margin: 0;
  flex: 1;
}

.filter-builder__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  background: var(--nl-accent);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
}

.filter-builder__fields {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.filter-builder__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.filter-builder__field--inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.filter-builder__label {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--nl-text-3);
}

.filter-builder__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.25rem;
}

.filter-builder__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.filter-builder__chip-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  padding: 0;
  line-height: 1;
  font-size: 0.85rem;
  opacity: 0.7;
}
.filter-builder__chip-remove:hover { opacity: 1; }

.filter-builder__toggle {
  position: relative;
  width: 2.5rem;
  height: 1.4rem;
  border-radius: 999px;
  border: none;
  background: var(--nl-border-strong);
  cursor: pointer;
  transition: background 0.2s;
  padding: 0;
}
.filter-builder__toggle--on { background: var(--nl-accent); }

.filter-builder__toggle-knob {
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
  display: block;
}
.filter-builder__toggle--on .filter-builder__toggle-knob {
  transform: translateX(1.1rem);
}

.filter-builder__date-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.filter-builder__date-sep {
  color: var(--text-color-secondary, #64748b);
  font-size: 0.85rem;
}
</style>
