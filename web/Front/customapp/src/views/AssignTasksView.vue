<!-- @file AssignTasksView.vue — sprint-scoped multi-select assignment.
     Workflow:
       1. PM picks a sprint (or "Hors sprint")
       2. PM multi-selects tasks via checkboxes
       3. PM picks a member from the dropdown
       4. PM clicks "Assigner la sélection" → one bulk-assign call → one
          grouped notification per assignee, deep-linked to /app/team/my-tasks
-->
<template>
  <ProjectModuleShell :project-id="id" title="Assignation des tâches">
    <div class="at">
      <!-- Toolbar -->
      <div class="at__toolbar">
        <div class="at__field">
          <label>Sprint</label>
          <NeoSelect
            v-model="sprintFilter"
            :options="sprintOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Sélectionner un sprint"
            class="at__select"
          />
        </div>
        <div class="at__field">
          <label>Membre</label>
          <NeoSelect
            v-model="targetMemberId"
            :options="memberOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="À qui assigner ?"
            class="at__select"
          />
        </div>
        <NeoButton
          label="Assigner la sélection"
          icon="pi pi-check"
          :loading="saving"
          :disabled="!canAssign"
          @click="onAssign"
        />
      </div>

      <!-- Filters -->
      <div class="at__filters">
        <label class="at__check">
          <input type="checkbox" v-model="showOnlyUnassigned" />
          <span>Non assignées uniquement</span>
        </label>
        <span class="at__sep">·</span>
        <span class="at__counter">
          {{ visibleTasks.length }} tâche(s) ·
          <strong>{{ selectedIds.size }} sélectionnée(s)</strong>
        </span>
      </div>

      <!-- Task table -->
      <div class="at__table-wrap">
        <div v-if="loading" class="at__loading">
          <i class="pi pi-spin pi-spinner" /> Chargement…
        </div>
        <div v-else-if="!members.length" class="at__no-members">
          <p>Aucun membre dans ce projet — ajoutez des membres pour pouvoir leur assigner des tâches.</p>
          <NeoButton label="Ajouter des membres" icon="pi pi-user-plus" @click="goToMembers" />
        </div>
        <div v-else-if="visibleTasks.length === 0" class="at__empty-state">
          Aucune tâche dans ce sprint pour les filtres en cours.
        </div>
        <table v-else class="at__table">
          <thead>
            <tr>
              <th class="at__th-check">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  :indeterminate.prop="someSelected && !allSelected"
                  @change="toggleSelectAll"
                />
              </th>
              <th>Tâche</th>
              <th class="at__th-narrow">Type</th>
              <th class="at__th-narrow">Priorité</th>
              <th class="at__th-narrow">Assigné(e)</th>
              <th class="at__th-narrow">Estim.</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="t in visibleTasks"
              :key="t.id"
              :class="{ 'at__row--selected': selectedIds.has(t.id) }"
              @click="toggleOne(t.id)"
            >
              <td class="at__td-check" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedIds.has(t.id)"
                  @change="toggleOne(t.id)"
                />
              </td>
              <td class="at__td-title">{{ t.title }}</td>
              <td>
                <NeoTag :value="t.type" :severity="typeSev(t.type)" />
              </td>
              <td>
                <PriorityDot :priority="t.priority" />
                <span class="at__priority">{{ t.priority }}</span>
              </td>
              <td class="at__td-assignee">{{ assigneeLabel(t.assigneeId) }}</td>
              <td class="at__td-hours">{{ t.estimatedHours ? `${t.estimatedHours} h` : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { NeoButton, NeoTag, NeoSelect, useNeoToast } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import PriorityDot from '@/components/common/PriorityDot.vue'
import { useAgileStore } from '@/stores/agileStore'
import api, { extractErrorMessage } from '@/lib/api'

const props = defineProps<{ id: string }>()
const router = useRouter()
const toast = useNeoToast()
const agile = useAgileStore()

interface WpRow {
  id: string
  title: string
  type: string
  priority: string
  estimatedHours: number | null
  assigneeId: string | null
  sprintId: string | null
}
interface MemberRow {
  id: string
  userId: string
  label: string
  user: { id: string; firstName: string; lastName: string; email: string }
}

const NO_SPRINT = '__no_sprint__' as const
const UNASSIGN = '__unassign__' as const

const allTasks = ref<WpRow[]>([])
const members = ref<MemberRow[]>([])
const selectedIds = reactive(new Set<string>())
const sprintFilter = ref<string | null>(null)
const targetMemberId = ref<string | null>(null)
const showOnlyUnassigned = ref(false)
const loading = ref(false)
const saving = ref(false)

const sprintOptions = computed(() => {
  const opts: Array<{ label: string; value: string }> = [
    { label: 'Hors sprint', value: NO_SPRINT },
  ]
  for (const s of agile.sprints) {
    opts.push({ label: `${s.name} · ${s.status}`, value: s.id })
  }
  return opts
})

const memberOptions = computed(() => {
  const opts: Array<{ label: string; value: string }> = members.value.map((m) => ({
    label: `${m.user.firstName} ${m.user.lastName}${m.label ? ` — ${m.label}` : ''}`,
    value: m.userId,
  }))
  opts.unshift({ label: '— Désassigner —', value: UNASSIGN })
  return opts
})

const visibleTasks = computed<WpRow[]>(() => {
  let rows = allTasks.value
  if (sprintFilter.value === NO_SPRINT) {
    rows = rows.filter((t) => !t.sprintId)
  } else if (sprintFilter.value) {
    rows = rows.filter((t) => t.sprintId === sprintFilter.value)
  } else {
    return [] // no sprint chosen yet → empty list
  }
  if (showOnlyUnassigned.value) rows = rows.filter((t) => !t.assigneeId)
  return rows
})

const allSelected = computed<boolean>(
  () => visibleTasks.value.length > 0 && visibleTasks.value.every((t) => selectedIds.has(t.id)),
)
const someSelected = computed<boolean>(() => visibleTasks.value.some((t) => selectedIds.has(t.id)))

const canAssign = computed<boolean>(() => selectedIds.size > 0 && !!targetMemberId.value && !saving.value)

function toggleOne(id: string): void {
  if (selectedIds.has(id)) selectedIds.delete(id)
  else selectedIds.add(id)
}
function toggleSelectAll(): void {
  if (allSelected.value) {
    for (const t of visibleTasks.value) selectedIds.delete(t.id)
  } else {
    for (const t of visibleTasks.value) selectedIds.add(t.id)
  }
}

// Reset selection on sprint change so cross-sprint stale selections never assign.
watch(sprintFilter, () => selectedIds.clear())

function typeSev(t: string): 'info' | 'success' | 'danger' | 'secondary' {
  if (t === 'Feature') return 'success'
  if (t === 'Bug') return 'danger'
  if (t === 'Epic') return 'secondary'
  return 'info'
}

function assigneeLabel(id: string | null): string {
  if (!id) return '—'
  const m = members.value.find((x) => x.userId === id)
  if (!m) return '—'
  return `${m.user.firstName} ${m.user.lastName}`
}

function goToMembers(): void {
  void router.push({ name: 'pm-members', params: { id: props.id } })
}

async function onAssign(): Promise<void> {
  if (!canAssign.value) return
  const assigneeId: string | null = targetMemberId.value === UNASSIGN ? null : targetMemberId.value
  const wpIds = Array.from(selectedIds)
  const sprintIdForCall = sprintFilter.value === NO_SPRINT ? undefined : sprintFilter.value ?? undefined

  saving.value = true
  try {
    const { data } = await api.post<{ updated: number }>(
      `/pm/projects/${props.id}/work-packages/bulk-assign`,
      {
        assignments: wpIds.map((wpId) => ({ wpId, assigneeId })),
        ...(sprintIdForCall ? { sprintId: sprintIdForCall } : {}),
      },
    )
    toast.add({
      severity: 'success',
      detail: assigneeId
        ? `${data.updated} tâche(s) assignée(s).`
        : `${data.updated} tâche(s) désassignée(s).`,
      life: 4000,
    })
    // Reflect locally — no need to refetch.
    for (const t of allTasks.value) {
      if (selectedIds.has(t.id)) t.assigneeId = assigneeId
    }
    selectedIds.clear()
  } catch (err: unknown) {
    toast.add({
      severity: 'error',
      detail: extractErrorMessage(err) ?? "Échec de l'assignation",
      life: 5000,
    })
  } finally {
    saving.value = false
  }
}

// Mount/unmount lifecycle ──────────────────────────────────────────────────────

let isMounted = true
onBeforeUnmount(() => { isMounted = false })

function handleBeforeUnload(e: BeforeUnloadEvent): void {
  if (selectedIds.size > 0) {
    e.preventDefault()
    e.returnValue = ''
  }
}

onBeforeRouteLeave((_to, _from, next) => {
  if (selectedIds.size === 0) return next()
  const ok = window.confirm(
    `Vous avez ${selectedIds.size} tâche(s) sélectionnée(s) non assignée(s). Quitter cette page annulera la sélection. Continuer ?`,
  )
  next(ok)
})

onMounted(async () => {
  // Reset state — component may be reused across projects.
  allTasks.value = []
  members.value = []
  selectedIds.clear()
  sprintFilter.value = null
  targetMemberId.value = null

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', handleBeforeUnload)
  }

  loading.value = true
  try {
    // Pull boards + sprints (cold-start auto-create the default board if needed).
    await agile.fetchBoards(props.id)
    let board = agile.boards.find((b) => b.isDefault) ?? agile.boards[0]
    if (!board) {
      board = await agile.createBoard(props.id, { name: 'Default', type: 'Scrum', isDefault: true })
    }
    await agile.fetchSprints(props.id, board.id)

    // Pull tasks (paged) + members in parallel.
    const PAGE_SIZE = 200
    const PAGE_LIMIT = 25 // hard ceiling = 5,000 tasks.
    const aggregated: WpRow[] = []
    let pageIdx = 1
    while (pageIdx <= PAGE_LIMIT) {
      const r = await api.get<WpRow[] | { items: WpRow[] }>(
        `/pm/projects/${props.id}/work-packages?page=${pageIdx}&limit=${PAGE_SIZE}`,
      )
      const page = Array.isArray(r.data) ? r.data : (r.data.items ?? [])
      aggregated.push(...page)
      if (page.length < PAGE_SIZE) break
      pageIdx += 1
    }
    if (pageIdx > PAGE_LIMIT) {
      toast.add({
        severity: 'warn',
        detail: `Plus de ${PAGE_LIMIT * PAGE_SIZE} tâches — affichage limité.`,
        life: 6000,
      })
    }

    const membersRes = await api.get<MemberRow[]>(`/pm/projects/${props.id}/members`)
    if (!isMounted) return
    allTasks.value = aggregated.filter((t) => t.type !== 'Epic')
    members.value = membersRes.data

    // Auto-select first sprint if any exist; else the "Hors sprint" bucket.
    if (agile.sprints.length > 0) {
      const active = agile.sprints.find((s) => s.status === 'Active')
      sprintFilter.value = active?.id ?? agile.sprints[0].id
    } else {
      sprintFilter.value = NO_SPRINT
    }
  } catch {
    if (!isMounted) return
    toast.add({
      severity: 'error',
      detail: 'Impossible de charger les tâches ou les membres.',
      life: 5000,
    })
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', handleBeforeUnload)
  }
})
</script>

<style scoped>
.at {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  flex: 1;
  min-height: 0;
}

/* Toolbar */
.at__toolbar {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  padding: 1rem;
}
.at__field { display: flex; flex-direction: column; gap: 0.35rem; }
.at__field label { font-size: 0.75rem; font-weight: 500; color: var(--nl-text-muted, #6b7280); text-transform: uppercase; letter-spacing: 0.025em; }
.at__select { min-width: 240px; }

/* Filters row */
.at__filters {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.8125rem;
  color: var(--nl-text-muted, #6b7280);
}
.at__check { display: flex; align-items: center; gap: 0.4rem; cursor: pointer; user-select: none; }
.at__sep { opacity: 0.5; }
.at__counter strong { color: var(--nl-text, #111827); }

/* Table */
.at__table-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
}
.at__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.at__table th,
.at__table td {
  padding: 0.6rem 0.85rem;
  text-align: left;
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
}
.at__table thead th {
  background: var(--nl-surface-2, #f3f4f6);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  color: var(--nl-text-muted, #6b7280);
  position: sticky;
  top: 0;
  z-index: 1;
}
.at__th-check { width: 36px; text-align: center; }
.at__th-narrow { width: 110px; }
.at__td-check { text-align: center; }
.at__td-title { font-weight: 500; color: var(--nl-text-1); }
.at__td-assignee { font-size: 0.8125rem; color: var(--nl-text-muted, #6b7280); }
.at__td-hours { font-size: 0.8125rem; color: var(--nl-text-muted, #6b7280); white-space: nowrap; }
.at__priority { margin-left: 0.4rem; font-size: 0.75rem; }
.at__table tbody tr { cursor: pointer; transition: background 0.1s; }
.at__table tbody tr:hover { background: var(--nl-surface-2, #fafafa); }
.at__row--selected { background: var(--nl-accent-light, #ecfdf5); }
.at__row--selected:hover { background: var(--nl-accent-light, #d1fae5); }

.at__loading,
.at__empty-state {
  padding: 3rem 2rem;
  text-align: center;
  color: var(--nl-text-muted, #6b7280);
}
.at__no-members {
  padding: 3rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--nl-text-muted, #6b7280);
}
</style>
