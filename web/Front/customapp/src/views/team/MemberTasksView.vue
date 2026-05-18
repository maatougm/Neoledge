<!-- @file MemberTasksView.vue — Member task list with tabs, filters, multi-select.
     URL-synced filters: ?tab, ?projectId, ?sprintId, ?q. Honors notification
     deep-links (e.g. /app/team/my-tasks?projectId=X&sprintId=Y). -->
<template>
  <div class="mt">
    <header class="mt__head">
      <h1 class="mt__title">Mes tâches</h1>
      <p class="mt__subtitle">{{ subtitle }}</p>
    </header>

    <nav class="mt__tabs" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.value"
        role="tab"
        :aria-selected="store.filters.tab === t.value"
        class="mt__tab"
        :class="{ 'mt__tab--active': store.filters.tab === t.value }"
        @click="onTabChange(t.value)"
      >
        <i :class="`pi ${t.icon}`" />
        {{ t.label }}
      </button>
    </nav>

    <div class="mt__filters">
      <NeoSelect
        v-model="projectFilter"
        :options="projectOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Tous les projets"
        showClear
        class="mt__select"
        @update:modelValue="onProjectChange"
      />
      <NeoSelect
        v-model="sprintFilter"
        :options="sprintOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Tous les sprints"
        showClear
        class="mt__select"
        @update:modelValue="onSprintChange"
      />
      <NeoInputText
        v-model="qFilter"
        placeholder="Rechercher dans le titre…"
        class="mt__search"
        @keyup.enter="onSearchEnter"
      />
    </div>

    <Transition name="mt-fade">
      <div v-if="store.selectedIds.size > 0" class="mt__bulk">
        <span class="mt__bulk-count">{{ store.selectedIds.size }} sélectionnée(s)</span>
        <div class="mt__bulk-actions">
          <NeoButton
            label="Démarrer"
            icon="pi pi-play"
            size="small"
            :loading="busy"
            @click="onBulk('InProgress')"
          />
          <NeoButton
            label="À valider"
            icon="pi pi-flag"
            severity="secondary"
            outlined
            size="small"
            :loading="busy"
            @click="onBulk('AwaitingReview')"
          />
          <NeoButton
            label="Annuler"
            severity="secondary"
            text
            size="small"
            @click="store.clearSelection"
          />
        </div>
      </div>
    </Transition>

    <NeoMessage v-if="store.error" severity="error" :text="store.error" class="mb-3" />

    <div v-if="store.loading && store.items.length === 0" class="mt__loading">
      <i class="pi pi-spin pi-spinner" /> Chargement…
    </div>
    <div v-else-if="store.items.length === 0" class="mt__empty">
      <i class="pi pi-inbox" />
      <p>Aucune tâche dans cette vue.</p>
    </div>
    <ul v-else class="mt__list">
      <li
        v-for="task in store.items"
        :key="task.id"
        class="mt__row"
        :class="{ 'mt__row--selected': store.selectedIds.has(task.id) }"
      >
        <input
          type="checkbox"
          class="mt__checkbox"
          :checked="store.selectedIds.has(task.id)"
          @change="store.toggleSelect(task.id)"
        />
        <div class="mt__row-main">
          <div class="mt__row-top">
            <span class="mt__row-title">{{ task.title }}</span>
            <span class="mt__row-priority">{{ task.priority }}</span>
          </div>
          <div class="mt__row-meta">
            <span><i class="pi pi-briefcase" /> {{ task.project.name }}</span>
            <span v-if="task.sprint"><i class="pi pi-forward" /> {{ task.sprint.name }}</span>
            <span v-if="task.dueDate"><i class="pi pi-clock" /> {{ formatDate(task.dueDate) }}</span>
          </div>
        </div>
        <StatusTransitionMenu
          :current-status="task.status"
          @select="(s: string) => onTransition(task.id, s)"
        />
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NeoSelect, NeoInputText, NeoButton, NeoMessage, useNeoToast } from '@neolibrary/components'
import { useMemberTasksStore } from '@/stores/memberTasksStore'
import { useMemberDashboardStore } from '@/stores/memberDashboardStore'
import StatusTransitionMenu from '@/components/team/StatusTransitionMenu.vue'

const route = useRoute()
const router = useRouter()
const toast = useNeoToast()
const store = useMemberTasksStore()
const dashStore = useMemberDashboardStore()

const TABS = [
  { value: 'todo'   as const, label: 'À faire',     icon: 'pi-list' },
  { value: 'review' as const, label: 'En revue',    icon: 'pi-flag' },
  { value: 'done'   as const, label: 'Terminées',   icon: 'pi-check-circle' },
  { value: 'all'    as const, label: 'Toutes',      icon: 'pi-th-large' },
]

const busy = ref(false)
const projectFilter = ref<string | null>(null)
const sprintFilter = ref<string | null>(null)
const qFilter = ref<string>('')

function readFromQuery(): void {
  const tab = (route.query.tab as string | undefined) ?? 'todo'
  const validTab = ['todo', 'review', 'done', 'all'].includes(tab) ? tab : 'todo'
  store.setFilter('tab', validTab as 'todo' | 'review' | 'done' | 'all')
  const projectId = (route.query.projectId as string | undefined) ?? undefined
  const sprintId = (route.query.sprintId as string | undefined) ?? undefined
  const q = (route.query.q as string | undefined) ?? undefined
  store.setFilter('projectId', projectId)
  store.setFilter('sprintId', sprintId)
  store.setFilter('q', q)
  projectFilter.value = projectId ?? null
  sprintFilter.value = sprintId ?? null
  qFilter.value = q ?? ''
}

function syncToQuery(): void {
  const query: Record<string, string> = { tab: store.filters.tab }
  if (store.filters.projectId) query.projectId = store.filters.projectId
  if (store.filters.sprintId)  query.sprintId  = store.filters.sprintId
  if (store.filters.q)         query.q         = store.filters.q
  void router.replace({ query })
}

watch(() => route.query, () => {
  readFromQuery()
  void store.fetchAll()
}, { deep: true })

function onTabChange(tab: 'todo' | 'review' | 'done' | 'all'): void {
  store.setFilter('tab', tab)
  syncToQuery()
  void store.fetchAll()
}
function onProjectChange(value: unknown): void {
  const v = typeof value === 'string' && value.length > 0 ? value : undefined
  store.setFilter('projectId', v)
  syncToQuery()
  void store.fetchAll()
}
function onSprintChange(value: unknown): void {
  const v = typeof value === 'string' && value.length > 0 ? value : undefined
  store.setFilter('sprintId', v)
  syncToQuery()
  void store.fetchAll()
}
function onSearchEnter(): void {
  store.setFilter('q', qFilter.value.trim() || undefined)
  syncToQuery()
  void store.fetchAll()
}

async function onTransition(id: string, newStatus: string): Promise<void> {
  const ok = await store.transitionOne(id, newStatus)
  if (!ok) toast.add({ severity: 'error', detail: 'Mise à jour échouée.', life: 3000 })
}

async function onBulk(status: string): Promise<void> {
  busy.value = true
  try {
    const { updated, failed } = await store.bulkTransition(status)
    if (updated > 0) {
      toast.add({
        severity: 'success',
        detail: `${updated} tâche(s) mise(s) à jour${failed ? ` (${failed} échec[s])` : ''}.`,
        life: 3000,
      })
    } else if (failed > 0) {
      toast.add({ severity: 'error', detail: `${failed} mise(s) à jour échouée(s).`, life: 4000 })
    }
  } finally {
    busy.value = false
  }
}

const projectOptions = computed(() =>
  dashStore.myProjects.map((p) => ({ label: p.name, value: p.id })),
)
const sprintOptions = computed(() =>
  dashStore.activeSprints.map((s) => ({ label: `${s.projectName} — ${s.sprint.name}`, value: s.sprint.id })),
)

const subtitle = computed<string>(() => {
  const n = store.items.length
  if (n === 0) return 'Aucune tâche dans cette vue.'
  if (n === 1) return '1 tâche affichée.'
  return `${n} tâches affichées.`
})

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) }
  catch { return iso }
}

onMounted(async () => {
  store.reset()
  if (dashStore.myProjects.length === 0) void dashStore.fetchAll()
  readFromQuery()
  await store.fetchAll()
})
</script>

<style scoped>
.mt { padding: 1.75rem; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }

.mt__head { margin-bottom: 0.25rem; }
.mt__title { margin: 0 0 0.25rem 0; font-size: 1.5rem; color: var(--nl-text-1); }
.mt__subtitle { margin: 0; color: var(--nl-text-3); font-size: 0.8125rem; }

.mt__tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--nl-border); }
.mt__tab {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.6rem 1rem;
  border: none; border-bottom: 2px solid transparent;
  background: transparent;
  font-size: 0.875rem; font-weight: 500;
  color: var(--nl-text-3);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.mt__tab:hover { color: var(--nl-text-1); }
.mt__tab--active { color: var(--nl-accent); border-bottom-color: var(--nl-accent); }

.mt__filters {
  display: flex; gap: 0.75rem; align-items: center;
  background: var(--nl-card-bg, #fff);
  padding: 0.85rem 1rem;
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  flex-wrap: wrap;
}
.mt__select { min-width: 220px; }
.mt__search { min-width: 240px; flex: 1; }

.mt__bulk {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--nl-accent-light, #ecfdf5);
  border: 1px solid var(--nl-accent);
  border-radius: 8px;
  padding: 0.6rem 1rem;
  gap: 1rem;
}
.mt__bulk-count { font-weight: 600; color: var(--nl-text-1); font-size: 0.875rem; }
.mt__bulk-actions { display: flex; gap: 0.5rem; }
.mt-fade-enter-active, .mt-fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.mt-fade-enter-from, .mt-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.mt__loading,
.mt__empty {
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 0.5rem;
  padding: 3rem 2rem;
  color: var(--nl-text-3);
  text-align: center;
  background: var(--nl-card-bg, #fff);
  border: 1px dashed var(--nl-border);
  border-radius: 8px;
}
.mt__empty i { font-size: 1.75rem; }

.mt__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.mt__row {
  display: flex; align-items: center; gap: 0.85rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  background: var(--nl-card-bg, #fff);
  transition: border-color 0.15s, background 0.15s;
}
.mt__row:hover { border-color: var(--nl-accent); }
.mt__row--selected { background: var(--nl-accent-light, #ecfdf5); border-color: var(--nl-accent); }
.mt__checkbox { width: 18px; height: 18px; cursor: pointer; }
.mt__row-main { flex: 1; min-width: 0; }
.mt__row-top { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
.mt__row-title {
  font-size: 0.9375rem; font-weight: 600; color: var(--nl-text-1);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mt__row-priority {
  font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em;
  padding: 0.1rem 0.4rem; border-radius: 999px;
  background: var(--nl-surface-2, #f3f4f6);
  color: var(--nl-text-2);
}
.mt__row-meta { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.75rem; color: var(--nl-text-3); }
.mt__row-meta i { margin-right: 0.2rem; }
</style>
