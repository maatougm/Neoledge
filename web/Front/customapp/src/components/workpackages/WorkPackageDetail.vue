<!-- @file WorkPackageDetail.vue — Right-panel detail for a work package -->
<template>
  <div v-if="wp" class="wp-detail">
    <div class="wp-detail__header">
      <div class="wp-detail__meta">
        <NeoTag :value="wp.type" severity="secondary" />
        <span class="wp-detail__id">#{{ wp.id.slice(0, 8) }}</span>
      </div>
      <NeoButton icon="pi pi-times" text aria-label="Fermer le détail" @click="emit('close')" />
    </div>

    <div class="wp-detail__title-row">
      <input
        v-model="localTitle"
        class="wp-detail__title-input"
        @blur="saveTitle"
        @keyup.enter="(e) => (e.target as HTMLInputElement).blur()"
      />
    </div>

    <div class="wp-detail__attrs">
      <div class="wp-detail__attr">
        <label>Statut</label>
        <NeoSelect
          :model-value="wp.status"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          @update:modelValue="onStatusChange"
        />
      </div>
      <div class="wp-detail__attr">
        <label>Priorité</label>
        <NeoSelect
          :model-value="wp.priority"
          :options="priorityOptions"
          optionLabel="label"
          optionValue="value"
          @update:modelValue="onPriorityChange"
        />
      </div>
      <div class="wp-detail__attr">
        <label>Échéance</label>
        <NeoDatePicker
          :model-value="wp.dueDate ?? undefined"
          @update:modelValue="onDueDateChange"
        />
      </div>
      <div class="wp-detail__attr">
        <label>Progression (%)</label>
        <input
          type="number"
          min="0"
          max="100"
          :value="wp.percentDone"
          class="wp-detail__input"
          @change="(e) => patch({ percentDone: parseInt((e.target as HTMLInputElement).value, 10) || 0 })"
        />
      </div>
    </div>

    <div class="wp-detail__tabs">
      <button
        v-for="t in tabs"
        :key="t"
        class="wp-detail__tab"
        :class="{ 'wp-detail__tab--active': activeTab === t }"
        @click="activeTab = t"
      >{{ t }}</button>
    </div>

    <div class="wp-detail__tab-content">
      <div v-if="activeTab === 'Détails'">
        <label class="wp-detail__label">Description</label>
        <textarea
          v-model="localDescription"
          class="wp-detail__textarea"
          @blur="saveDescription"
        />
      </div>

      <div v-if="activeTab === 'Relations'">
        <h3>Sous-tâches</h3>
        <ul class="wp-detail__list">
          <li v-for="c in wp.children" :key="c.id">{{ c.title }} — <WpStatusTag :status="c.status" /></li>
          <li v-if="!wp.children?.length" class="wp-detail__muted">Aucune sous-tâche.</li>
        </ul>

        <h3>Bloque / Est bloqué par</h3>
        <ul class="wp-detail__list">
          <li v-for="d in wp.dependenciesOut" :key="d.id">→ {{ d.toWp?.title }} ({{ d.type }})</li>
          <li v-for="d in wp.dependenciesIn" :key="d.id">← {{ d.fromWp?.title }} ({{ d.type }})</li>
          <li v-if="!wp.dependenciesOut?.length && !wp.dependenciesIn?.length" class="wp-detail__muted">Aucune dépendance.</li>
        </ul>
      </div>

      <div v-if="activeTab === 'Observateurs'">
        <h3>Observateurs</h3>
        <ul class="wp-detail__list">
          <li v-for="w in wp.watchers" :key="w.userId">
            {{ w.user.firstName }} {{ w.user.lastName }}
            <NeoButton icon="pi pi-times" text severity="danger" aria-label="Retirer l'observateur" @click="removeWatcher(w.userId)" />
          </li>
          <li v-if="!wp.watchers?.length" class="wp-detail__muted">Aucun observateur.</li>
        </ul>
      </div>

      <div v-if="activeTab === 'Pièces jointes'">
        <WpAttachmentsPanel :work-package-id="props.workPackageId" />
      </div>

      <div v-if="activeTab === 'Commentaires'">
        <WpCommentsPanel :project-id="props.projectId" :work-package-id="props.workPackageId" />
      </div>
    </div>

    <!-- Review workflow action bar -->
    <div v-if="workflowActionsVisible" class="wp-detail__actions">
      <template v-if="canSubmitForReview">
        <span class="wp-detail__action-hint"><i class="pi pi-info-circle" /> Terminé ? Soumettez la tâche pour validation.</span>
        <NeoButton label="Soumettre pour validation" icon="pi pi-send" @click="showSubmit = true" />
      </template>

      <template v-else-if="isAssignee && isAwaitingReview">
        <span class="wp-detail__action-hint"><i class="pi pi-hourglass" /> En attente de validation par le chef de projet.</span>
        <NeoButton label="Retirer" icon="pi pi-undo" severity="secondary" outlined size="small" :loading="acting" @click="withdrawSubmission" />
      </template>

      <template v-else-if="isProjectPm && isAwaitingReview">
        <span class="wp-detail__action-hint wp-detail__action-hint--review"><i class="pi pi-flag" /> Soumise pour votre validation.</span>
        <NeoButton label="Valider" icon="pi pi-check" :loading="acting" @click="acceptTask" />
        <NeoButton label="Rejeter" icon="pi pi-times" severity="danger" outlined :loading="acting" @click="showReject = true" />
      </template>

      <template v-else-if="isResolved">
        <span class="wp-detail__action-hint wp-detail__action-hint--done"><i class="pi pi-check-circle" /> Tâche validée.</span>
      </template>
    </div>

    <div class="wp-detail__footer">
      <NeoButton
        label="Supprimer"
        icon="pi pi-trash"
        severity="danger"
        outlined
        @click="confirmDelete"
      />
    </div>

    <!-- Member: submit for validation (optional note + file, neither required) -->
    <WpSubmitModal
      v-model:visible="showSubmit"
      :project-id="props.projectId"
      :work-package-id="props.workPackageId"
      @submitted="load"
    />

    <!-- PM: reject with an optional reason -->
    <AppModal v-model:visible="showReject" header="Rejeter la tâche" width="520px">
      <div class="wp-submit-form">
        <p class="wp-submit-hint">
          La tâche repassera en « En cours » et le membre assigné sera notifié.
        </p>
        <div class="wp-submit-field">
          <label class="wp-submit-label">Motif du rejet (facultatif)</label>
          <textarea
            v-model="rejectReason"
            class="wp-submit-textarea"
            rows="4"
            placeholder="Ce qui doit être corrigé…"
            :disabled="acting"
          />
        </div>
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined :disabled="acting" @click="showReject = false" />
        <NeoButton label="Rejeter" icon="pi pi-times" severity="danger" :loading="acting" @click="rejectTask" />
      </template>
    </AppModal>
  </div>
  <div v-else class="wp-detail wp-detail--loading">Chargement…</div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import { NeoButton, NeoSelect, NeoDatePicker, NeoTag, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import WpStatusTag from '@/components/common/WpStatusTag.vue'
import WpAttachmentsPanel from './WpAttachmentsPanel.vue'
import WpCommentsPanel from './WpCommentsPanel.vue'
import WpSubmitModal from './WpSubmitModal.vue'
import AppModal from '@/components/common/AppModal.vue'
import { useWorkPackageStore } from '@/stores/workPackageStore'
import { useAuthStore } from '@/stores/authStore'
import api from '@/lib/api'
import type { UpdateWpPayload } from '@/types/work-package.types'

const props = defineProps<{ projectId: string; workPackageId: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'deleted', id: string): void }>()

const store = useWorkPackageStore()
const auth = useAuthStore()
const toast = useNeoToast()
const confirm = useNeoConfirm()

const wp = computed(() => store.currentWp)
type DetailTab = 'Détails' | 'Commentaires' | 'Pièces jointes' | 'Relations' | 'Observateurs'
const activeTab = ref<DetailTab>('Détails')
const tabs: DetailTab[] = ['Détails', 'Commentaires', 'Pièces jointes', 'Relations', 'Observateurs']

// ── Task review workflow ─────────────────────────────────────────────────────
// New → InProgress (auto on assign) → AwaitingReview (member submits) →
// Resolved (PM validates) / back to InProgress (PM rejects or member withdraws).
const isAssignee = computed<boolean>(
  () => !!wp.value && !!auth.userId && wp.value.assigneeId === auth.userId,
)
// PM-only: the actual manager of THIS project (not just anyone with the PM role).
const isProjectPm = computed<boolean>(
  () =>
    !!wp.value &&
    auth.userRole === 'ProjectManager' &&
    !!auth.userId &&
    wp.value.project?.projectManagerId === auth.userId,
)
const isAwaitingReview = computed<boolean>(() => wp.value?.status === 'AwaitingReview')
const isResolved = computed<boolean>(() => wp.value?.status === 'Resolved')
const canSubmitForReview = computed<boolean>(
  () => isAssignee.value && (wp.value?.status === 'New' || wp.value?.status === 'InProgress'),
)
const workflowActionsVisible = computed<boolean>(
  () =>
    canSubmitForReview.value ||
    (isAssignee.value && isAwaitingReview.value) ||
    (isProjectPm.value && isAwaitingReview.value) ||
    isResolved.value,
)

const acting = ref(false)
const showSubmit = ref(false)
const showReject = ref(false)
const rejectReason = ref('')

function commentsUrl(): string {
  return `/pm/projects/${props.projectId}/work-packages/${props.workPackageId}/comments`
}

/** Member: pull back a submission that is still awaiting review. */
async function withdrawSubmission(): Promise<void> {
  acting.value = true
  try {
    const ok = await store.update(props.projectId, props.workPackageId, { status: 'InProgress' })
    if (!ok) toast.add({ severity: 'error', detail: store.error ?? 'Échec.', life: 4000 })
    else {
      toast.add({ severity: 'info', detail: 'Soumission retirée.', life: 2500 })
      await load()
    }
  } finally {
    acting.value = false
  }
}

/** PM: validate the submitted task. */
async function acceptTask(): Promise<void> {
  acting.value = true
  try {
    const ok = await store.update(props.projectId, props.workPackageId, { status: 'Resolved' })
    if (!ok) toast.add({ severity: 'error', detail: store.error ?? 'Échec.', life: 4000 })
    else {
      toast.add({ severity: 'success', detail: 'Tâche validée.', life: 3000 })
      await load()
    }
  } finally {
    acting.value = false
  }
}

/** PM: send the task back to the member, with an optional reason. */
async function rejectTask(): Promise<void> {
  acting.value = true
  try {
    const reason = rejectReason.value.trim()
    if (reason) {
      try {
        await api.post(commentsUrl(), { content: `Rejet : ${reason}` })
      } catch {
        /* non-blocking — the status change is what matters */
      }
    }
    const ok = await store.update(props.projectId, props.workPackageId, { status: 'InProgress' })
    if (!ok) {
      toast.add({ severity: 'error', detail: store.error ?? 'Échec.', life: 4000 })
      return
    }
    toast.add({ severity: 'warn', detail: 'Tâche renvoyée au membre.', life: 3000 })
    showReject.value = false
    rejectReason.value = ''
    await load()
  } finally {
    acting.value = false
  }
}

const localTitle = ref('')
const localDescription = ref('')

const statusOptions = [
  { label: 'Nouveau', value: 'New' },
  { label: 'En cours', value: 'InProgress' },
  { label: 'En attente de validation', value: 'AwaitingReview' },
  { label: 'Résolu', value: 'Resolved' },
]
const priorityOptions = [
  { label: 'Basse', value: 'Low' },
  { label: 'Normale', value: 'Normal' },
  { label: 'Haute', value: 'High' },
  { label: 'Urgente', value: 'Urgent' },
  { label: 'Immédiate', value: 'Immediate' },
]

async function load() {
  await store.fetchOne(props.projectId, props.workPackageId)
  if (wp.value) {
    localTitle.value = wp.value.title
    localDescription.value = wp.value.description ?? ''
  }
}

watch(() => props.workPackageId, load, { immediate: false })
onMounted(load)

async function patch(payload: UpdateWpPayload) {
  const updated = await store.update(props.projectId, props.workPackageId, payload)
  if (updated) toast.add({ severity: 'success', detail: 'Enregistré.', life: 2000 })
}

function onStatusChange(v: unknown) {
  if (typeof v === 'string') void patch({ status: v as UpdateWpPayload['status'] })
}
function onPriorityChange(v: unknown) {
  if (typeof v === 'string') void patch({ priority: v as UpdateWpPayload['priority'] })
}
function onDueDateChange(v: unknown) {
  const s = Array.isArray(v) ? v[0] : v
  void patch({ dueDate: typeof s === 'string' ? s : null })
}

async function saveTitle() {
  if (!wp.value || localTitle.value === wp.value.title) return
  if (!localTitle.value.trim()) {
    localTitle.value = wp.value.title
    return
  }
  await patch({ title: localTitle.value.trim() })
}

async function saveDescription() {
  if (!wp.value || localDescription.value === (wp.value.description ?? '')) return
  await patch({ description: localDescription.value })
}

async function removeWatcher(userId: string) {
  await store.removeWatcher(props.projectId, props.workPackageId, userId)
  await load()
}

function confirmDelete() {
  confirm.require({
    message: 'Supprimer ce work package ?',
    header: 'Confirmation',
    accept: async () => {
      const ok = await store.remove(props.projectId, props.workPackageId)
      if (ok) emit('deleted', props.workPackageId)
    },
  })
}
</script>

<style scoped>
.wp-detail { display: flex; flex-direction: column; height: 100%; padding: 1rem 1.5rem; overflow-y: auto; }
.wp-detail--loading { align-items: center; justify-content: center; color: var(--nl-text-muted, #9ca3af); }
.wp-detail__header { display: flex; align-items: center; justify-content: space-between; }
.wp-detail__meta { display: flex; align-items: center; gap: 0.5rem; }
.wp-detail__id { font-family: monospace; color: var(--nl-text-muted, #6b7280); font-size: 0.75rem; }
.wp-detail__title-row { margin: 0.75rem 0 1rem; }
.wp-detail__title-input {
  width: 100%;
  font-size: 1.25rem;
  font-weight: 600;
  border: none;
  background: transparent;
  padding: 0.25rem 0;
  border-bottom: 1px solid transparent;
  color: var(--nl-text, #111827);
}
.wp-detail__title-input:hover, .wp-detail__title-input:focus {
  border-bottom-color: var(--nl-border, #d1d5db);
  outline: none;
}
.wp-detail__attrs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; margin-bottom: 1rem; }
.wp-detail__attr label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--nl-text-muted, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  display: block;
  margin-bottom: 0.25rem;
}
.wp-detail__input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--nl-border, #d1d5db);
  border-radius: 6px;
}
.wp-detail__tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
  margin-bottom: 1rem;
}
.wp-detail__tab {
  background: transparent;
  border: none;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  color: var(--nl-text-muted, #6b7280);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.wp-detail__tab--active {
  color: var(--nl-accent, #1e9e8f);
  border-bottom-color: var(--nl-accent, #1e9e8f);
  font-weight: 600;
}
.wp-detail__tab-content { flex: 1; }
.wp-detail__label { display: block; font-size: 0.75rem; font-weight: 600; color: var(--nl-text-muted, #6b7280); margin-bottom: 0.25rem; text-transform: uppercase; }
.wp-detail__textarea {
  width: 100%;
  min-height: 150px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--nl-border, #d1d5db);
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.875rem;
  resize: vertical;
}
.wp-detail__list { list-style: none; padding: 0; margin: 0 0 1rem 0; }
.wp-detail__list li { padding: 0.25rem 0; display: flex; align-items: center; gap: 0.5rem; }
.wp-detail__muted { color: var(--nl-text-muted, #9ca3af); font-style: italic; }
.wp-detail__footer { margin-top: auto; padding-top: 1rem; border-top: 1px solid var(--nl-border, #e5e7eb); }

/* Review workflow action bar */
.wp-detail__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  background: var(--nl-surface-2, #f9fafb);
}
.wp-detail__action-hint {
  flex: 1;
  min-width: 160px;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8125rem;
  color: var(--nl-text-2, #374151);
}
.wp-detail__action-hint i { color: var(--nl-text-3, #6b7280); }
.wp-detail__action-hint--review i { color: var(--nl-accent, #1e9e8f); }
.wp-detail__action-hint--done { color: var(--nl-success, #059669); }
.wp-detail__action-hint--done i { color: var(--nl-success, #059669); }

/* Submit / reject modals */
.wp-submit-form { display: flex; flex-direction: column; gap: 1rem; padding: 0.5rem 0; }
.wp-submit-hint { margin: 0; font-size: 0.8125rem; color: var(--nl-text-3, #6b7280); }
.wp-submit-field { display: flex; flex-direction: column; gap: 0.375rem; }
.wp-submit-label { font-size: 0.8125rem; font-weight: 500; color: var(--nl-text-2, #374151); }
.wp-submit-textarea {
  width: 100%;
  border: 1px solid var(--nl-border, #d1d5db);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-family: inherit;
  font-size: 0.875rem;
  resize: vertical;
}
.wp-submit-file { font-size: 0.875rem; }
.wp-submit-filehint { font-size: 0.75rem; color: var(--nl-text-3, #9ca3af); }
</style>
