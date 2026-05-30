<!-- @file src/components/workpackages/WpSubmitModal.vue
     Shared "submit a task for validation" modal. Sets the task to AwaitingReview
     (which notifies the project's PM) with an OPTIONAL comment and OPTIONAL file
     (neither required). Store-agnostic — talks to the API directly so it can be
     used from both the Member task list (MemberTasksView) and the PM detail panel
     (WorkPackageDetail). Emits `submitted` so the parent can refresh its store. -->
<template>
  <AppModal v-model:visible="visibleModel" header="Soumettre pour validation" width="520px">
    <div class="wsm-form">
      <p class="wsm-hint">
        La tâche passera en « En attente de validation » et le chef de projet sera notifié.
        Le commentaire et le fichier sont facultatifs.
      </p>
      <div class="wsm-field">
        <label class="wsm-label">Commentaire (facultatif)</label>
        <textarea
          v-model="comment"
          class="wsm-textarea"
          rows="3"
          placeholder="Précisez ce qui a été fait, points d'attention…"
          :disabled="busy"
        />
      </div>
      <div class="wsm-field">
        <label class="wsm-label">Pièce jointe (facultatif)</label>
        <input
          ref="fileInputRef"
          type="file"
          class="wsm-file"
          :disabled="busy"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
          @change="onFilePick"
        />
        <span class="wsm-filehint">Max 25 Mo — PDF, image, Office, ZIP</span>
      </div>
    </div>
    <template #footer>
      <NeoButton label="Annuler" severity="secondary" outlined :disabled="busy" @click="visibleModel = false" />
      <NeoButton label="Soumettre" icon="pi pi-send" :loading="busy" @click="submit" />
    </template>
  </AppModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NeoButton, useNeoToast } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import api, { extractErrorMessage } from '@/lib/api'

const props = defineProps<{ visible: boolean; projectId: string; workPackageId: string }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void; (e: 'submitted'): void }>()

const toast = useNeoToast()
const comment = ref('')
const file = ref<File | null>(null)
const busy = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

const MAX_FILE_BYTES = 25 * 1024 * 1024

const visibleModel = computed<boolean>({
  get: () => props.visible,
  set: (v) => emit('update:visible', v),
})

function onFilePick(e: Event): void {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

async function submit(): Promise<void> {
  if (file.value && file.value.size > MAX_FILE_BYTES) {
    toast.add({ severity: 'error', detail: 'Fichier trop volumineux (max 25 Mo).', life: 4000 })
    return
  }
  busy.value = true
  try {
    // Core transition first — this is what notifies the PM. The comment + file
    // are optional context attached after, so a failure there doesn't block submit.
    try {
      await api.patch(`/pm/projects/${props.projectId}/work-packages/${props.workPackageId}`, {
        status: 'AwaitingReview',
      })
    } catch (err: unknown) {
      toast.add({ severity: 'error', detail: extractErrorMessage(err) ?? 'Échec de la soumission.', life: 5000 })
      return
    }

    const warnings: string[] = []
    const note = comment.value.trim()
    if (note) {
      try {
        await api.post(`/pm/projects/${props.projectId}/work-packages/${props.workPackageId}/comments`, { content: note })
      } catch {
        warnings.push('le commentaire')
      }
    }
    if (file.value) {
      try {
        const fd = new FormData()
        fd.append('file', file.value)
        await api.post(`/pm/work-packages/${props.workPackageId}/attachments`, fd)
      } catch (err: unknown) {
        warnings.push(extractErrorMessage(err) ?? 'le fichier')
      }
    }

    if (warnings.length) {
      toast.add({ severity: 'warn', detail: `Tâche soumise, mais ${warnings.join(' et ')} n'a pas pu être ajouté.`, life: 5000 })
    } else {
      toast.add({ severity: 'success', detail: 'Tâche soumise pour validation.', life: 3000 })
    }
    comment.value = ''
    file.value = null
    if (fileInputRef.value) fileInputRef.value.value = ''
    emit('submitted')
    emit('update:visible', false)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.wsm-form { display: flex; flex-direction: column; gap: 1rem; padding: 0.5rem 0; }
.wsm-hint { margin: 0; font-size: 0.8125rem; color: var(--nl-text-3, #6b7280); }
.wsm-field { display: flex; flex-direction: column; gap: 0.375rem; }
.wsm-label { font-size: 0.8125rem; font-weight: 500; color: var(--nl-text-2, #374151); }
.wsm-textarea {
  width: 100%;
  border: 1px solid var(--nl-border, #d1d5db);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-family: inherit;
  font-size: 0.875rem;
  resize: vertical;
}
.wsm-file { font-size: 0.875rem; }
.wsm-filehint { font-size: 0.75rem; color: var(--nl-text-3, #9ca3af); }
</style>
