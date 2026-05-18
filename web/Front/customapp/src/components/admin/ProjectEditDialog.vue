<!--
  @file     ProjectEditDialog.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Admin modal to edit a project's name, client, and dates. Status
            and chef de projet have their own dedicated flows (assign-manager
            dialog + bulk-status action), so this dialog deliberately
            covers only the four free-text/date fields exposed by
            PUT /admin/project/:id.
-->
<template>
  <AppModal
    :visible="visible"
    header="Modifier le projet"
    width="520px"
    @update:visible="onVisibleChange"
  >
    <div v-if="project" class="pe-body">
      <NeoInputText
        v-model="form.name"
        label="Nom du projet"
        placeholder="Ex : Déploiement GED Client X"
        :error="errors.name"
        required
        class="pe-field--full"
      />
      <NeoInputText
        v-model="form.clientName"
        label="Nom du client"
        placeholder="Ex : Société ACME"
        :error="errors.clientName"
        required
        class="pe-field--full"
      />
      <div class="pe-row">
        <NeoDatePicker
          v-model="form.startDate"
          label="Date de début"
          dateFormat="dd/mm/yy"
          :error="errors.startDate"
          required
          class="pe-field"
        />
        <NeoDatePicker
          v-model="form.endDate"
          label="Date de fin"
          dateFormat="dd/mm/yy"
          :error="errors.endDate"
          required
          class="pe-field"
        />
      </div>
      <p class="pe-hint">
        <i class="pi pi-info-circle" />
        Le statut et le chef de projet se modifient depuis le menu d'actions
        de la ligne (« Changer le chef de projet ») ou la barre groupée.
      </p>
    </div>

    <template #footer>
      <NeoButton
        label="Annuler"
        severity="secondary"
        outlined
        :disabled="submitting"
        @click="onVisibleChange(false)"
      />
      <NeoButton
        label="Enregistrer"
        icon="pi pi-check"
        :loading="submitting"
        :disabled="submitting || !isDirty || !isValid"
        @click="submit"
      />
    </template>
  </AppModal>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch } from 'vue'
import { NeoButton, NeoInputText, NeoDatePicker, useNeoToast } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import { useProjectStore } from '@/stores/projectStore'
import type { ProjectSummary, UpdateProjectPayload } from '@/types/project.types'

interface Props {
  visible: boolean
  project: ProjectSummary | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'updated'): void
}>()

const store = useProjectStore()
const toast = useNeoToast()

const submitting = ref(false)

// Form mirrors what UpdateProjectDto accepts. Status + projectManagerId have
// dedicated flows on purpose and are not exposed here.
const form = reactive({
  name: '',
  clientName: '',
  startDate: '',
  endDate: '',
})

const errors = reactive<Record<keyof typeof form, string>>({
  name: '',
  clientName: '',
  startDate: '',
  endDate: '',
})

// Repopulate the form whenever a different project is opened. We don't
// want stale data from the previous edit to leak into the new dialog.
watch(
  () => [props.visible, props.project?.id] as const,
  ([open, _id]) => {
    if (!open || !props.project) return
    form.name = props.project.name ?? ''
    form.clientName = props.project.clientName ?? ''
    form.startDate = props.project.startDate
      ? String(props.project.startDate).slice(0, 10)
      : ''
    form.endDate = props.project.endDate
      ? String(props.project.endDate).slice(0, 10)
      : ''
    errors.name = ''
    errors.clientName = ''
    errors.startDate = ''
    errors.endDate = ''
  },
  { immediate: true },
)

const isValid = computed(() => {
  if (!form.name.trim()) return false
  if (!form.clientName.trim()) return false
  if (!form.startDate || !form.endDate) return false
  // The DB also enforces start < end, but pre-flighting it here gives the
  // admin a clearer error than waiting on a 400 round-trip.
  return form.endDate > form.startDate
})

const isDirty = computed(() => {
  if (!props.project) return false
  const origStart = props.project.startDate ? String(props.project.startDate).slice(0, 10) : ''
  const origEnd = props.project.endDate ? String(props.project.endDate).slice(0, 10) : ''
  return (
    form.name !== (props.project.name ?? '') ||
    form.clientName !== (props.project.clientName ?? '') ||
    form.startDate !== origStart ||
    form.endDate !== origEnd
  )
})

function validate(): boolean {
  errors.name = form.name.trim() ? '' : 'Le nom du projet est requis.'
  errors.clientName = form.clientName.trim() ? '' : 'Le nom du client est requis.'
  errors.startDate = form.startDate ? '' : 'La date de début est requise.'
  errors.endDate = form.endDate ? '' : 'La date de fin est requise.'
  if (form.startDate && form.endDate && form.endDate <= form.startDate) {
    errors.endDate = 'La date de fin doit être postérieure à la date de début.'
  }
  return !errors.name && !errors.clientName && !errors.startDate && !errors.endDate
}

function onVisibleChange(v: boolean): void {
  if (submitting.value) return
  emit('update:visible', v)
}

async function submit(): Promise<void> {
  if (!props.project) return
  if (!validate()) return

  const payload: UpdateProjectPayload = {
    name: form.name.trim(),
    clientName: form.clientName.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
  }

  submitting.value = true
  try {
    const updated = await store.updateProject(props.project.id, payload)
    if (updated) {
      toast.add({ severity: 'success', detail: 'Projet mis à jour.', life: 3000 })
      emit('updated')
      emit('update:visible', false)
    } else {
      toast.add({
        severity: 'error',
        detail: store.error ?? 'Erreur lors de la mise à jour du projet.',
        life: 5000,
      })
    }
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.pe-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.25rem 0;
}

.pe-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.pe-field { width: 100%; }
.pe-field--full { width: 100%; }

.pe-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.78rem;
  color: var(--nl-text-3);
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 0.55rem 0.75rem;
}

@media (max-width: 480px) {
  .pe-row { grid-template-columns: 1fr; }
}
</style>
