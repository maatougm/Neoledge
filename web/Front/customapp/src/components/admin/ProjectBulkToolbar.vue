<!--
  @file     ProjectBulkToolbar.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Bulk-action toolbar shown when one or more projects are selected
-->
<template>
  <div class="bulk-toolbar">
    <span class="bulk-toolbar__count">
      {{ selectedCount }} projet{{ selectedCount !== 1 ? 's' : '' }} sélectionné{{ selectedCount !== 1 ? 's' : '' }}
    </span>

    <div class="bulk-toolbar__actions">
      <NeoButton
        label="Archiver"
        icon="pi pi-inbox"
        severity="warn"
        size="small"
        :loading="loading"
        @click="emit('archive')"
      />

      <div class="bulk-toolbar__inline">
        <NeoSelect
          v-model="localStatus"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Choisir un statut"
          class="bulk-toolbar__select"
        />
        <NeoButton
          label="Confirmer"
          outlined
          size="small"
          :disabled="!localStatus"
          :loading="loading"
          @click="emitStatus"
        />
      </div>

      <div class="bulk-toolbar__inline">
        <NeoSelect
          v-model="localManager"
          :options="pmOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Choisir un chef"
          class="bulk-toolbar__select"
        />
        <NeoButton
          label="Confirmer"
          outlined
          size="small"
          :disabled="!localManager"
          :loading="loading"
          @click="emitManager"
        />
      </div>

      <NeoButton
        label="Désélectionner"
        text
        size="small"
        @click="emit('clear')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NeoButton, NeoSelect } from '@neolibrary/components'

const props = defineProps<{
  selectedCount: number
  loading: boolean
  statusOptions: { label: string; value: string }[]
  pmOptions: { label: string; value: string }[]
}>()

const emit = defineEmits<{
  archive: []
  'set-status': [status: string]
  'assign-manager': [managerId: string]
  clear: []
}>()

const localStatus  = ref('')
const localManager = ref('')

function emitStatus(): void {
  if (!localStatus.value) return
  emit('set-status', localStatus.value)
  localStatus.value = ''
}

function emitManager(): void {
  if (!localManager.value) return
  emit('assign-manager', localManager.value)
  localManager.value = ''
}
</script>

<style scoped>
.bulk-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--nl-accent-light);
  border: 1px solid var(--nl-accent);
  border-radius: var(--nl-radius);
}

.bulk-toolbar__count {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--nl-accent);
  white-space: nowrap;
}

.bulk-toolbar__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  flex: 1;
}

.bulk-toolbar__inline {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.bulk-toolbar__select { min-width: 160px; }
</style>
