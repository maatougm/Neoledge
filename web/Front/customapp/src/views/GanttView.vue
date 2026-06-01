<!-- @file src/views/GanttView.vue — Simple CSS-based Gantt timeline -->
<template>
  <ProjectModuleShell :project-id="id" title="Gantt">
    <template #actions>
      <NeoSelect
        v-model="zoom"
        :options="zoomOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Zoom"
      />
      <NeoButton label="Nouveau jalon" icon="pi pi-flag" outlined @click="showAddMilestone = true" />
      <NeoButton label="Baseline" icon="pi pi-camera" outlined @click="captureBaselineAction" />
    </template>

    <div v-if="!ganttStore.loading" class="gantt">
      <!-- Left tree panel -->
      <div class="gantt__tree">
        <div class="gantt__tree-header">Work Packages</div>
        <div
          v-for="wp in ganttStore.workPackages"
          :key="wp.id"
          class="gantt__tree-row"
        >
          <div class="gantt__tree-title">{{ wp.title }}</div>
          <div class="gantt__tree-meta">{{ wp.assignee ? `${wp.assignee.firstName} ${wp.assignee.lastName[0]}.` : '—' }}</div>
        </div>
        <div v-if="!ganttStore.workPackages.length" class="gantt__empty">Aucun work package avec des dates.</div>
      </div>

      <!-- Timeline -->
      <div ref="timelineRef" class="gantt__timeline">
        <!-- Header -->
        <div class="gantt__header">
          <div
            v-for="(col, i) in headerCols"
            :key="i"
            class="gantt__header-col"
            :style="{ width: colWidth + 'px' }"
          >{{ col }}</div>
        </div>

        <!-- Today marker -->
        <div v-if="todayOffset !== null" class="gantt__today" :style="{ left: todayOffset + 'px' }">
          <span class="gantt__today-label">Aujourd'hui</span>
        </div>

        <!-- Rows with bars -->
        <div
          v-for="wp in ganttStore.workPackages"
          :key="wp.id"
          class="gantt__row"
          :style="{ width: totalWidth + 'px' }"
        >
          <div
            v-if="barFor(wp)"
            class="gantt__bar"
            :class="{
              'gantt__bar--dragging': draggingWpId === wp.id,
              'gantt__bar--overdue': isWpOverdue(wp),
              'gantt__bar--done': wp.status === 'Closed' || wp.status === 'Resolved',
            }"
            :style="barFor(wp) as Record<string, string>"
            :title="`${wp.title} — glisser pour déplacer, bords pour redimensionner`"
            @mousedown="(e) => startDrag(e, wp, 'move')"
          >
            <div
              class="gantt__bar-handle gantt__bar-handle--left"
              @mousedown.stop="(e) => startDrag(e, wp, 'resize-start')"
            />
            <div class="gantt__bar-progress" :style="{ width: wp.percentDone + '%' }" />
            <span class="gantt__bar-label">{{ wp.title }}</span>
            <div
              class="gantt__bar-handle gantt__bar-handle--right"
              @mousedown.stop="(e) => startDrag(e, wp, 'resize-end')"
            />
          </div>
        </div>

        <!-- Milestone diamonds -->
        <div
          v-for="m in ganttStore.milestones"
          :key="m.id"
          class="gantt__milestone"
          :class="{ 'gantt__milestone--reached': m.isReached }"
          :style="{ left: dateToOffset(m.date) + 'px' }"
          :title="m.title"
          @click="editMilestone(m)"
        >★</div>
      </div>
    </div>
    <div v-else class="gantt__loading">Chargement…</div>

  </ProjectModuleShell>

  <!-- Add/Edit milestone modal -->
  <AppModal v-model:visible="showAddMilestone" :header="editingId ? 'Modifier jalon' : 'Nouveau jalon'" width="480px">
      <div class="gantt__form">
        <NeoInputText v-model="msForm.title" label="Titre" placeholder="Titre du jalon" />
        <NeoDatePicker v-model="msForm.date" dateFormat="yy-mm-dd" label="Date" placeholder="Date" />
        <NeoInputText v-model="msForm.description" label="Description" />
        <label class="gantt__checkbox">
          <input v-model="msForm.isReached" type="checkbox" />
          Jalon atteint
        </label>
      </div>
      <template #footer>
        <NeoButton v-if="editingId" label="Supprimer" severity="danger" outlined @click="deleteCurrentMs" />
        <NeoButton label="Annuler" severity="secondary" outlined @click="closeMsDialog" />
        <NeoButton label="Enregistrer" icon="pi pi-check" @click="saveMs" />
      </template>
    </AppModal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { NeoButton, NeoSelect, NeoInputText, NeoDatePicker, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import AppModal from '@/components/common/AppModal.vue'
import { useGanttStore } from '@/stores/ganttStore'
import { useWorkPackageStore } from '@/stores/workPackageStore'
import type { WorkPackage } from '@/types/work-package.types'
import type { Milestone } from '@/stores/ganttStore'

const props = defineProps<{ id: string }>()
const toast = useNeoToast()
const confirm = useNeoConfirm()
const ganttStore = useGanttStore()
const wpStore = useWorkPackageStore()

const zoom = ref<'day' | 'week' | 'month'>('week')

// ── Drag-drop state ──────────────────────────────────────────────────────
const draggingWpId = ref<string | null>(null)
type DragMode = 'move' | 'resize-start' | 'resize-end'
interface DragState {
  wp: WorkPackage
  mode: DragMode
  startX: number
  origStart: string | null
  origDue: string | null
}
let dragState: DragState | null = null

// Milestone dialog
const showAddMilestone = ref(false)
const editingId = ref<string | null>(null)
const msForm = reactive<{ title: string; date: string | null; description: string; isReached: boolean }>({
  title: '', date: null, description: '', isReached: false,
})
const zoomOptions = [
  { label: 'Jour', value: 'day' },
  { label: 'Semaine', value: 'week' },
  { label: 'Mois', value: 'month' },
]
const timelineRef = ref<HTMLElement | null>(null)

const DAY_MS = 1000 * 60 * 60 * 24
const colWidth = computed(() => {
  if (zoom.value === 'day') return 40
  if (zoom.value === 'week') return 80
  return 120
})

const dateRange = computed(() => {
  const items = ganttStore.workPackages
  let min = new Date()
  let max = new Date()
  min.setDate(min.getDate() - 7)
  max.setDate(max.getDate() + 30)
  for (const wp of items) {
    if (wp.startDate) { const d = new Date(wp.startDate); if (d < min) min = d }
    if (wp.dueDate)   { const d = new Date(wp.dueDate);   if (d > max) max = d }
  }
  for (const m of ganttStore.milestones) {
    const d = new Date(m.date)
    if (d < min) min = d
    if (d > max) max = d
  }
  return { min, max }
})

const totalDays = computed(() => Math.max(1, Math.ceil((dateRange.value.max.getTime() - dateRange.value.min.getTime()) / DAY_MS)))
// Derive width from the actual column count produced by headerCols to avoid
// off-by-one drift when month lengths differ from the hardcoded 30-day constant.
const totalWidth = computed(() => headerCols.value.length * colWidth.value)

const headerCols = computed(() => {
  const { min, max } = dateRange.value
  const cols: string[] = []
  const cur = new Date(min)
  while (cur <= max) {
    if (zoom.value === 'day') {
      cols.push(cur.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }))
      cur.setDate(cur.getDate() + 1)
    } else if (zoom.value === 'week') {
      cols.push(`S${getWeekNumber(cur)}`)
      cur.setDate(cur.getDate() + 7)
    } else {
      cols.push(cur.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }))
      cur.setMonth(cur.getMonth() + 1)
    }
  }
  return cols
})

interface WpLite { dueDate?: string | null; endDate?: string | null; status: string }
function isWpOverdue(wp: WpLite): boolean {
  if (wp.status === 'Closed' || wp.status === 'Resolved') return false
  const end = wp.endDate ?? wp.dueDate
  if (!end) return false
  return new Date(end).getTime() < Date.now()
}

const todayOffset = computed(() => {
  const today = new Date()
  const { min, max } = dateRange.value
  if (today < min || today > max) return null
  return dateToOffset(today.toISOString())
})

function getWeekNumber(d: Date): number {
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7))
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  return 1 + Math.round(((target.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getDay() + 6) % 7)) / 7)
}

function dateToOffset(iso: string): number {
  const d = new Date(iso)
  const days = (d.getTime() - dateRange.value.min.getTime()) / DAY_MS
  return (days / totalDays.value) * totalWidth.value
}

function barFor(wp: WorkPackage): Record<string, string> | null {
  if (!wp.startDate && !wp.dueDate) return null
  const start = wp.startDate ? new Date(wp.startDate) : new Date(wp.dueDate!)
  const end = wp.dueDate ? new Date(wp.dueDate) : new Date(wp.startDate!)
  const left = dateToOffset(start.toISOString())
  const right = dateToOffset(end.toISOString())
  return { left: `${left}px`, width: `${Math.max(20, right - left)}px` }
}

async function captureBaselineAction() {
  const name = `Baseline ${new Date().toLocaleDateString('fr-FR')}`
  await ganttStore.captureBaseline(props.id, name)
  toast.add({ severity: 'success', detail: `Baseline ${name} capturée.`, life: 3000 })
}

// ── Drag-drop bar implementation ──────────────────────────────────────────
/** Convert pixel delta to day delta based on current zoom. */
function pixelsToDays(px: number): number {
  const daysPerCol = zoom.value === 'day' ? 1 : zoom.value === 'week' ? 7 : 30
  return Math.round((px * daysPerCol) / colWidth.value)
}

function addDays(iso: string | null, n: number): string | null {
  if (!iso) return null
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function startDrag(e: MouseEvent, wp: WorkPackage, mode: DragMode) {
  e.preventDefault()
  dragState = {
    wp,
    mode,
    startX: e.clientX,
    origStart: wp.startDate ?? null,
    origDue: wp.dueDate ?? null,
  }
  draggingWpId.value = wp.id
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  if (!dragState) return
  const dxDays = pixelsToDays(e.clientX - dragState.startX)
  if (dxDays === 0) return
  let newStart = dragState.origStart
  let newDue = dragState.origDue
  if (dragState.mode === 'move') {
    newStart = addDays(dragState.origStart, dxDays)
    newDue = addDays(dragState.origDue, dxDays)
  } else if (dragState.mode === 'resize-start') {
    newStart = addDays(dragState.origStart, dxDays)
  } else if (dragState.mode === 'resize-end') {
    newDue = addDays(dragState.origDue, dxDays)
  }

  // Optimistic update (visual only, not persisted until mouseup) — through
  // a store action rather than a direct array index mutation from the view.
  ganttStore.patchWorkPackage(dragState.wp.id, { startDate: newStart, dueDate: newDue })
}

async function onDragEnd() {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  if (!dragState) { draggingWpId.value = null; return }
  const wp = ganttStore.workPackages.find((w) => w.id === dragState!.wp.id)
  const state = dragState
  dragState = null
  draggingWpId.value = null

  if (!wp || (wp.startDate === state.origStart && wp.dueDate === state.origDue)) return
  try {
    await wpStore.update(props.id, wp.id, {
      startDate: wp.startDate ?? null,
      dueDate: wp.dueDate ?? null,
    })
    toast.add({ severity: 'success', detail: 'Dates mises à jour.', life: 2000 })
  } catch {
    // Revert on failure
    ganttStore.patchWorkPackage(wp.id, { startDate: state.origStart, dueDate: state.origDue })
    toast.add({ severity: 'error', detail: 'Échec de la mise à jour.', life: 3000 })
  }
}

function editMilestone(m: Milestone) {
  editingId.value = m.id
  msForm.title = m.title
  msForm.date = m.date
  msForm.description = m.description ?? ''
  msForm.isReached = m.isReached
  showAddMilestone.value = true
}

function closeMsDialog() {
  showAddMilestone.value = false
  editingId.value = null
  msForm.title = ''
  msForm.date = null
  msForm.description = ''
  msForm.isReached = false
}

async function saveMs() {
  if (!msForm.title.trim() || !msForm.date) {
    toast.add({ severity: 'warn', detail: 'Titre et date requis.', life: 3000 })
    return
  }
  try {
    if (editingId.value) {
      await ganttStore.updateMilestone(props.id, editingId.value, {
        title: msForm.title,
        date: msForm.date,
        description: msForm.description,
        isReached: msForm.isReached,
      })
    } else {
      await ganttStore.createMilestone(props.id, {
        title: msForm.title,
        date: msForm.date,
        description: msForm.description || undefined,
      })
    }
    closeMsDialog()
    toast.add({ severity: 'success', detail: 'Jalon enregistré.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: 'Échec.', life: 3000 })
  }
}

function deleteCurrentMs() {
  if (!editingId.value) return
  const id = editingId.value
  confirm.require({
    message: 'Supprimer ce jalon ?',
    header: 'Confirmation',
    accept: async () => {
      await ganttStore.deleteMilestone(props.id, id)
      closeMsDialog()
      toast.add({ severity: 'success', detail: 'Supprimé.', life: 3000 })
    },
  })
}

onMounted(() => ganttStore.fetchGantt(props.id))
onUnmounted(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  // Drop any in-progress drag so the next mount starts clean and an
  // abandoned wpStore.update call doesn't leak optimistic visual state.
  dragState = null
  draggingWpId.value = null
})
</script>

<style scoped>
.gantt-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.gantt { display: flex; flex: 1; overflow: hidden; }
.gantt__tree {
  width: 280px;
  flex-shrink: 0;
  background: var(--nl-card-bg, #fff);
  border-right: 1px solid var(--nl-border, #e5e7eb);
  overflow-y: auto;
}
.gantt__tree-header {
  padding: 0.5rem 1rem;
  height: 36px;
  display: flex;
  align-items: center;
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--nl-text-muted, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
  background: var(--nl-table-header-bg, #f3f4f6);
}
.gantt__tree-row {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1rem;
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
  font-size: 0.8125rem;
  gap: 0.5rem;
}
.gantt__tree-title { font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gantt__tree-meta { color: var(--nl-text-muted, #9ca3af); font-size: 0.75rem; flex-shrink: 0; }
.gantt__timeline {
  flex: 1;
  overflow-x: auto;
  overflow-y: auto;
  background: var(--nl-card-bg, #fff);
  position: relative;
}
.gantt__header {
  display: flex;
  height: 36px;
  position: sticky;
  top: 0;
  background: var(--nl-table-header-bg, #f3f4f6);
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
  z-index: 2;
}
.gantt__header-col {
  border-right: 1px solid var(--nl-border, #e5e7eb);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--nl-text-muted, #6b7280);
  flex-shrink: 0;
}
.gantt__today {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ef4444;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
  z-index: 5;
  pointer-events: none;
}
.gantt__today-label {
  position: absolute;
  top: 6px; left: -30px;
  background: #ef4444; color: #fff;
  padding: 2px 8px; border-radius: var(--nl-radius-pill);
  font-size: 10px; font-weight: 600;
  pointer-events: none;
  white-space: nowrap;
}
.gantt__row { height: 40px; border-bottom: 1px solid var(--nl-border, #f3f4f6); position: relative; }
.gantt__bar {
  position: absolute;
  top: 8px;
  height: 24px;
  background: var(--nl-accent);
  border-radius: 4px;
  display: flex;
  align-items: center;
  padding: 0 0.5rem;
  color: #fff;
  font-size: 0.75rem;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
  cursor: grab;
  user-select: none;
}
.gantt__bar--overdue {
  background: var(--nl-danger);
  box-shadow: 0 0 0 1px var(--nl-danger), 0 2px 6px rgba(220, 38, 38, 0.3);
}
.gantt__bar--done {
  background: var(--nl-success);
  opacity: 0.65;
  transition: box-shadow 0.15s;
}
.gantt__bar:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.2); }
.gantt__bar--dragging { cursor: grabbing; opacity: 0.8; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
.gantt__bar-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  background: rgba(0,0,0,0.2);
  z-index: 2;
  opacity: 0;
  transition: opacity 0.15s;
}
.gantt__bar:hover .gantt__bar-handle { opacity: 1; }
.gantt__bar-handle--left { left: 0; border-radius: 4px 0 0 4px; }
.gantt__bar-handle--right { right: 0; border-radius: 0 4px 4px 0; }
.gantt__bar-progress {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: rgba(0,0,0,0.15);
}
.gantt__bar-label { position: relative; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gantt__milestone {
  position: absolute;
  top: 36px;
  width: 20px;
  margin-left: -10px;
  color: #f59e0b;
  font-size: 1.5rem;
  z-index: 1;
  cursor: pointer;
  transition: transform 0.15s;
}
.gantt__milestone:hover { transform: scale(1.2); }
.gantt__milestone--reached { color: #10b981; }
.gantt__form { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.5rem 0; }
.gantt__checkbox { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer; }
.gantt__loading, .gantt__empty { padding: 2rem; text-align: center; color: var(--nl-text-muted, #9ca3af); }
</style>
