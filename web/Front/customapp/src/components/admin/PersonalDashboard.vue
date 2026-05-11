<!--
  @file     PersonalDashboard.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Personal dashboard — my projects stats, saved filters, recent activity, deadlines
-->
<template>
  <div class="pdash">
    <div class="pdash__heading">
      <h2 class="pdash__title">Mon tableau de bord</h2>
      <p class="pdash__sub">Bienvenue, {{ displayName }}</p>
    </div>

    <!-- My projects by status — mini stat cards -->
    <div v-if="myProjects.length > 0" class="pdash__section">
      <h3 class="pdash__section-title">Mes projets</h3>
      <div class="pdash__stats">
        <div
          v-for="stat in myStats"
          :key="stat.status"
          class="pdash__stat-card"
        >
          <span class="pdash__stat-count">{{ stat.count }}</span>
          <span class="pdash__stat-label">{{ PROJECT_STATUS_LABELS[stat.status] ?? stat.status }}</span>
          <NeoTag :value="stat.count.toString()" :severity="toTagSeverity(PROJECT_STATUS_SEVERITY[stat.status])" />
        </div>
      </div>
    </div>

    <div v-else-if="projectsLoaded" class="pdash__empty">
      <i class="pi pi-folder-open" />
      <p>Aucun projet assigné pour le moment.</p>
    </div>

    <!-- Upcoming deadlines (endDate < 14 days) -->
    <div v-if="upcomingDeadlines.length > 0" class="pdash__section">
      <h3 class="pdash__section-title">
        <i class="pi pi-clock pdash__icon-warn" />
        Échéances proches (14 jours)
      </h3>
      <ul class="pdash__deadline-list">
        <li
          v-for="p in upcomingDeadlines"
          :key="p.id"
          class="pdash__deadline-item"
        >
          <div class="pdash__deadline-info">
            <span class="pdash__deadline-name">{{ p.name }}</span>
            <span class="pdash__deadline-client">{{ p.clientName }}</span>
          </div>
          <NeoTag
            :value="formatDeadline(p.endDate)"
            :severity="isOverdue(p.endDate) ? 'danger' : 'warn'"
          />
        </li>
      </ul>
    </div>

    <!-- Saved filters quick-access -->
    <div class="pdash__section">
      <h3 class="pdash__section-title">Mes filtres</h3>
      <div v-if="filtersStore.loading" class="pdash__loading">
        <i class="pi pi-spin pi-spinner" />
      </div>
      <div v-else-if="filtersStore.filters.length === 0" class="pdash__empty-small">
        Aucun filtre sauvegardé.
      </div>
      <div v-else class="pdash__filter-buttons">
        <NeoButton
          v-for="filter in filtersStore.filters"
          :key="filter.id"
          :label="filter.name"
          :outlined="filtersStore.activeFilter?.id !== filter.id"
          size="small"
          @click="applyFilter(filter)"
        />
      </div>
    </div>

    <!-- Recent activity in my projects -->
    <div v-if="recentActivity.length > 0" class="pdash__section">
      <h3 class="pdash__section-title">Activité récente</h3>
      <ul class="pdash__activity-list">
        <li
          v-for="entry in recentActivity"
          :key="entry.id"
          class="pdash__activity-item"
        >
          <div class="pdash__activity-icon">
            <i class="pi pi-history" />
          </div>
          <div class="pdash__activity-body">
            <span class="pdash__activity-detail">{{ entry.detail ?? entry.action }}</span>
            <span v-if="entry.projectName" class="pdash__activity-project">{{ entry.projectName }}</span>
          </div>
          <span class="pdash__activity-time">{{ formatTime(entry.timestamp) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { NeoButton, NeoTag } from '@neolibrary/components'
import { useNeoToast } from '@neolibrary/components'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { useSavedFiltersStore } from '@/stores/savedFiltersStore'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_SEVERITY,
} from '@/types/project.types'
import type { ProjectSummary, ProjectActivity, ProjectStatus } from '@/types/project.types'
import type { SavedFilter } from '@/types/filter.types'

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  userId: string
}


type NeoTagSeverity = 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | 'primary'
const VALID_SEVERITIES = new Set<string>(['success', 'info', 'warn', 'danger', 'secondary', 'contrast', 'primary'])
function toTagSeverity(val: string | undefined): NeoTagSeverity {
  return (val !== undefined && VALID_SEVERITIES.has(val) ? val : 'secondary') as NeoTagSeverity
}

const props = defineProps<Props>()

const emit = defineEmits<{
  applyFilter: [filter: SavedFilter]
}>()

// ─── Store & Toast ────────────────────────────────────────────────────────────
const authStore = useAuthStore()
const filtersStore = useSavedFiltersStore()
const toast = useNeoToast()

// ─── State ────────────────────────────────────────────────────────────────────
const myProjects = ref<ProjectSummary[]>([])
const recentActivity = ref<ProjectActivity[]>([])
const projectsLoaded = ref(false)

// ─── Derived ──────────────────────────────────────────────────────────────────
const displayName = computed<string>(() => {
  if (!authStore.jwt) return 'Utilisateur'
  try {
    const p = JSON.parse(atob(authStore.jwt.split('.')[1]))
    return [p.given_name, p.family_name].filter(Boolean).join(' ') || 'Utilisateur'
  } catch {
    return 'Utilisateur'
  }
})

interface StatEntry { status: ProjectStatus; count: number }

const myStats = computed<StatEntry[]>(() => {
  const countMap = new Map<string, number>()
  for (const p of myProjects.value) {
    countMap.set(p.status, (countMap.get(p.status) ?? 0) + 1)
  }
  return Array.from(countMap.entries()).map(([status, count]) => ({
    status: status as ProjectStatus,
    count,
  }))
})

// Reactive "now" — refreshed every 60 s so deadline calculations stay current (#8)
const nowMs = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000

const upcomingDeadlines = computed<ProjectSummary[]>(() =>
  myProjects.value.filter((p) => {
    if (!p.endDate) return false
    const diff = new Date(p.endDate).getTime() - nowMs.value
    return diff <= FOURTEEN_DAYS_MS
  }),
)

// ─── Helpers ─────────────────────────────────────────────────────────────────
const formatDeadline = (dateStr: string): string => {
  const d = new Date(dateStr)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

const isOverdue = (dateStr: string): boolean => new Date(dateStr).getTime() < nowMs.value

const formatTime = (dateStr: string): string => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ─── Data fetch ───────────────────────────────────────────────────────────────
const fetchMyProjects = async (): Promise<void> => {
  try {
    const { data } = await api.get<ProjectSummary[]>(
      `/admin/project/manager/${props.userId}`,
    )
    myProjects.value = [...data]
  } catch {
    // Non-critical — silently ignore
  } finally {
    projectsLoaded.value = true
  }
}

const fetchRecentActivity = async (): Promise<void> => {
  try {
    const { data } = await api.get<ProjectActivity[]>(
      '/api/dashboard/recent-activity?count=5',
    )
    // Filter to activities related to my projects
    const myProjectIds = new Set(myProjects.value.map((p) => p.id))
    recentActivity.value = data
      .filter((a) => !a.projectId || myProjectIds.has(a.projectId))
      .slice(0, 5)
  } catch {
    recentActivity.value = []
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────
const applyFilter = (filter: SavedFilter): void => {
  filtersStore.applyFilter(filter)
  emit('applyFilter', filter)
  toast.add({ severity: 'info', detail: `Filtre "${filter.name}" appliqué.`, life: 2500 })
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(async () => {
  nowTimer = setInterval(() => { nowMs.value = Date.now() }, 60_000)
  await Promise.all([
    fetchMyProjects(),
    filtersStore.fetchAll(),
  ])
  await fetchRecentActivity()
})

onUnmounted(() => {
  if (nowTimer !== null) {
    clearInterval(nowTimer)
    nowTimer = null
  }
})
</script>

<style scoped>
.pdash {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 0.25rem 0;
}

.pdash__heading {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.pdash__title {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-color, #1e293b);
  margin: 0;
}

.pdash__sub {
  color: var(--text-color-secondary, #64748b);
  font-size: 0.85rem;
  margin: 0;
}

.pdash__section {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.pdash__section-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-color, #1e293b);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.pdash__icon-warn { color: #f59e0b; }

.pdash__stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: 0.65rem;
}

.pdash__stat-card {
  background: var(--surface-0, #fff);
  border: 1px solid var(--surface-200, #e2e8f0);
  border-radius: 0.6rem;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
}

.pdash__stat-count {
  font-size: 1.6rem;
  font-weight: 700;
  color: #0d9488;
  line-height: 1;
}

.pdash__stat-label {
  font-size: 0.72rem;
  color: var(--text-color-secondary, #64748b);
}

.pdash__empty,
.pdash__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  color: var(--text-color-secondary, #64748b);
  font-size: 0.85rem;
}

.pdash__empty-small {
  font-size: 0.82rem;
  color: var(--text-color-secondary, #64748b);
}

.pdash__filter-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.pdash__deadline-list,
.pdash__activity-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.pdash__deadline-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface-0, #fff);
  border: 1px solid var(--surface-200, #e2e8f0);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
}

.pdash__deadline-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.pdash__deadline-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-color, #1e293b);
}

.pdash__deadline-client {
  font-size: 0.72rem;
  color: var(--text-color-secondary, #64748b);
}

.pdash__activity-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  background: var(--surface-0, #fff);
  border: 1px solid var(--surface-200, #e2e8f0);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
}

.pdash__activity-icon {
  color: #0d9488;
  font-size: 0.85rem;
  margin-top: 0.1rem;
}

.pdash__activity-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.pdash__activity-detail {
  font-size: 0.82rem;
  color: var(--text-color, #1e293b);
}

.pdash__activity-project {
  font-size: 0.72rem;
  color: var(--text-color-secondary, #64748b);
}

.pdash__activity-time {
  font-size: 0.72rem;
  color: var(--text-color-secondary, #64748b);
  white-space: nowrap;
}
</style>
