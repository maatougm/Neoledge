<template>
  <div class="questionnaire">
    <div class="q-header">
      <h3 class="q-title">Questionnaire projet</h3>
      <div class="q-header-right">
        <PresenceAvatars
          v-if="collab.presenceList.value.length > 0"
          :presence-list="collab.presenceList.value"
          class="q-presence"
        />
        <div v-if="!readonly && canAddFields" class="q-actions">
          <NeoButton
            label="Appliquer un modèle"
            icon="pi pi-copy"
            outlined
            size="small"
            @click="openTemplatePicker"
          />
          <NeoButton
            label="Ajouter un champ"
            icon="pi pi-plus"
            outlined
            size="small"
            @click="showAddField = true"
          />
        </div>
      </div>
    </div>

    <NeoMessage v-if="saved" severity="success" text="Questionnaire enregistré." class="mb-3" />

    <div class="field-group-card">
    <div class="field-list">
      <div
        v-for="field in project.fields"
        :key="field.id"
        class="field-item"
        :class="{ 'field-item--remote-editing': getRemoteEditor(field.id) !== null }"
        :style="getRemoteEditor(field.id) !== null
          ? { borderLeft: `3px solid ${getRemoteEditor(field.id)!.color}` }
          : {}"
      >
        <!-- Collaborative editor avatar chip -->
        <div v-if="getRemoteEditor(field.id) !== null" class="field-editor-chip">
          <span
            class="editor-avatar"
            :style="{ background: getRemoteEditor(field.id)!.color }"
          >{{ getRemoteEditor(field.id)!.name.charAt(0).toUpperCase() }}</span>
          <span class="editor-name">{{ getRemoteEditor(field.id)!.name }}</span>
        </div>
        <label class="field-label">
          {{ field.label }}
          <span v-if="field.isRequired" class="required">*</span>
        </label>

        <!-- Text -->
        <NeoInputText
          v-if="field.fieldType === 'Text'"
          v-model="(values[field.id] as string | undefined)"
          :placeholder="field.label"
          :disabled="readonly"
          maxlength="500"
          class="w-full"
          @input="() => { dirty = true; debouncedSendUpdate(field.id, String(values[field.id] ?? '')) }"
          @blur="() => { debouncedSendUpdate.flush(); validateField(field.id, field.isRequired); collab.sendFieldBlur(props.project.id) }"
          @focus="collab.sendFieldFocus(props.project.id, field.id)"
        />

        <!-- Number -->
        <NeoInputText
          v-else-if="field.fieldType === 'Number'"
          v-model="(values[field.id] as string | undefined)"
          :placeholder="field.label"
          :disabled="readonly"
          class="w-full"
          @input="() => { dirty = true; debouncedSendUpdate(field.id, String(values[field.id] ?? '')) }"
          @blur="() => { debouncedSendUpdate.flush(); validateField(field.id, field.isRequired); collab.sendFieldBlur(props.project.id) }"
          @focus="collab.sendFieldFocus(props.project.id, field.id)"
        />

        <!-- Date -->
        <NeoDatePicker
          v-else-if="field.fieldType === 'Date'"
          v-model="(values[field.id] as string | null)"
          dateFormat="yy-mm-dd"
          :disabled="readonly"
          class="w-full"
          @update:modelValue="(v) => {
            dirty = true
            validateField(field.id, field.isRequired)
            debouncedSendUpdate(field.id, (typeof v === 'string' ? v : null) ?? '')
          }"
          @focus="collab.sendFieldFocus(props.project.id, field.id)"
          @blur="collab.sendFieldBlur(props.project.id)"
        />

        <!-- Select -->
        <NeoSelect
          v-else-if="field.fieldType === 'Select'"
          v-model="values[field.id]"
          :options="parseOptions(field.options)"
          :disabled="readonly"
          class="w-full"
          @update:modelValue="(v: unknown) => {
            dirty = true
            validateField(field.id, field.isRequired)
            collab.sendFieldUpdate(props.project.id, field.id, String(v ?? ''))
          }"
          @focus="collab.sendFieldFocus(props.project.id, field.id)"
          @blur="collab.sendFieldBlur(props.project.id)"
        />

        <!-- Checkbox -->
        <Checkbox
          v-else-if="field.fieldType === 'Checkbox'"
          v-model="(values[field.id] as boolean)"
          :disabled="readonly"
          :binary="true"
          @update:modelValue="(v: boolean) => {
            dirty = true
            validateField(field.id, field.isRequired)
            collab.sendFieldUpdate(props.project.id, field.id, String(v))
          }"
        />

        <small v-if="getRemoteEditor(field.id) !== null" class="field-remote-hint">
          Édité par {{ getRemoteEditor(field.id)!.name }}
        </small>

        <small v-if="validationErrors[field.id]" class="field-error">
          {{ validationErrors[field.id] }}
        </small>
      </div>
    </div>

    </div><!-- end field-group-card -->

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
        <Checkbox v-model="newField.isRequired" :binary="true" />
        <NeoButton label="Ajouter" icon="pi pi-check" :loading="store.saving" :disabled="!newField.label.trim()" @click="handleAddField" />
        <NeoButton label="Annuler" severity="secondary" outlined @click="showAddField = false" />
      </div>
    </div>
    <!-- Sticky save bar -->
    <div v-if="!readonly" class="sticky-save-bar">
      <span v-if="dirty" class="save-hint">Modifications non enregistrées</span>
      <NeoButton
        label="Enregistrer"
        icon="pi pi-check"
        :loading="store.saving"
        :disabled="!dirty"
        @click="handleSave"
      />
    </div>

    <!-- Apply-template picker -->
    <AppModal
      v-model:visible="showTemplatePicker"
      header="Appliquer un modèle de questionnaire"
      width="560px"
    >
      <p class="tpl-modal-help">
        Les champs du modèle seront ajoutés au questionnaire. Les libellés
        déjà présents seront ignorés.
      </p>
      <div v-if="templateStore.loading" class="tpl-modal-loading">
        <i class="pi pi-spin pi-spinner" />
        <span>Chargement…</span>
      </div>
      <div v-else-if="templateStore.templates.length === 0" class="tpl-modal-empty">
        Aucun modèle disponible. Créez-en un depuis « Modèles ».
      </div>
      <ul v-else class="tpl-modal-list">
        <li
          v-for="tpl in templateStore.templates"
          :key="tpl.id"
          class="tpl-modal-item"
          :class="{ 'tpl-modal-item--selected': selectedTemplateId === tpl.id }"
          @click="selectedTemplateId = tpl.id"
        >
          <div class="tpl-name">{{ tpl.name }}</div>
          <div v-if="tpl.description" class="tpl-desc">{{ tpl.description }}</div>
        </li>
      </ul>
      <template #footer>
        <NeoButton
          label="Annuler"
          severity="secondary"
          outlined
          @click="showTemplatePicker = false"
        />
        <NeoButton
          label="Appliquer"
          icon="pi pi-check"
          :disabled="!selectedTemplateId || applyingTemplate"
          :loading="applyingTemplate"
          @click="confirmApplyTemplate"
        />
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch, onMounted, onUnmounted } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { NeoInputText, NeoSelect, NeoDatePicker, NeoButton, NeoMessage, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import Checkbox from 'primevue/checkbox'
import { usePmStore } from '@/stores/pmStore'
import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'
import { useTemplateStore } from '@/stores/templateStore'
import { useCollaborationSocket } from '@/composables/useCollaborationSocket'
import type { PresenceUser } from '@/composables/useCollaborationSocket'
import PresenceAvatars from '@/components/common/PresenceAvatars.vue'
import AppModal from '@/components/common/AppModal.vue'
import type { ProjectDetail, FieldType } from '@/types/project.types'

// ─── Props ────────────────────────────────────────────────────────────────────

const props = defineProps<{ project: ProjectDetail; readonly?: boolean }>()

// ─── Stores & composables ─────────────────────────────────────────────────────

const store         = usePmStore()
const auth          = useAuthStore()
const config        = useConfigStore()
const toast         = useNeoToast()
const confirm       = useNeoConfirm()
const collab        = useCollaborationSocket()
const templateStore = useTemplateStore()

// ─── Local state ──────────────────────────────────────────────────────────────

const values: Record<string, string | number | boolean | null> = reactive({})
const validationErrors: Record<string, string> = reactive({})
const dirty        = ref(false)
const saved        = ref(false)
const showAddField       = ref(false)
const newField           = reactive({ label: '', fieldType: 'Text' as FieldType, isRequired: false })
const showTemplatePicker = ref(false)
const selectedTemplateId = ref<string | null>(null)
const applyingTemplate   = ref(false)

// Custom-field authoring is allowed for the project's PM and any Admin.
// Server enforces the same rule (POST /pm/projects/:id/fields).
const canAddFields = (() => {
  const role = auth.userRole
  if (role === 'Admin') return true
  if (role !== 'ProjectManager') return false
  return props.project.projectManager?.id === auth.userId
})()

const fieldTypeOptions = [
  { value: 'Text',     label: 'Texte' },
  { value: 'Number',   label: 'Nombre' },
  { value: 'Date',     label: 'Date' },
  { value: 'Select',   label: 'Liste' },
  { value: 'Checkbox', label: 'Case à cocher' },
]

// ─── Debounce utility (with flush) ────────────────────────────────────────────

function debounceWithFlush<T extends (...args: never[]) => unknown>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null
  const debounced = (...args: Parameters<T>): void => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { fn(...args); timer = null; lastArgs = null }, delay)
  }
  debounced.flush = (): void => {
    if (timer !== null && lastArgs !== null) {
      clearTimeout(timer)
      fn(...lastArgs)
      timer = null
      lastArgs = null
    }
  }
  return debounced
}

const debouncedSendUpdate = debounceWithFlush((fieldId: string, value: string) => {
  collab.sendFieldUpdate(props.project.id, fieldId, value)
}, 500)

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  // Populate local values from field values
  props.project.fieldValues.forEach(fv => {
    values[fv.projectFieldId] =
      fv.value === 'true' ? true : fv.value === 'false' ? false : (fv.value ?? '')
  })

  // Connect collaboration socket and join the project room
  if (auth.jwt && config.apiUrl) {
    collab.connect(config.apiUrl, auth.jwt)
    // Small delay to ensure connection handshake completes before joining
    setTimeout(() => {
      collab.joinProject(props.project.id)
    }, 300)
  }

  // Block hard browser close / refresh / back when the form is dirty.
  // Modern browsers ignore the custom message and show a generic
  // "Leave site?" prompt — that's fine, the prompt itself is the goal.
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', handleBeforeUnload)
  }
})

onUnmounted(() => {
  debouncedSendUpdate.flush()
  collab.leaveProject(props.project.id)
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', handleBeforeUnload)
  }
})

function handleBeforeUnload(e: BeforeUnloadEvent): void {
  if (!dirty.value) return
  e.preventDefault()
  // Required for Chrome — even though the message is ignored.
  e.returnValue = ''
}

// Vue Router intra-app navigation guard. useNeoConfirm.require() returns
// void; pass `accept`/`reject` callbacks that resolve `next()`. Calling
// next(false) cancels the navigation and the user stays on the form.
//
// Logout path note: when the user logs out, authStore.logout() clears the
// JWT BEFORE router.push('/login') runs. Blocking that navigation here
// would leave the user on /questionnaire with no auth — a deadlock.
// We detect the unauthenticated state and let navigation through.
onBeforeRouteLeave((_to, _from, next) => {
  if (!dirty.value || !auth.isAuthenticated) {
    next()
    return
  }
  confirm.require({
    message: 'Vous avez des modifications non enregistrées. Voulez-vous vraiment quitter le questionnaire ?',
    header: 'Modifications non enregistrées',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Quitter sans enregistrer',
    rejectLabel: 'Rester',
    accept: () => next(),
    reject: () => next(false),
  })
})

// ─── Watch remote field changes ───────────────────────────────────────────────

watch(
  () => collab.remoteFieldChange.value,
  (change) => {
    if (!change) return
    // Only apply changes from other users
    if (change.updatedBy === auth.userId) return
    // Immutable update — reassign key on the reactive object
    const parsed: string | boolean =
      change.value === 'true' ? true : change.value === 'false' ? false : change.value
    values[change.projectFieldId] = parsed
  },
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the first remote presence user editing the given field,
 * excluding the current user. Returns null if nobody is editing.
 */
function getRemoteEditor(fieldId: string): PresenceUser | null {
  const currentUserId = auth.userId
  const editor = collab.presenceList.value.find(
    (u) => u.editingFieldId === fieldId && u.userId !== currentUserId,
  )
  return editor ?? null
}

const parseOptions = (opt: string | null): string[] => {
  if (!opt) return []
  try { return JSON.parse(opt) as string[] } catch { return opt.split(',').map(s => s.trim()) }
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

// ─── Actions ──────────────────────────────────────────────────────────────────

const handleSave = async () => {
  if (!validateAllRequired()) {
    toast.add({ severity: 'warn', detail: 'Veuillez remplir tous les champs obligatoires.', life: 4000 })
    return
  }
  const payload = {
    fieldValues: Object.entries(values).map(([projectFieldId, value]) => ({
      projectFieldId,
      value:
        typeof value === 'boolean'
          ? String(value)
          : value !== null && value !== undefined
            ? String(value)
            : null,
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

// ─── Apply template ───────────────────────────────────────────────────────────

const openTemplatePicker = (): void => {
  selectedTemplateId.value = null
  showTemplatePicker.value = true
  // Refresh on every open — templates may have been edited since last visit.
  void templateStore.fetchTemplates()
}

const confirmApplyTemplate = (): void => {
  if (!selectedTemplateId.value || applyingTemplate.value) return
  const tpl = templateStore.templates.find((t) => t.id === selectedTemplateId.value)
  const tplName = tpl?.name ?? 'ce modèle'
  // useNeoConfirm.require() returns void — pass an `accept` callback per
  // the library contract. NEVER `await` it.
  confirm.require({
    message: `Appliquer « ${tplName} » au questionnaire ? Les champs déjà présents seront ignorés.`,
    header: 'Appliquer le modèle',
    icon: 'pi pi-question-circle',
    acceptLabel: 'Appliquer',
    rejectLabel: 'Annuler',
    accept: () => { void runApplyTemplate() },
  })
}

async function runApplyTemplate(): Promise<void> {
  if (!selectedTemplateId.value) return
  applyingTemplate.value = true
  const before = props.project.fields.length
  try {
    await templateStore.applyToProject(selectedTemplateId.value, props.project.id)
    await store.fetchProject(props.project.id)
    const after = props.project.fields.length
    const added = Math.max(0, after - before)
    toast.add({
      severity: 'success',
      detail: added > 0
        ? `${added} champ${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} depuis le modèle.`
        : 'Aucun champ ajouté — tous étaient déjà présents.',
      life: 4000,
    })
    showTemplatePicker.value = false
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : "Erreur lors de l'application du modèle."
    toast.add({ severity: 'error', detail, life: 5000 })
  } finally {
    applyingTemplate.value = false
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

.q-header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.q-presence { flex-shrink: 0; }
.q-actions { display: flex; gap: 0.5rem; }

/* Field group card */
.field-group-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  padding: 20px;
}

/* Two-column grid */
.field-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

@media (max-width: 640px) {
  .field-list { grid-template-columns: 1fr; }
}

.field-item {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  border-left: 3px solid transparent;
  padding-left: 0.5rem;
  transition: border-color 0.2s ease;
}

.field-item--remote-editing {
  border-radius: 0 4px 4px 0;
  background: rgba(0, 0, 0, 0.02);
}

/* Editor avatar chip */
.field-editor-chip {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.2rem;
}

.editor-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.editor-name {
  font-size: 0.7rem;
  color: var(--nl-text-3);
  font-style: italic;
}

/* Field label: uppercase, muted, small caps style */
.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--nl-text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.required { color: var(--nl-danger); margin-left: 2px; }
.field-error { font-size: 0.75rem; color: var(--nl-danger); margin-top: 0.15rem; }

.field-remote-hint {
  font-size: 0.72rem;
  color: var(--nl-text-3, #94a3b8);
  font-style: italic;
  margin-top: 0.1rem;
}

/* Input focus ring via global :deep selector */
.field-item :deep(input:focus),
.field-item :deep(.p-inputtext:focus),
.field-item :deep(.p-select:focus-within) {
  border-color: var(--nl-accent) !important;
  box-shadow: 0 0 0 3px rgba(15, 98, 254, 0.12) !important;
}

/* Add field box */
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

/* Sticky save bar */
.sticky-save-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  background: var(--nl-glass-bg, rgba(255, 255, 255, 0.85));
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--nl-border);
  padding: 12px 20px;
  margin: 0 -24px -24px;
  border-radius: 0 0 var(--nl-radius-lg) var(--nl-radius-lg);
  z-index: 10;
}

.save-hint {
  font-size: 0.8125rem;
  color: var(--nl-text-3);
  font-style: italic;
}

/* ── Apply-template picker modal ──────────────────────────────────────────── */
.tpl-modal-help {
  margin: 0 0 1rem 0;
  font-size: 0.875rem;
  color: var(--nl-text-2);
}
.tpl-modal-loading,
.tpl-modal-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--nl-text-3);
  font-size: 0.875rem;
}
.tpl-modal-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 50vh;
  overflow-y: auto;
}
.tpl-modal-item {
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.tpl-modal-item:hover {
  border-color: var(--nl-accent);
  background: var(--nl-accent-light);
}
.tpl-modal-item--selected {
  border-color: var(--nl-accent);
  background: var(--nl-accent-light);
}
.tpl-name {
  font-weight: 600;
  color: var(--nl-text-1);
  font-size: 0.9375rem;
}
.tpl-desc {
  margin-top: 0.25rem;
  font-size: 0.8125rem;
  color: var(--nl-text-3);
}
</style>
