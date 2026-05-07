<!-- @file SprintsPanel.vue — Inline sprint manager mounted on Backlog IA. -->
<template>
  <section class="sp">
    <header class="sp__head">
      <div>
        <h3 class="sp__title">Sprints du projet</h3>
        <p class="sp__hint">
          Créez les sprints qui accueilleront les tâches générées. Vous pourrez
          ensuite les remplir depuis « Backlog Sprint » et les assigner depuis
          « Assignation ».
        </p>
      </div>
      <NeoButton
        label="Nouveau sprint"
        icon="pi pi-plus"
        outlined
        size="small"
        :disabled="!boardId"
        @click="openCreate"
      />
    </header>

    <div v-if="loading" class="sp__loading">
      <i class="pi pi-spin pi-spinner" /> Chargement…
    </div>
    <div v-else-if="agile.sprints.length === 0" class="sp__empty">
      Aucun sprint. Créez-en un pour planifier le backlog.
    </div>
    <ul v-else class="sp__list">
      <li v-for="s in agile.sprints" :key="s.id" class="sp__item">
        <div class="sp__item-main">
          <span class="sp__name">{{ s.name }}</span>
          <NeoTag :value="STATUS_LABEL[s.status]" :severity="STATUS_SEVERITY[s.status]" />
          <span class="sp__count">{{ s._count?.workPackages ?? 0 }} tâche(s)</span>
        </div>
        <div class="sp__item-meta">
          <span>{{ formatDate(s.startDate) }} → {{ formatDate(s.endDate) }}</span>
          <NeoButton
            v-if="canDelete(s)"
            icon="pi pi-trash"
            severity="danger"
            text
            size="small"
            aria-label="Supprimer le sprint"
            @click="confirmDelete(s)"
          />
        </div>
      </li>
    </ul>

    <!-- Create-sprint modal -->
    <AppModal
      v-model:visible="showCreate"
      header="Nouveau sprint"
      width="520px"
    >
      <div class="sp__form">
        <label class="sp__field">
          <span>Nom <span class="req">*</span></span>
          <NeoInputText v-model="form.name" placeholder="Sprint 1" />
        </label>
        <div class="sp__row">
          <label class="sp__field sp__field--half">
            <span>Début <span class="req">*</span></span>
            <NeoDatePicker v-model="form.startDate" dateFormat="yy-mm-dd" />
          </label>
          <label class="sp__field sp__field--half">
            <span>Fin <span class="req">*</span></span>
            <NeoDatePicker v-model="form.endDate" dateFormat="yy-mm-dd" />
          </label>
        </div>
        <label class="sp__field">
          <span>Objectif (optionnel)</span>
          <NeoInputText v-model="form.goal" placeholder="Ce que le sprint doit livrer" />
        </label>
      </div>
      <template #footer>
        <NeoButton
          label="Annuler"
          severity="secondary"
          outlined
          :disabled="creating"
          @click="showCreate = false"
        />
        <NeoButton
          label="Créer"
          icon="pi pi-check"
          :loading="creating"
          :disabled="!canSubmit"
          @click="handleCreate"
        />
      </template>
    </AppModal>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import {
  NeoButton, NeoTag, NeoInputText, NeoDatePicker, useNeoToast, useNeoConfirm,
} from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import { useAgileStore } from '@/stores/agileStore'
import type { Sprint } from '@/stores/agileStore'
import { extractErrorMessage } from '@/lib/api'

const props = defineProps<{ projectId: string }>()

const agile = useAgileStore()
const toast = useNeoToast()
const confirm = useNeoConfirm()

const loading = ref(false)
const showCreate = ref(false)
const creating = ref(false)
const boardId = ref<string | null>(null)

const form = reactive<{
  name: string
  startDate: string | null
  endDate: string | null
  goal: string
}>({ name: '', startDate: null, endDate: null, goal: '' })

const STATUS_LABEL: Record<Sprint['status'], string> = {
  Planning: 'En préparation',
  Active:   'En cours',
  Closed:   'Clôturé',
}
const STATUS_SEVERITY: Record<Sprint['status'], 'info' | 'success' | 'secondary'> = {
  Planning: 'info',
  Active:   'success',
  Closed:   'secondary',
}

const canSubmit = computed<boolean>(() => {
  if (!boardId.value) return false
  if (!form.name.trim()) return false
  if (!form.startDate || !form.endDate) return false
  return form.startDate <= form.endDate
})

function canDelete(s: Sprint): boolean {
  return s.status === 'Planning' && (s._count?.workPackages ?? 0) === 0
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }) }
  catch { return iso }
}

function openCreate(): void {
  form.name = ''
  form.startDate = null
  form.endDate = null
  form.goal = ''
  showCreate.value = true
}

async function loadBoardAndSprints(): Promise<void> {
  loading.value = true
  try {
    await agile.fetchBoards(props.projectId)
    let board = agile.boards.find((b) => b.isDefault) ?? agile.boards[0]
    if (!board) {
      // Cold start — create a default board so sprints can hang off it.
      board = await agile.createBoard(props.projectId, { name: 'Default', type: 'Scrum', isDefault: true })
    }
    boardId.value = board.id
    await agile.fetchSprints(props.projectId, board.id)
  } catch (e: unknown) {
    toast.add({
      severity: 'error',
      detail: extractErrorMessage(e) ?? 'Échec du chargement des sprints.',
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

async function handleCreate(): Promise<void> {
  if (!boardId.value || !canSubmit.value) return
  creating.value = true
  try {
    await agile.createSprint(props.projectId, boardId.value, {
      name: form.name.trim(),
      startDate: form.startDate as string,
      endDate: form.endDate as string,
      goal: form.goal.trim() || undefined,
    })
    showCreate.value = false
    toast.add({ severity: 'success', detail: `Sprint « ${form.name} » créé.`, life: 3000 })
  } catch (e: unknown) {
    toast.add({
      severity: 'error',
      detail: extractErrorMessage(e) ?? 'Échec de la création du sprint.',
      life: 5000,
    })
  } finally {
    creating.value = false
  }
}

function confirmDelete(s: Sprint): void {
  confirm.require({
    message: `Supprimer le sprint « ${s.name} » ? Cette action est irréversible.`,
    header: 'Confirmer la suppression',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    acceptClass: 'p-button-danger',
    accept: () => { void runDelete(s.id) },
  })
}

async function runDelete(sprintId: string): Promise<void> {
  try {
    await agile.deleteSprint(props.projectId, sprintId)
    toast.add({ severity: 'success', detail: 'Sprint supprimé.', life: 3000 })
  } catch (e: unknown) {
    toast.add({
      severity: 'error',
      detail: extractErrorMessage(e) ?? 'Échec de la suppression du sprint.',
      life: 5000,
    })
  }
}

onMounted(() => { void loadBoardAndSprints() })
</script>

<style scoped>
.sp {
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1rem;
}
.sp__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.sp__title {
  margin: 0 0 0.25rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--nl-text-1);
}
.sp__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--nl-text-muted, #6b7280);
  max-width: 60ch;
}
.sp__loading,
.sp__empty {
  padding: 1rem;
  text-align: center;
  color: var(--nl-text-muted, #6b7280);
  font-size: 0.875rem;
}
.sp__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.sp__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  background: var(--nl-surface, #fff);
}
.sp__item-main { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.sp__name {
  font-weight: 600;
  color: var(--nl-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 22ch;
}
.sp__count {
  font-size: 0.75rem;
  color: var(--nl-text-muted, #6b7280);
}
.sp__item-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--nl-text-muted, #6b7280);
}
.sp__form {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}
.sp__field { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.8125rem; color: var(--nl-text-1); }
.sp__row { display: flex; gap: 0.75rem; }
.sp__field--half { flex: 1 1 0; }
.req { color: var(--nl-danger, #dc2626); }
</style>
