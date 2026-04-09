<template>
  <div class="questionnaire">
    <div class="q-header">
      <h3 class="q-title">Questionnaire projet</h3>
      <div v-if="!readonly" class="q-actions">
        <NeoButton
          v-if="canAddFields"
          label="Ajouter un champ"
          icon="pi pi-plus"
          outlined
          size="small"
          @click="showAddField = true"
        />
        <NeoButton
          label="Enregistrer"
          icon="pi pi-check"
          :loading="store.saving"
          :disabled="!dirty"
          @click="handleSave"
        />
      </div>
    </div>

    <NeoMessage v-if="saved" severity="success" text="Questionnaire enregistré." class="mb-3" />

    <div class="field-list">
      <div v-for="field in project.fields" :key="field.id" class="field-item">
        <label class="field-label">
          {{ field.label }}
          <span v-if="field.isRequired" class="required">*</span>
        </label>

        <!-- Text -->
        <NeoInputText
          v-if="field.fieldType === 'Text'"
          v-model="values[field.id]"
          :placeholder="field.label"
          :disabled="readonly"
          maxlength="500"
          class="w-full"
          @input="dirty = true"
          @blur="validateField(field.id, field.isRequired)"
        />

        <!-- Number -->
        <NeoInputNumber
          v-else-if="field.fieldType === 'Number'"
          v-model="values[field.id]"
          :placeholder="field.label"
          :disabled="readonly"
          class="w-full"
          type="number"
          @input="dirty = true"
          @blur="validateField(field.id, field.isRequired)"
        />

        <!-- Date -->
        <NeoDatePicker
          v-else-if="field.fieldType === 'Date'"
          v-model="values[field.id]"
          dateFormat="dd/mm/yy"
          :disabled="readonly"
          class="w-full"
          @update:modelValue="() => { dirty = true; validateField(field.id, field.isRequired) }"
        />

        <!-- Select -->
        <NeoSelect
          v-else-if="field.fieldType === 'Select'"
          v-model="values[field.id]"
          :options="parseOptions(field.options)"
          :disabled="readonly"
          class="w-full"
          @update:modelValue="() => { dirty = true; validateField(field.id, field.isRequired) }"
        />

        <!-- Checkbox -->
        <NeoCheckbox
          v-else-if="field.fieldType === 'Checkbox'"
          v-model="values[field.id]"
          :label="field.label"
          :disabled="readonly"
          :binary="true"
          @update:modelValue="() => { dirty = true; validateField(field.id, field.isRequired) }"
        />

        <small v-if="validationErrors[field.id]" class="field-error">
          {{ validationErrors[field.id] }}
        </small>
      </div>
    </div>

    <!-- Add custom field inline form -->
    <div v-if="showAddField" class="add-field-box">
      <h4 class="add-field-title">Nouveau champ personnalisé</h4>
      <div class="add-field-row">
        <NeoInputText v-model="newField.label" label="Libellé" placeholder="Nom du champ" class="flex-1" />
        <NeoSelect
          v-model="newField.fieldType"
          label="Type"
          :options="fieldTypeOptions"
          optionLabel="label"
          optionValue="value"
          style="min-width: 130px"
        />
        <NeoCheckbox v-model="newField.isRequired" :binary="true" />
        <NeoButton label="Ajouter" icon="pi pi-check" :loading="store.saving" :disabled="!newField.label.trim()" @click="handleAddField" />
        <NeoButton label="Annuler" severity="secondary" outlined @click="showAddField = false" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { NeoInputText, NeoInputNumber, NeoSelect, NeoDatePicker, NeoCheckbox, NeoButton, NeoMessage, useNeoToast } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import type { ProjectDetail, FieldType } from '@/types/project.types'

const props = defineProps<{ project: ProjectDetail; readonly?: boolean }>()
const store = usePmStore()
const toast = useNeoToast()

const values: Record<string, string | number | boolean | null> = reactive({})
const validationErrors: Record<string, string> = reactive({})
const dirty       = ref(false)
const saved       = ref(false)
const showAddField = ref(false)
const newField     = reactive({ label: '', fieldType: 'Text' as FieldType, isRequired: false })

const canAddFields = props.project.allowManagerCustomFields

const fieldTypeOptions = [
  { value: 'Text', label: 'Texte' },
  { value: 'Number', label: 'Nombre' },
  { value: 'Date', label: 'Date' },
  { value: 'Select', label: 'Liste' },
  { value: 'Checkbox', label: 'Case à cocher' },
]

onMounted(() => {
  props.project.fieldValues.forEach(fv => {
    values[fv.projectFieldId] = fv.value === 'true' ? true : fv.value === 'false' ? false : (fv.value ?? '')
  })
})

const parseOptions = (opt: string | null): string[] => {
  if (!opt) return []
  try { return JSON.parse(opt) } catch { return opt.split(',').map(s => s.trim()) }
}

const validateField = (fieldId: string, isRequired: boolean): void => {
  if (!isRequired) {
    delete validationErrors[fieldId]
    return
  }
  const val = values[fieldId]
  if (val === undefined || val === null || val === '') {
    validationErrors[fieldId] = 'Ce champ est obligatoire.'
  } else {
    delete validationErrors[fieldId]
  }
}

const validateAllRequired = (): boolean => {
  let valid = true
  for (const field of props.project.fields) {
    if (field.isRequired) {
      validateField(field.id, true)
      if (validationErrors[field.id]) {
        valid = false
      }
    }
  }
  return valid
}

const handleSave = async () => {
  if (!validateAllRequired()) {
    toast.add({ severity: 'warn', detail: 'Veuillez remplir tous les champs obligatoires.', life: 4000 })
    return
  }
  const payload = {
    fieldValues: Object.entries(values).map(([projectFieldId, value]) => ({
      projectFieldId,
      value: typeof value === 'boolean' ? String(value) : (value || null),
    })),
  }
  const ok = await store.saveQuestionnaire(props.project.id, payload)
  if (ok) {
    dirty.value = false
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
    toast.add({ severity: 'success', detail: 'Questionnaire enregistré.', life: 3000 })
  } else {
    toast.add({ severity: 'error', detail: store.error ?? 'Erreur.', life: 5000 })
  }
}

const handleAddField = async () => {
  if (!newField.label.trim()) return
  const ok = await store.addCustomField(props.project.id, {
    label: newField.label.trim(),
    fieldType: newField.fieldType,
    isRequired: newField.isRequired,
    options: null,
  })
  if (ok) {
    toast.add({ severity: 'success', detail: `Champ « ${newField.label} » ajouté.`, life: 3000 })
    newField.label = ''
    newField.isRequired = false
    showAddField.value = false
  }
}
</script>

<style scoped>
.questionnaire { display: flex; flex-direction: column; gap: 1.25rem; }

.q-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.q-title { font-size: 1rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.q-actions { display: flex; gap: 0.5rem; }

.field-list { display: flex; flex-direction: column; gap: 1rem; }

.field-item { display: flex; flex-direction: column; gap: 0.3rem; }

.field-label { font-size: 0.85rem; font-weight: 500; color: var(--nl-text-2); }
.required { color: var(--nl-danger); margin-left: 2px; }
.field-error { font-size: 0.75rem; color: var(--nl-danger); margin-top: 0.15rem; }

.add-field-box {
  background: var(--nl-surface-2);
  border: 1px dashed var(--nl-border-strong);
  border-radius: var(--nl-radius);
  padding: 1rem 1.25rem;
  margin-top: 0.5rem;
}
.add-field-title { font-size: 0.875rem; font-weight: 600; color: var(--nl-text-2); margin: 0 0 0.75rem; }
.add-field-row { display: flex; align-items: flex-end; gap: 0.75rem; flex-wrap: wrap; }
.mb-3 { margin-bottom: 0.75rem; }
</style>
