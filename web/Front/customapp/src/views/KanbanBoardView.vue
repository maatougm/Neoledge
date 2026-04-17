<!-- @file src/views/KanbanBoardView.vue — Drag-drop Kanban board -->
<template>
  <ProjectModuleShell :project-id="id" :title="currentBoard?.name || 'Board'">
    <template #actions>
      <NeoButton label="Rafraîchir" icon="pi pi-refresh" outlined @click="load" />
    </template>

    <div class="kb" v-if="currentBoard && currentBoard.columns">
      <div
        v-for="col in currentBoard.columns"
        :key="col.id"
        class="kb__col"
        @dragover.prevent
        @drop="(e) => onDrop(e, col.id)"
      >
        <div class="kb__col-header">
          <span class="kb__col-name">{{ col.name }}</span>
          <span class="kb__col-count">{{ col.workPackages?.length ?? 0 }}<template v-if="col.wipLimit"> / {{ col.wipLimit }}</template></span>
        </div>
        <div class="kb__col-cards">
          <div
            v-for="wp in col.workPackages"
            :key="wp.id"
            class="kb-card"
            draggable="true"
            @dragstart="onDragStart(wp.id)"
          >
            <div class="kb-card__title">{{ wp.title }}</div>
            <div class="kb-card__meta">
              <NeoTag :value="wp.type" severity="secondary" />
              <PriorityDot :priority="wp.priority" />
              <span v-if="wp.dueDate" class="kb-card__date">{{ formatDate(wp.dueDate) }}</span>
              <span v-if="wp.assignee" class="kb-card__avatar">{{ wp.assignee.firstName[0] }}{{ wp.assignee.lastName[0] }}</span>
            </div>
          </div>
          <div v-if="!col.workPackages?.length" class="kb-card kb-card--empty">Aucune carte</div>
        </div>
      </div>
    </div>
    <div v-else class="kb__loading">Chargement…</div>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { NeoButton, NeoTag, useNeoToast } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import { formatDateShort as formatDate } from '@/lib/formatDate'
import PriorityDot from '@/components/common/PriorityDot.vue'
import { useAgileStore } from '@/stores/agileStore'
import { useCollaborationSocket } from '@/composables/useCollaborationSocket'

const props = defineProps<{ id: string }>()
const toast = useNeoToast()
const agileStore = useAgileStore()
const collab = useCollaborationSocket()

const currentBoard = computed(() => agileStore.currentBoard)
const draggedWpId = ref<string | null>(null)

async function load() {
  await agileStore.fetchBoards(props.id)
  if (agileStore.boards.length) {
    await agileStore.fetchBoard(props.id, agileStore.boards[0].id)
  }
}

// ── Real-time: re-fetch when another user moves a card ────────────────────
watch(collab.remoteCardMove, (payload) => {
  if (!payload || !currentBoard.value) return
  // Refresh the board silently
  agileStore.fetchBoard(props.id, currentBoard.value.id)
})

onMounted(() => {
  // Join project room for real-time events (sidebar already connects the socket)
  collab.joinProject(props.id)
})
onUnmounted(() => {
  collab.leaveProject(props.id)
})

function onDragStart(wpId: string) {
  draggedWpId.value = wpId
}

async function onDrop(e: DragEvent, columnId: string) {
  e.preventDefault()
  if (!draggedWpId.value || !currentBoard.value) return
  const wpId = draggedWpId.value
  draggedWpId.value = null
  try {
    await agileStore.moveCard(props.id, currentBoard.value.id, wpId, columnId, 0)
    await agileStore.fetchBoard(props.id, currentBoard.value.id)
    toast.add({ severity: 'success', detail: 'Carte déplacée.', life: 2000 })
  } catch {
    toast.add({ severity: 'error', detail: 'Échec du déplacement.', life: 3000 })
  }
}

onMounted(load)
</script>

<style scoped>
.kb-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.kb { flex: 1; display: flex; gap: 1rem; padding: 1rem; overflow-x: auto; }
.kb__col {
  flex: 0 0 280px;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  max-height: 100%;
}
.kb__col-header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 0.875rem;
}
.kb__col-count { font-size: 0.75rem; color: var(--nl-text-muted, #6b7280); font-weight: 500; }
.kb__col-cards { flex: 1; padding: 0.5rem; display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto; }
.kb-card {
  padding: 0.75rem;
  background: var(--nl-bg, #f9fafb);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 6px;
  cursor: grab;
  transition: box-shadow 0.15s;
}
.kb-card:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
.kb-card:active { cursor: grabbing; }
.kb-card--empty { text-align: center; color: var(--nl-text-muted, #9ca3af); font-style: italic; font-size: 0.8125rem; cursor: default; }
.kb-card__title { font-weight: 500; font-size: 0.875rem; margin-bottom: 0.5rem; color: var(--nl-text, #111827); }
.kb-card__meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.75rem; color: var(--nl-text-muted, #6b7280); }
.kb-card__date { }
.kb-card__avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--nl-accent, #1e9e8f);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.625rem;
  font-weight: 600;
  margin-left: auto;
}
.kb__loading { padding: 2rem; text-align: center; color: var(--nl-text-muted, #9ca3af); }
</style>
