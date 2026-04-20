<!-- @file src/views/BacklogView.vue — Sprint backlog management -->
<template>
  <ProjectModuleShell :project-id="id" title="Backlog">
    <template #actions>
      <NeoButton label="Nouveau sprint" icon="pi pi-plus" @click="showCreateSprint = true" />
    </template>

    <div class="bl">
      <!-- Left: unassigned WPs -->
      <div class="bl__panel">
        <h3 class="bl__panel-title">Backlog (non-assigné)</h3>
        <div
          v-for="wp in unassigned"
          :key="wp.id"
          class="bl-card"
          draggable="true"
          @dragstart="draggedWp = wp.id"
        >
          <div class="bl-card__title">{{ wp.title }}</div>
          <PriorityDot :priority="wp.priority" />
        </div>
        <div v-if="!unassigned.length" class="bl__empty">Aucun élément dans le backlog.</div>
      </div>

      <!-- Right: sprints with drop -->
      <div class="bl__panel">
        <div class="bl__sprint-header">
          <NeoSelect
            v-model="activeSprintId"
            :options="sprintOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Sélectionner un sprint"
          />
          <NeoButton v-if="activeSprint?.status === 'Planning'" label="Démarrer" icon="pi pi-play" @click="startSprint" />
          <NeoButton v-if="activeSprint?.status === 'Active'" label="Clôturer" icon="pi pi-check" outlined @click="closeSprint" />
        </div>
        <div
          class="bl__dropzone"
          @dragover.prevent
          @drop="onDrop"
        >
          <div
            v-for="wp in assigned"
            :key="wp.id"
            class="bl-card"
          >
            <div class="bl-card__title">{{ wp.title }}</div>
            <NeoTag :value="wp.status" severity="info" />
          </div>
          <div v-if="!assigned.length" class="bl__empty">Glisser des work packages ici.</div>
        </div>
      </div>
    </div>

  </ProjectModuleShell>

  <AppModal v-model:visible="showCreateSprint" header="Nouveau sprint" width="480px">
      <div class="bl__form">
        <NeoInputText v-model="newSprint.name" label="Nom" placeholder="Sprint 1" />
        <NeoDatePicker v-model="newSprint.startDate" dateFormat="yy-mm-dd" placeholder="Date début" />
        <NeoDatePicker v-model="newSprint.endDate" dateFormat="yy-mm-dd" placeholder="Date fin" />
        <NeoInputText v-model="newSprint.goal" label="Objectif" />
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showCreateSprint = false" />
        <NeoButton label="Créer" icon="pi pi-check" @click="submitCreateSprint" />
      </template>
    </AppModal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { NeoButton, NeoSelect, NeoInputText, NeoDatePicker, NeoTag, useNeoToast } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import PriorityDot from '@/components/common/PriorityDot.vue'
import { useAgileStore } from '@/stores/agileStore'
import { useWorkPackageStore } from '@/stores/workPackageStore'

const props = defineProps<{ id: string }>()
const toast = useNeoToast()
const agileStore = useAgileStore()
const wpStore = useWorkPackageStore()

const activeSprintId = ref<string | null>(null)
const draggedWp = ref<string | null>(null)
const showCreateSprint = ref(false)

const newSprint = reactive<{ name: string; goal: string; startDate: string | null; endDate: string | null }>({
  name: '',
  goal: '',
  startDate: null,
  endDate: null,
})

const activeSprint = computed(() => agileStore.sprints.find((s) => s.id === activeSprintId.value) ?? null)
const unassigned = computed(() => wpStore.items.filter((w) => !w.sprintId))
const assigned = computed(() => wpStore.items.filter((w) => w.sprintId === activeSprintId.value))
const sprintOptions = computed(() => agileStore.sprints.map((s) => ({ label: `${s.name} (${s.status})`, value: s.id })))

async function load() {
  await wpStore.fetchAll(props.id)
  await agileStore.fetchBoards(props.id)
  if (agileStore.boards.length) {
    await agileStore.fetchSprints(props.id, agileStore.boards[0].id)
    if (agileStore.sprints.length && !activeSprintId.value) {
      activeSprintId.value = agileStore.sprints[0].id
    }
  }
}

async function submitCreateSprint() {
  if (!agileStore.boards.length) {
    toast.add({ severity: 'warn', detail: 'Créez un board d\'abord.', life: 3000 })
    return
  }
  if (!newSprint.name.trim() || !newSprint.startDate || !newSprint.endDate) {
    toast.add({ severity: 'warn', detail: 'Tous les champs requis.', life: 3000 })
    return
  }
  await agileStore.createSprint(props.id, agileStore.boards[0].id, {
    name: newSprint.name.trim(),
    startDate: newSprint.startDate,
    endDate: newSprint.endDate,
    goal: newSprint.goal || undefined,
  })
  showCreateSprint.value = false
  newSprint.name = ''
  newSprint.goal = ''
  newSprint.startDate = null
  newSprint.endDate = null
  toast.add({ severity: 'success', detail: 'Sprint créé.', life: 3000 })
}

async function onDrop() {
  if (!draggedWp.value || !activeSprintId.value) return
  const wpId = draggedWp.value
  draggedWp.value = null
  const ok = await wpStore.moveCard(props.id, wpId, { sprintId: activeSprintId.value })
  if (ok) {
    await wpStore.fetchAll(props.id)
    toast.add({ severity: 'success', detail: 'Ajouté au sprint.', life: 2000 })
  } else {
    toast.add({ severity: 'error', detail: 'Échec.', life: 3000 })
  }
}

async function startSprint() {
  if (!activeSprintId.value) return
  await agileStore.startSprint(props.id, activeSprintId.value)
  toast.add({ severity: 'success', detail: 'Sprint démarré.', life: 3000 })
}

async function closeSprint() {
  if (!activeSprintId.value) return
  await agileStore.closeSprint(props.id, activeSprintId.value)
  toast.add({ severity: 'success', detail: 'Sprint clôturé.', life: 3000 })
}

onMounted(load)
</script>

<style scoped>
.bl-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.bl { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; padding: 1rem; overflow: hidden; }
.bl__panel { background: var(--nl-card-bg, #fff); border: 1px solid var(--nl-border, #e5e7eb); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; }
.bl__panel-title { padding: 0.75rem 1rem; margin: 0; border-bottom: 1px solid var(--nl-border, #e5e7eb); font-size: 0.875rem; font-weight: 600; }
.bl__sprint-header { display: flex; gap: 0.5rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--nl-border, #e5e7eb); align-items: center; }
.bl__dropzone { flex: 1; padding: 0.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; min-height: 200px; }
.bl__empty { padding: 2rem; text-align: center; color: var(--nl-text-muted, #9ca3af); font-style: italic; }
.bl-card {
  padding: 0.75rem;
  background: var(--nl-bg, #f9fafb);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 6px;
  cursor: grab;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.bl-card:active { cursor: grabbing; }
.bl-card__title { font-size: 0.875rem; font-weight: 500; flex: 1; }
.bl__form { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.5rem 0; }
</style>
