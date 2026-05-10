<!-- @file src/views/KanbanBoardView.vue — Drag-drop Kanban board -->
<template>
  <ProjectModuleShell :project-id="id" :title="currentBoard?.name || 'Board'">
    <template #actions>
      <NeoButton label="Rafraîchir" icon="pi pi-refresh" outlined size="small" @click="load" />
    </template>

    <!-- Filter pills + swimlane + filter controls -->
    <div v-if="currentBoard" class="kb-toolbar">
      <div class="kb-toolbar__pills">
        <button
          v-for="p in pills" :key="p.key"
          class="nl-pill"
          :class="{ 'nl-pill--active': activePill === p.key }"
          @click="activePill = p.key"
        >
          <i class="pi" :class="p.icon" /> {{ p.label }}
        </button>
      </div>
      <div class="kb-toolbar__lane">
        <label>Couloirs&nbsp;</label>
        <select v-model="swimlane" class="kb-toolbar__select">
          <option value="none">Aucun</option>
          <option value="assignee">Par assigné</option>
          <option value="priority">Par priorité</option>
        </select>
      </div>
    </div>

    <div v-if="currentBoard && currentBoard.columns" class="kb-scroll">
      <!-- For each swimlane (or single lane when none) -->
      <div v-for="lane in swimlanes" :key="lane.key" class="kb-lane">
        <div v-if="swimlane !== 'none'" class="kb-lane__header">
          <span class="kb-lane__title">{{ lane.label }}</span>
          <span class="kb-lane__count">{{ lane.totalCount }}</span>
        </div>
        <div class="kb">
          <div
            v-for="col in currentBoard.columns"
            :key="`${lane.key}-${col.id}`"
            class="kb__col"
            :class="{ 'kb__col--over-limit': isOverLimit(col, lane.key) }"
            @dragover.prevent
            @drop="(e) => onDrop(e, col.id)"
          >
            <div class="kb__col-header">
              <span class="kb__col-name">{{ col.name }}</span>
              <span class="kb__col-count">
                {{ countInLane(col, lane.key) }}<template v-if="col.wipLimit && swimlane === 'none'"> / {{ col.wipLimit }}</template>
              </span>
            </div>
            <div class="kb__col-cards">
              <div
                v-for="wp in cardsInLane(col, lane.key)"
                :key="wp.id"
                class="kb-card"
                :class="{ 'kb-card--urgent': wp.priority === 'Urgent' || wp.priority === 'Immediate' }"
                draggable="true"
                @dragstart="onDragStart(wp.id)"
                @dragend="onDragEnd()"
                @click="goToWp(wp.id)"
              >
                <div class="kb-card__top">
                  <span class="nl-prio-dot" :class="`nl-prio-dot--${prioClass(wp.priority)}`" />
                  <span class="kb-card__type">{{ wp.type }}</span>
                  <span v-if="wp.assignee" class="kb-card__avatar" :title="`${wp.assignee.firstName} ${wp.assignee.lastName}`">
                    {{ wp.assignee.firstName[0] }}{{ wp.assignee.lastName[0] }}
                  </span>
                </div>
                <div class="kb-card__title">{{ wp.title }}</div>
                <div class="kb-card__meta">
                  <span v-if="wp.dueDate" class="kb-card__date" :class="{ 'kb-card__date--overdue': isOverdue(wp.dueDate) }">
                    <i class="pi pi-calendar" />
                    {{ formatDate(wp.dueDate) }}
                  </span>
                </div>
              </div>
              <div v-if="cardsInLane(col, lane.key).length === 0" class="kb-card--empty">
                Déposez une carte ici
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="kb__loading">Chargement…</div>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NeoButton, useNeoToast } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import { formatDateShort as formatDate } from '@/lib/formatDate'
import { useAgileStore } from '@/stores/agileStore'
import { useAuthStore } from '@/stores/authStore'
import { useCollaborationSocket } from '@/composables/useCollaborationSocket'

interface KanbanCard {
  id: string; title: string; type: string; priority: string; status: string;
  dueDate?: string | null; assigneeId?: string | null;
  assignee?: { id: string; firstName: string; lastName: string } | null
}

const props = defineProps<{ id: string }>()
const router = useRouter()
const toast = useNeoToast()
const agileStore = useAgileStore()
const authStore = useAuthStore()
const collab = useCollaborationSocket()

const currentBoard = computed(() => agileStore.currentBoard)
const draggedWpId = ref<string | null>(null)

// Filter pills
type PillKey = 'all' | 'mine' | 'urgent' | 'unassigned'
const pills: { key: PillKey; label: string; icon: string }[] = [
  { key: 'all',        label: 'Tout',        icon: 'pi-list' },
  { key: 'mine',       label: 'À moi',       icon: 'pi-user' },
  { key: 'urgent',     label: 'Urgent',      icon: 'pi-exclamation-triangle' },
  { key: 'unassigned', label: 'Non assigné', icon: 'pi-user-minus' },
]
const activePill = ref<PillKey>('all')
function matchesPill(wp: KanbanCard): boolean {
  switch (activePill.value) {
    case 'all':        return true
    case 'mine':       return wp.assigneeId === authStore.userId
    case 'urgent':     return wp.priority === 'Urgent' || wp.priority === 'Immediate' || wp.priority === 'Critical'
    case 'unassigned': return !wp.assigneeId
  }
}

// Swimlanes
type Lane = 'none' | 'assignee' | 'priority'
const swimlane = ref<Lane>('none')

interface SwimLane { key: string; label: string; totalCount: number }
const swimlanes = computed<SwimLane[]>(() => {
  if (swimlane.value === 'none' || !currentBoard.value) {
    return [{ key: '__all__', label: '', totalCount: 0 }]
  }
  const bucket = new Map<string, { label: string; count: number }>()
  for (const col of currentBoard.value.columns ?? []) {
    for (const wp of (col.workPackages ?? []) as KanbanCard[]) {
      if (!matchesPill(wp)) continue
      let k = '__none__', label = 'Non assigné'
      if (swimlane.value === 'assignee') {
        if (wp.assignee) { k = wp.assignee.id; label = `${wp.assignee.firstName} ${wp.assignee.lastName}` }
      } else if (swimlane.value === 'priority') {
        k = wp.priority; label = wp.priority
      }
      if (!bucket.has(k)) bucket.set(k, { label, count: 0 })
      bucket.get(k)!.count++
    }
  }
  return Array.from(bucket.entries()).map(([k, v]) => ({ key: k, label: v.label, totalCount: v.count }))
})

interface BoardColumn { id: string; name: string; wipLimit: number | null; workPackages?: KanbanCard[] }
function cardsInLane(col: BoardColumn, laneKey: string): KanbanCard[] {
  const all: KanbanCard[] = (col.workPackages ?? []).filter(matchesPill)
  if (swimlane.value === 'none' || laneKey === '__all__') return all
  return all.filter((wp) => {
    if (swimlane.value === 'assignee') return (wp.assignee?.id ?? '__none__') === laneKey
    if (swimlane.value === 'priority') return wp.priority === laneKey
    return true
  })
}
function countInLane(col: BoardColumn, laneKey: string): number { return cardsInLane(col, laneKey).length }
function isOverLimit(col: BoardColumn, laneKey: string): boolean {
  return swimlane.value === 'none' && !!col.wipLimit && countInLane(col, laneKey) > col.wipLimit
}

function prioClass(p: string): 'urgent' | 'high' | 'normal' | 'low' {
  const v = (p || '').toLowerCase()
  if (v === 'urgent' || v === 'critical' || v === 'immediate') return 'urgent'
  if (v === 'high') return 'high'
  if (v === 'low') return 'low'
  return 'normal'
}
function isOverdue(d: string | null): boolean { return !!d && new Date(d).getTime() < Date.now() }
function goToWp(wpId: string): void { void router.push(`/app/pm/projects/${props.id}/workpackages?wpId=${wpId}`) }

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

onMounted(async () => {
  // Join project room for real-time events (sidebar already connects the socket)
  collab.joinProject(props.id)
  await load()
})
onUnmounted(() => {
  collab.leaveProject(props.id)
})

function onDragStart(wpId: string) {
  draggedWpId.value = wpId
}

// Mandatory reset — without this, draggedWpId leaks if the drop is cancelled
// (Esc, drop outside columns) and the next drop assigns the wrong WP.
function onDragEnd() {
  draggedWpId.value = null
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
</script>

<style scoped>
.kb-toolbar {
  display: flex; justify-content: space-between; align-items: center;
  gap: var(--nl-sp-3);
  padding: var(--nl-sp-2) var(--nl-sp-4);
  background: var(--nl-surface);
  border-bottom: 1px solid var(--nl-border);
  flex-wrap: wrap;
}
.kb-toolbar__pills { display: flex; gap: var(--nl-sp-1); flex-wrap: wrap; }
.kb-toolbar__pills .nl-pill { cursor: pointer; border: 1px solid transparent; background: transparent; }
.kb-toolbar__pills .nl-pill:hover { background: var(--nl-surface-2); }
.kb-toolbar__lane { display: flex; align-items: center; gap: var(--nl-sp-1); font-size: var(--nl-fs-sm); color: var(--nl-text-3); }
.kb-toolbar__select {
  padding: 4px 8px; border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius); background: var(--nl-surface);
  font-family: var(--nl-font); font-size: var(--nl-fs-sm);
  color: var(--nl-text-1); cursor: pointer;
}

.kb-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: var(--nl-sp-2); }
.kb-lane { margin-bottom: var(--nl-sp-4); }
.kb-lane__header {
  display: flex; align-items: center; gap: var(--nl-sp-2);
  padding: var(--nl-sp-2) var(--nl-sp-3);
  font-size: var(--nl-fs-sm); color: var(--nl-text-2); font-weight: 600;
}
.kb-lane__count {
  background: var(--nl-surface-2); color: var(--nl-text-3);
  padding: 1px 7px; border-radius: var(--nl-radius-pill);
  font-size: var(--nl-fs-xs); font-weight: 700;
}

.kb-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.kb { display: flex; gap: var(--nl-sp-2); padding: 0 var(--nl-sp-1); overflow-x: auto; align-items: stretch; }
.kb__col {
  flex: 0 0 280px;
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: var(--nl-radius-lg);
  display: flex;
  flex-direction: column;
  max-height: 100%;
  transition: border-color 0.15s, background 0.15s;
}
.kb__col--over-limit {
  border-color: var(--nl-danger);
  background: var(--nl-danger-light);
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
  padding: var(--nl-sp-2);
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  cursor: grab;
  transition: border-color 0.15s, box-shadow 0.15s;
  display: flex; flex-direction: column; gap: 4px;
}
.kb-card:hover { border-color: var(--nl-accent); box-shadow: var(--nl-shadow); }
.kb-card:active { cursor: grabbing; }
.kb-card--urgent { border-left: 3px solid var(--nl-danger); }
.kb-card--empty {
  padding: var(--nl-sp-3); text-align: center;
  color: var(--nl-text-3); font-style: italic;
  font-size: var(--nl-fs-sm); background: transparent;
  border: 1px dashed var(--nl-border); border-radius: var(--nl-radius);
}
.kb-card__top { display: flex; align-items: center; gap: var(--nl-sp-1); }
.kb-card__type {
  font-size: var(--nl-fs-xs); color: var(--nl-text-3);
  text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
}
.kb-card__title { font-size: var(--nl-fs-base); font-weight: 500; color: var(--nl-text-1); line-height: 1.3; }
.kb-card__meta { display: flex; align-items: center; gap: var(--nl-sp-1); font-size: var(--nl-fs-xs); color: var(--nl-text-3); }
.kb-card__date { display: inline-flex; align-items: center; gap: 3px; }
.kb-card__date--overdue { color: var(--nl-danger); font-weight: 600; }
.kb-card__avatar {
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--nl-accent); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 700; margin-left: auto;
}
.kb__loading { padding: var(--nl-sp-8); text-align: center; color: var(--nl-text-3); }
</style>
