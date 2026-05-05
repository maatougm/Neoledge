<!-- @file AssignTasksView.vue — drag tasks onto project members to assign them -->
<template>
  <ProjectModuleShell :project-id="id" title="Assignation des tâches">
    <template #actions>
      <span class="at__pending">{{ pendingChangeCount }} changement(s) en attente</span>
      <NeoButton
        label="Valider les assignations"
        icon="pi pi-check"
        :loading="saving"
        :disabled="pendingChangeCount === 0"
        @click="onValidate"
      />
    </template>

    <div class="at">
      <!-- Unassigned column -->
      <div
        class="at__col at__col--unassigned"
        @dragover.prevent
        @drop="onDrop(null)"
      >
        <header class="at__col-head">
          <i class="pi pi-inbox" />
          <h3>Non assigné</h3>
          <span class="at__count">{{ unassignedTasks.length }}</span>
        </header>
        <div class="at__col-body">
          <div
            v-for="t in unassignedTasks"
            :key="t.id"
            class="at__card"
            draggable="true"
            @dragstart="startDrag(t.id)"
            @dragend="draggingWpId = null"
          >
            <div class="at__card-row">
              <PriorityDot :priority="t.priority" />
              <span class="at__card-title">{{ t.title }}</span>
              <NeoTag :value="t.type" :severity="typeSev(t.type)" />
            </div>
            <div v-if="t.estimatedHours" class="at__card-meta">
              <i class="pi pi-clock" /> {{ t.estimatedHours }} h
            </div>
          </div>
          <div v-if="!unassignedTasks.length" class="at__empty">Toutes les tâches sont assignées.</div>
        </div>
      </div>

      <!-- Member columns -->
      <div
        v-for="m in members"
        :key="m.id"
        class="at__col"
        @dragover.prevent
        @drop="onDrop(m.userId)"
      >
        <header class="at__col-head">
          <div class="at__avatar">{{ initials(m.user) }}</div>
          <div class="at__member-info">
            <h3>{{ m.user.firstName }} {{ m.user.lastName }}</h3>
            <span v-if="m.label" class="at__member-label">{{ m.label }}</span>
          </div>
          <span class="at__count">{{ tasksForMember(m.userId).length }}</span>
        </header>
        <div class="at__col-body">
          <div
            v-for="t in tasksForMember(m.userId)"
            :key="t.id"
            class="at__card"
            draggable="true"
            @dragstart="startDrag(t.id)"
            @dragend="draggingWpId = null"
          >
            <div class="at__card-row">
              <PriorityDot :priority="t.priority" />
              <span class="at__card-title">{{ t.title }}</span>
              <NeoTag :value="t.type" :severity="typeSev(t.type)" />
            </div>
            <div v-if="t.estimatedHours" class="at__card-meta">
              <i class="pi pi-clock" /> {{ t.estimatedHours }} h
            </div>
          </div>
          <div v-if="!tasksForMember(m.userId).length" class="at__empty">Glisser une tâche ici…</div>
        </div>
      </div>

      <div v-if="!members.length" class="at__no-members">
        <p>Aucun membre dans ce projet — ajoutez des membres pour pouvoir leur assigner des tâches.</p>
        <NeoButton
          label="Ajouter des membres"
          icon="pi pi-user-plus"
          @click="goToMembers"
        />
      </div>
    </div>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { NeoButton, NeoTag, useNeoToast } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import PriorityDot from '@/components/common/PriorityDot.vue'
import api, { extractErrorMessage } from '@/lib/api'

const props = defineProps<{ id: string }>()
const router = useRouter()
const toast = useNeoToast()

interface WpRow {
  id: string
  title: string
  type: string
  priority: string
  estimatedHours: number | null
  assigneeId: string | null
}

interface MemberRow {
  id: string
  userId: string
  label: string
  user: { id: string; firstName: string; lastName: string; email: string }
}

const allTasks = ref<WpRow[]>([])
const members = ref<MemberRow[]>([])
const original = ref<Record<string, string | null>>({})
const assignments = reactive<Record<string, string | null>>({})
const draggingWpId = ref<string | null>(null)
const saving = ref(false)

const pendingChangeCount = computed(() => {
  let n = 0
  for (const t of allTasks.value) {
    if ((assignments[t.id] ?? null) !== (original.value[t.id] ?? null)) n++
  }
  return n
})

const unassignedTasks = computed(() => allTasks.value.filter((t) => !assignments[t.id]))

function tasksForMember(userId: string): WpRow[] {
  return allTasks.value.filter((t) => assignments[t.id] === userId)
}

function startDrag(wpId: string): void {
  draggingWpId.value = wpId
}

function onDrop(memberId: string | null): void {
  if (!draggingWpId.value) return
  assignments[draggingWpId.value] = memberId
  draggingWpId.value = null
}

function initials(u: MemberRow['user']): string {
  return ((u.firstName?.[0] ?? '') + (u.lastName?.[0] ?? '')).toUpperCase() || '?'
}

function typeSev(t: string): 'info' | 'success' | 'danger' | 'secondary' {
  if (t === 'Feature') return 'success'
  if (t === 'Bug') return 'danger'
  if (t === 'Epic') return 'secondary'
  return 'info'
}

async function onValidate(): Promise<void> {
  const changed: Array<{ wpId: string; assigneeId: string | null }> = []
  for (const t of allTasks.value) {
    const newAssignee = assignments[t.id] ?? null
    if (newAssignee !== (original.value[t.id] ?? null)) {
      changed.push({ wpId: t.id, assigneeId: newAssignee })
    }
  }
  if (changed.length === 0) return

  saving.value = true
  try {
    const { data } = await api.post<{ updated: number }>(
      `/pm/projects/${props.id}/work-packages/bulk-assign`,
      { assignments: changed },
    )
    toast.add({
      severity: 'success',
      detail: `${data.updated} tâche(s) assignée(s) avec succès.`,
      life: 4000,
    })
    // Sync original to current
    for (const t of allTasks.value) {
      original.value[t.id] = assignments[t.id]
    }
  } catch (err: unknown) {
    const msg = extractErrorMessage(err) ?? 'Échec de l\'assignation'
    toast.add({ severity: 'error', detail: msg, life: 5000 })
  } finally {
    saving.value = false
  }
}

function goToMembers(): void {
  void router.push({ name: 'pm-members', params: { id: props.id } })
}

// Guard against stale-state leaks: if the user navigates away mid-fetch, don't write
// the response into refs after unmount. Also clear any prior project's data on mount.
let isMounted = true
onBeforeUnmount(() => { isMounted = false })

// Warn the user before they lose pending drag-and-drop assignments.
onBeforeRouteLeave((_to, _from, next) => {
  if (pendingChangeCount.value === 0) return next()
  const ok = window.confirm(
    `Vous avez ${pendingChangeCount.value} changement(s) non enregistré(s). Quitter cette page les annulera. Continuer ?`,
  )
  next(ok)
})

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (pendingChangeCount.value > 0) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
}

onMounted(async () => {
  // Reset all state in case the component is reused across projects.
  allTasks.value = []
  members.value = []
  for (const k of Object.keys(original.value)) delete original.value[k]
  for (const k of Object.keys(assignments)) delete assignments[k]

  try {
    // Page through up to PAGE_LIMIT pages so projects with >500 WPs aren't silently truncated.
    const PAGE_SIZE = 200
    const PAGE_LIMIT = 25 // hard ceiling = 5,000 tasks. Beyond that, the assign-board is the wrong UI.
    const aggregated: WpRow[] = []
    let pageIdx = 1
    while (pageIdx <= PAGE_LIMIT) {
      const r = await api.get<WpRow[] | { items: WpRow[] }>(`/pm/projects/${props.id}/work-packages?page=${pageIdx}&limit=${PAGE_SIZE}`)
      const page = Array.isArray(r.data) ? r.data : (r.data.items ?? [])
      aggregated.push(...page)
      if (page.length < PAGE_SIZE) break
      pageIdx += 1
    }
    if (pageIdx > PAGE_LIMIT) {
      toast.add({
        severity: 'warn',
        detail: `Plus de ${PAGE_LIMIT * PAGE_SIZE} tâches trouvées — affichage limité. Utilisez Work Packages pour la liste complète.`,
        life: 6000,
      })
    }

    const membersRes = await api.get<MemberRow[]>(`/pm/projects/${props.id}/members`)
    if (!isMounted) return
    allTasks.value = aggregated.filter((t) => t.type !== 'Epic')
    members.value = membersRes.data
    for (const t of allTasks.value) {
      original.value[t.id] = t.assigneeId
      assignments[t.id] = t.assigneeId
    }
  } catch {
    if (!isMounted) return
    toast.add({
      severity: 'error',
      detail: 'Impossible de charger les tâches ou les membres.',
      life: 5000,
    })
  }
})
</script>

<style scoped>
.at {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
  min-height: 0;
}
.at__col {
  flex: 0 0 280px;
  display: flex;
  flex-direction: column;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  overflow: hidden;
  max-height: 100%;
}
.at__col--unassigned { background: var(--nl-surface-2, #fafafa); }
.at__col-head {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--nl-surface-2, #f3f4f6);
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
}
.at__col-head h3 { font-size: 0.875rem; font-weight: 600; margin: 0; flex: 1; }
.at__avatar {
  width: 28px; height: 28px;
  background: var(--nl-accent, #1e9e8f);
  color: #fff;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.75rem; font-weight: 600;
}
.at__member-info { flex: 1; display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
.at__member-info h3 { font-size: 0.875rem; font-weight: 600; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.at__member-label { font-size: 0.6875rem; color: var(--nl-text-muted, #6b7280); }
.at__count {
  background: #fff;
  padding: 0.125rem 0.5rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  border: 1px solid var(--nl-border, #e5e7eb);
}
.at__col-body { flex: 1; overflow-y: auto; padding: 0.5rem; min-height: 200px; }
.at__card {
  background: #fff;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 6px;
  padding: 0.625rem 0.75rem;
  margin-bottom: 0.5rem;
  cursor: grab;
  transition: box-shadow 0.15s;
}
.at__card:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
.at__card:active { cursor: grabbing; }
.at__card-row { display: flex; align-items: center; gap: 0.5rem; }
.at__card-title { flex: 1; font-size: 0.8125rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.at__card-meta { font-size: 0.75rem; color: var(--nl-text-muted, #6b7280); margin-top: 0.375rem; }
.at__empty {
  text-align: center;
  color: var(--nl-text-muted, #9ca3af);
  font-size: 0.8125rem;
  padding: 1.5rem 0.5rem;
  font-style: italic;
}
.at__pending { color: var(--nl-text-muted, #6b7280); font-size: 0.8125rem; margin-right: 0.75rem; }
.at__no-members {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 1rem;
  padding: 3rem;
  color: var(--nl-text-muted, #6b7280);
}
</style>
