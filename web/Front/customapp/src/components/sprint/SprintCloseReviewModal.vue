<!-- @file src/components/sprint/SprintCloseReviewModal.vue
     Two-step sprint close. Lists every WP in the sprint, splits them into
     "Terminé" vs "À arbitrer", and lets the PM pick a per-row disposition
     (move to next sprint / send to backlog / keep in this sprint) before
     confirming the close. Tasks that are postponed get an aggregated
     notification on the backend. -->
<template>
  <AppModal :visible="visible" header="Clôture du sprint" width="780px" @update:visible="onClose">
    <!-- Loading -->
    <div v-if="loading" class="cls-loading">
      <i class="pi pi-spin pi-spinner" />
      <span>Chargement de la revue…</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="cls-error">
      <i class="pi pi-exclamation-triangle" />
      <span>{{ error }}</span>
    </div>

    <!-- Review -->
    <div v-else-if="preview" class="cls-body">
      <!-- Header -->
      <div class="cls-header">
        <div>
          <strong class="cls-title">{{ preview.sprintName }}</strong>
          <p class="cls-counts">
            {{ preview.completed.length }} terminée(s) · {{ preview.unfinished.length }} à arbitrer
          </p>
        </div>
        <div v-if="preview.suggestedTargetSprintName" class="cls-target">
          <i class="pi pi-arrow-right" />
          Sprint cible suggéré : <strong>{{ preview.suggestedTargetSprintName }}</strong>
        </div>
        <div v-else class="cls-target cls-target--warn">
          <i class="pi pi-info-circle" />
          Aucun sprint en planification — les tâches reportées iront au backlog.
        </div>
      </div>

      <!-- Unfinished — actionable -->
      <section v-if="preview.unfinished.length > 0" class="cls-block">
        <div class="cls-block__head">
          <h4 class="cls-block__title">
            <i class="pi pi-clock cls-block__icon--warn" />
            À arbitrer ({{ preview.unfinished.length }})
          </h4>
          <div class="cls-bulk">
            <NeoButton
              label="Tout → prochain sprint"
              icon="pi pi-arrow-right"
              size="small"
              outlined
              :disabled="!hasTargetSprint"
              @click="bulk('next_sprint')"
            />
            <NeoButton
              label="Tout → backlog"
              icon="pi pi-inbox"
              size="small"
              outlined
              severity="secondary"
              @click="bulk('backlog')"
            />
          </div>
        </div>
        <ul class="cls-list">
          <li v-for="wp in preview.unfinished" :key="wp.id" class="cls-row">
            <div class="cls-row__main">
              <NeoTag :value="wp.status" :severity="statusSeverity(wp.status)" />
              <span class="cls-row__title">{{ wp.title }}</span>
              <span v-if="wp.assignee" class="cls-row__assignee">
                {{ wp.assignee.firstName }} {{ wp.assignee.lastName }}
              </span>
              <span v-if="wp.status === 'AwaitingReview'" class="cls-row__hint" title="En revue — vérifiez avant report.">
                <i class="pi pi-info-circle" />
              </span>
            </div>
            <div class="cls-row__dispo">
              <label class="cls-radio">
                <input
                  type="radio"
                  :name="`dispo-${wp.id}`"
                  value="next_sprint"
                  :disabled="!hasTargetSprint"
                  :checked="dispositions.get(wp.id) === 'next_sprint'"
                  @change="setDisposition(wp.id, 'next_sprint')"
                />
                <span>Prochain sprint</span>
              </label>
              <label class="cls-radio">
                <input
                  type="radio"
                  :name="`dispo-${wp.id}`"
                  value="backlog"
                  :checked="dispositions.get(wp.id) === 'backlog'"
                  @change="setDisposition(wp.id, 'backlog')"
                />
                <span>Backlog</span>
              </label>
              <label class="cls-radio">
                <input
                  type="radio"
                  :name="`dispo-${wp.id}`"
                  value="keep"
                  :checked="dispositions.get(wp.id) === 'keep'"
                  @change="setDisposition(wp.id, 'keep')"
                />
                <span>Garder ici</span>
              </label>
            </div>
          </li>
        </ul>
      </section>

      <!-- Completed — collapsible read-only summary -->
      <section v-if="preview.completed.length > 0" class="cls-block cls-block--collapsible">
        <button class="cls-block__toggle" type="button" @click="showCompleted = !showCompleted">
          <i :class="['pi', showCompleted ? 'pi-chevron-down' : 'pi-chevron-right']" />
          <span>Terminées ({{ preview.completed.length }})</span>
        </button>
        <ul v-if="showCompleted" class="cls-list cls-list--compact">
          <li v-for="wp in preview.completed" :key="`d-${wp.id}`" class="cls-row cls-row--done">
            <NeoTag :value="wp.status" severity="success" />
            <span class="cls-row__title">{{ wp.title }}</span>
          </li>
        </ul>
      </section>

      <div v-if="preview.completed.length === 0 && preview.unfinished.length === 0" class="cls-empty">
        <i class="pi pi-info-circle" />
        <span>Ce sprint ne contient aucune tâche.</span>
      </div>
    </div>

    <template #footer>
      <NeoButton label="Annuler" outlined severity="secondary" :disabled="submitting" @click="onClose(false)" />
      <NeoButton
        label="Confirmer la clôture"
        icon="pi pi-check"
        :loading="submitting"
        :disabled="!canSubmit || submitting"
        @click="submit"
      />
    </template>
  </AppModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NeoButton, NeoTag, useNeoToast } from '@neolibrary/components'
import api, { extractErrorMessage } from '@/lib/api'
import AppModal from '@/components/common/AppModal.vue'

type Disposition = 'next_sprint' | 'backlog' | 'keep'

interface SprintWp {
  id: string
  title: string
  status: string
  priority: string
  type: string
  assigneeId: string | null
  assignee: { id: string; firstName: string; lastName: string; avatarPath: string | null } | null
}

interface ClosePreview {
  sprintId: string
  sprintName: string
  completed: SprintWp[]
  unfinished: SprintWp[]
  suggestedTargetSprintId: string | null
  suggestedTargetSprintName: string | null
}

const props = defineProps<{ visible: boolean; projectId: string; sprintId: string }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'confirmed'): void
}>()

const toast = useNeoToast()

const loading = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
const preview = ref<ClosePreview | null>(null)
const dispositions = ref<Map<string, Disposition>>(new Map())
const showCompleted = ref(false)

const hasTargetSprint = computed(() => preview.value?.suggestedTargetSprintId !== null)

const canSubmit = computed(() => {
  if (!preview.value) return false
  // Every unfinished row must have a disposition picked. The auto-default
  // on load means this is true immediately for the common case.
  return preview.value.unfinished.every((w) => dispositions.value.has(w.id))
})

watch(
  () => props.visible,
  async (v) => {
    if (!v) {
      // Reset on close.
      preview.value = null
      error.value = null
      dispositions.value = new Map()
      showCompleted.value = false
      return
    }
    await load()
  },
)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const { data } = await api.get<ClosePreview>(
      `/pm/projects/${props.projectId}/sprints/${props.sprintId}/close-preview`,
    )
    preview.value = data
    // Default disposition per row — next_sprint when a target exists, else backlog.
    // OnHold defaults to backlog (won't be picked up next sprint automatically).
    const defaultDispo: Disposition = data.suggestedTargetSprintId ? 'next_sprint' : 'backlog'
    const map = new Map<string, Disposition>()
    for (const wp of data.unfinished) {
      map.set(wp.id, wp.status === 'OnHold' ? 'backlog' : defaultDispo)
    }
    dispositions.value = map
  } catch (e: unknown) {
    error.value = extractErrorMessage(e) ?? 'Impossible de charger la revue.'
  } finally {
    loading.value = false
  }
}

function setDisposition(wpId: string, d: Disposition): void {
  if (d === 'next_sprint' && !hasTargetSprint.value) return
  const next = new Map(dispositions.value)
  next.set(wpId, d)
  dispositions.value = next
}

function bulk(d: Disposition): void {
  if (!preview.value) return
  if (d === 'next_sprint' && !hasTargetSprint.value) return
  const next = new Map(dispositions.value)
  for (const wp of preview.value.unfinished) next.set(wp.id, d)
  dispositions.value = next
}

function statusSeverity(status: string): 'success' | 'warn' | 'secondary' | 'info' | 'danger' {
  if (status === 'Done' || status === 'Closed' || status === 'Resolved') return 'success'
  if (status === 'AwaitingReview' || status === 'InProgress') return 'warn'
  if (status === 'OnHold') return 'secondary'
  return 'info'
}

async function submit(): Promise<void> {
  if (!preview.value || !canSubmit.value) return
  submitting.value = true
  try {
    const payload = {
      dispositions: preview.value.unfinished.map((wp) => ({
        workPackageId: wp.id,
        disposition: dispositions.value.get(wp.id) as Disposition,
      })),
      targetSprintId: preview.value.suggestedTargetSprintId ?? undefined,
    }
    await api.post(
      `/pm/projects/${props.projectId}/sprints/${props.sprintId}/close`,
      payload,
    )
    toast.add({ severity: 'success', detail: 'Sprint clôturé.', life: 3000 })
    emit('confirmed')
    emit('update:visible', false)
  } catch (e: unknown) {
    toast.add({
      severity: 'error',
      detail: extractErrorMessage(e) ?? 'Échec de la clôture du sprint.',
      life: 5000,
    })
  } finally {
    submitting.value = false
  }
}

function onClose(_v: boolean): void {
  if (submitting.value) return
  emit('update:visible', false)
}
</script>

<style scoped>
.cls-loading,
.cls-error,
.cls-empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px;
  border-radius: 8px;
}
.cls-loading { background: var(--nl-surface-alt, #fafbfc); color: var(--nl-text-muted, #666); }
.cls-error { background: #ffeaea; color: #c0392b; }
.cls-empty { background: var(--nl-surface-alt, #fafbfc); color: var(--nl-text-muted, #666); }

.cls-body { display: flex; flex-direction: column; gap: 18px; }

.cls-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--nl-surface-alt, #fafbfc);
  border: 1px solid var(--nl-border, #e5e7eb);
}
.cls-title { font-size: 1rem; }
.cls-counts { margin: 4px 0 0; font-size: 0.85rem; color: var(--nl-text-muted, #666); }
.cls-target {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--nl-text-2, #333);
}
.cls-target--warn { color: #b8860b; }

.cls-block { display: flex; flex-direction: column; gap: 8px; }
.cls-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.cls-block__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0;
}
.cls-block__icon--warn { color: #b8860b; }

.cls-block__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.88rem;
  color: var(--nl-text-2, #333);
  padding: 4px 0;
  text-align: left;
}
.cls-block__toggle:hover { color: var(--nl-primary, #1b4f72); }

.cls-bulk { display: flex; gap: 8px; }

.cls-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.cls-list--compact { padding-left: 22px; gap: 3px; }

.cls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  background: var(--nl-surface, #fff);
  flex-wrap: wrap;
}
.cls-row--done {
  border: none;
  padding: 2px 0;
  background: transparent;
}

.cls-row__main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.cls-row__title {
  font-weight: 500;
  font-size: 0.88rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cls-row__assignee {
  font-size: 0.78rem;
  color: var(--nl-text-muted, #666);
  white-space: nowrap;
}
.cls-row__hint { color: #b8860b; font-size: 0.85rem; }

.cls-row__dispo { display: flex; gap: 10px; flex-wrap: wrap; }
.cls-radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.82rem;
  color: var(--nl-text-2, #333);
  cursor: pointer;
}
.cls-radio input[type='radio'] { cursor: pointer; }
.cls-radio input[type='radio']:disabled { cursor: not-allowed; }
.cls-radio input[type='radio']:disabled + span { color: var(--nl-text-muted, #999); }
</style>
