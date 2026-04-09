<!--
  @file     ActivitySection.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Admin-level global activity feed with stats, filters, and pagination
-->
<template>
  <div class="activity">
    <!-- Header -->
    <div class="activity-heading">
      <div>
        <h1 class="activity-title">Activité récente</h1>
        <p class="activity-subtitle">Journal des actions sur tous les projets</p>
      </div>
      <NeoButton
        label="Rafraîchir"
        icon="pi pi-refresh"
        outlined
        :loading="loading"
        @click="refresh"
      />
    </div>

    <!-- Stats row -->
    <div class="stats-strip">
      <div class="stat-card">
        <span class="stat-num">{{ stats?.totalToday ?? '—' }}</span>
        <span class="stat-lbl">Aujourd'hui</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-card">
        <span class="stat-num">{{ stats?.totalThisWeek ?? '—' }}</span>
        <span class="stat-lbl">Cette semaine</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-card">
        <span class="stat-num stat-num--accent">
          {{ stats?.mostActiveProject?.name ?? '—' }}
        </span>
        <span class="stat-lbl">Projet le plus actif</span>
        <span v-if="stats?.mostActiveProject" class="stat-badge">
          {{ stats.mostActiveProject.count }} actions
        </span>
      </div>
    </div>

    <!-- Filters row -->
    <div class="filters-row">
      <NeoSelect
        v-model="filterAction"
        :options="actionOptions"
        option-label="label"
        option-value="value"
        placeholder="Filtrer par action"
        class="filter-select"
      />
      <NeoSelect
        v-model="filterProject"
        :options="projectOptions"
        option-label="label"
        option-value="value"
        placeholder="Filtrer par projet"
        class="filter-select"
      />
      <NeoButton
        label="Réinitialiser"
        text
        :disabled="filterAction === null && filterProject === null"
        @click="resetFilters"
      />
    </div>

    <!-- Error state -->
    <div v-if="error" class="error-state">
      <i class="pi pi-exclamation-triangle error-icon" aria-hidden="true" />
      <span>{{ error }}</span>
    </div>

    <!-- Activity list -->
    <div v-else-if="visibleItems.length === 0 && !loading" class="empty-state">
      <i class="pi pi-history empty-icon" aria-hidden="true" />
      <span>Aucune activité récente</span>
    </div>

    <div v-else class="timeline" role="list">
      <div
        v-for="item in visibleItems"
        :key="item.id"
        class="timeline-item"
        role="listitem"
      >
        <div class="dot-wrap">
          <div :class="['dot', dotClass(item.action)]" aria-hidden="true">
            <i :class="actionIcon(item.action)" />
          </div>
          <div class="timeline-line" />
        </div>
        <div class="item-body">
          <p class="item-text">
            <span class="item-user">{{ item.userName ?? 'Système' }}</span>
            {{ actionVerb(item.action) }}
            <span v-if="item.projectName" class="item-project">
              le projet {{ item.projectName }}
            </span>
          </p>
          <p v-if="item.detail" class="item-detail">{{ item.detail }}</p>
          <span class="item-time">{{ relativeTime(item.timestamp ?? item.createdAt ?? '') }}</span>
        </div>
      </div>
    </div>

    <!-- Load more -->
    <div v-if="filteredItems.length > visibleCount" class="load-more">
      <NeoButton
        label="Charger plus"
        outlined
        icon="pi pi-chevron-down"
        @click="loadMore"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { NeoButton, NeoSelect } from '@neolibrary/components'
import axios from 'axios'
import { useApp } from '@/stores/useApp'
import type { ProjectActivity, ActivityStats } from '@/types/project.types'

// ── Constants ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20
const REFRESH_INTERVAL_MS = 60_000

// ── State ──────────────────────────────────────────────────────────────────────

const app        = useApp()
const activities = ref<ProjectActivity[]>([])
const stats      = ref<ActivityStats | null>(null)
const loading    = ref(false)
const error      = ref<string | null>(null)
const visibleCount = ref(PAGE_SIZE)

const filterAction  = ref<string | null>(null)
const filterProject = ref<string | null>(null)

let intervalId: ReturnType<typeof setInterval> | null = null

// ── Lifecycle ──────────────────────────────────────────────────────────────────

onMounted(() => {
  void fetchAll()
  intervalId = setInterval(() => { void fetchAll() }, REFRESH_INTERVAL_MS)
})

onUnmounted(() => {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
})

// ── Data fetching ──────────────────────────────────────────────────────────────

async function fetchAll(): Promise<void> {
  loading.value = true
  error.value   = null
  try {
    const headers = { Authorization: `Bearer ${app.jwt}` }
    const [activityRes, statsRes] = await Promise.all([
      axios.get<ProjectActivity[]>(`${app.apiUrl}/api/dashboard/recent-activity?count=200`, { headers }),
      axios.get<ActivityStats>(`${app.apiUrl}/api/dashboard/activity-stats`, { headers }),
    ])
    activities.value = activityRes.data
    stats.value      = statsRes.data
  } catch {
    error.value = 'Impossible de charger les activités. Veuillez réessayer.'
  } finally {
    loading.value = false
  }
}

async function refresh(): Promise<void> {
  visibleCount.value = PAGE_SIZE
  await fetchAll()
}

// ── Filter options ─────────────────────────────────────────────────────────────

const actionOptions = computed(() => {
  const seen = new Set<string>()
  const options: { label: string; value: string }[] = []
  for (const a of activities.value) {
    if (!seen.has(a.action)) {
      seen.add(a.action)
      options.push({ label: actionLabel(a.action), value: a.action })
    }
  }
  return options
})

const projectOptions = computed(() => {
  const seen = new Set<string>()
  const options: { label: string; value: string }[] = []
  for (const a of activities.value) {
    if (a.projectId && a.projectName && !seen.has(a.projectId)) {
      seen.add(a.projectId)
      options.push({ label: a.projectName, value: a.projectId })
    }
  }
  return options
})

function resetFilters(): void {
  filterAction.value  = null
  filterProject.value = null
}

// ── Filtered + paginated list ──────────────────────────────────────────────────

const filteredItems = computed<ProjectActivity[]>(() => {
  return activities.value.filter((a) => {
    if (filterAction.value !== null && a.action !== filterAction.value) return false
    if (filterProject.value !== null && a.projectId !== filterProject.value) return false
    return true
  })
})

const visibleItems = computed<ProjectActivity[]>(() =>
  filteredItems.value.slice(0, visibleCount.value),
)

function loadMore(): void {
  visibleCount.value += PAGE_SIZE
}

// ── Action helpers ─────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  created:              'Création',
  updated:              'Mise à jour',
  status_changed:       'Changement de statut',
  deleted:              'Suppression',
  validation_submitted: 'Validation soumise',
  // Legacy action keys from PM feed
  ProjectCreated:        'Projet créé',
  StatusChanged:         'Statut modifié',
  ManagerAssigned:       'Chef de projet assigné',
  FieldUpdated:          'Champ mis à jour',
  ValidationSubmitted:   'Validation soumise',
}

const ACTION_VERBS: Record<string, string> = {
  created:              'a créé',
  updated:              'a mis à jour',
  status_changed:       'a modifié le statut de',
  deleted:              'a supprimé',
  validation_submitted: 'a soumis une validation pour',
  ProjectCreated:        'a créé',
  StatusChanged:         'a modifié le statut de',
  ManagerAssigned:       'a assigné un chef de projet à',
  FieldUpdated:          'a mis à jour un champ de',
  ValidationSubmitted:   'a soumis une validation pour',
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function actionVerb(action: string): string {
  return ACTION_VERBS[action] ?? action
}

function dotClass(action: string): string {
  const map: Record<string, string> = {
    created:              'dot--created',
    updated:              'dot--updated',
    status_changed:       'dot--status',
    deleted:              'dot--deleted',
    validation_submitted: 'dot--validation',
    ProjectCreated:        'dot--created',
    StatusChanged:         'dot--status',
    ManagerAssigned:       'dot--updated',
    FieldUpdated:          'dot--updated',
    ValidationSubmitted:   'dot--validation',
  }
  return map[action] ?? 'dot--default'
}

function actionIcon(action: string): string {
  const map: Record<string, string> = {
    created:              'pi pi-plus-circle',
    updated:              'pi pi-pencil',
    status_changed:       'pi pi-arrow-right',
    deleted:              'pi pi-trash',
    validation_submitted: 'pi pi-check-circle',
    ProjectCreated:        'pi pi-plus-circle',
    StatusChanged:         'pi pi-arrow-right',
    ManagerAssigned:       'pi pi-user',
    FieldUpdated:          'pi pi-pencil',
    ValidationSubmitted:   'pi pi-check-circle',
  }
  return map[action] ?? 'pi pi-info-circle'
}

// ── Relative time ──────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  if (!iso) return ''
  const diffMs   = Date.now() - new Date(iso).getTime()
  const diffSecs = Math.floor(diffMs / 1000)

  if (diffSecs < 60)  return 'il y a quelques secondes'

  const diffMins = Math.floor(diffSecs / 60)
  if (diffMins < 60) {
    const fmt = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
    return fmt.format(-diffMins, 'minute')
  }

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) {
    const fmt = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
    return fmt.format(-diffHours, 'hour')
  }

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) {
    const fmt = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
    return fmt.format(-diffDays, 'day')
  }

  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
</script>

<style scoped>
.activity {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  font-family: var(--nl-font);
}

/* Header */
.activity-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.activity-title {
  font-size: 1.375rem;
  font-weight: 800;
  color: var(--nl-text-1);
  letter-spacing: -0.3px;
}

.activity-subtitle {
  font-size: 0.8125rem;
  color: var(--nl-text-3);
  margin-top: 0.2rem;
}

/* Stats strip */
.stats-strip {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  display: flex;
  align-items: stretch;
  overflow: hidden;
}

.stat-card {
  flex: 1;
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.stat-divider {
  width: 1px;
  background: var(--nl-border);
  flex-shrink: 0;
  margin: 1rem 0;
}

.stat-num {
  font-size: 1.75rem;
  font-weight: 800;
  color: var(--nl-text-1);
  line-height: 1;
  letter-spacing: -0.5px;
}

.stat-num--accent {
  font-size: 1rem;
  font-weight: 700;
  color: var(--nl-accent);
}

.stat-lbl {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--nl-text-3);
}

.stat-badge {
  display: inline-flex;
  align-items: center;
  margin-top: 0.25rem;
  padding: 0.125rem 0.5rem;
  border-radius: 20px;
  font-size: 0.65rem;
  font-weight: 600;
  background: var(--nl-accent-light);
  color: var(--nl-accent);
  width: fit-content;
}

/* Filters */
.filters-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.filter-select {
  min-width: 200px;
}

/* Error / empty states */
.error-state,
.empty-state {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem;
  justify-content: center;
  font-size: 0.875rem;
  color: var(--nl-text-3);
  background: var(--nl-surface);
  border: 1px dashed var(--nl-border);
  border-radius: var(--nl-radius-lg);
}

.empty-icon {
  font-size: 1.5rem;
}

.error-icon {
  font-size: 1.5rem;
  color: var(--nl-danger);
}

/* Timeline */
.timeline {
  display: flex;
  flex-direction: column;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  padding: 1.25rem 1.5rem;
  gap: 0;
}

.timeline-item {
  display: flex;
  gap: 1rem;
  min-height: 52px;
}

.timeline-item:last-child .timeline-line {
  display: none;
}

.dot-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 28px;
}

.dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  flex-shrink: 0;
}

.dot--created    { background: #ecfdf5; color: #059669; }
.dot--updated    { background: #eff6ff; color: #3b82f6; }
.dot--status     { background: #fff7ed; color: #ea580c; }
.dot--deleted    { background: #fef2f2; color: #dc2626; }
.dot--validation { background: #f5f3ff; color: #7c3aed; }
.dot--default    { background: var(--nl-surface-2); color: var(--nl-text-3); }
:global(.dark) .dot--created    { background: rgba(5,150,105,0.18); color: #34d399; }
:global(.dark) .dot--updated    { background: rgba(59,130,246,0.18); color: #60a5fa; }
:global(.dark) .dot--status     { background: rgba(234,88,12,0.18);  color: #fb923c; }
:global(.dark) .dot--deleted    { background: rgba(220,38,38,0.18);  color: #fb7185; }
:global(.dark) .dot--validation { background: rgba(124,58,237,0.18); color: #a78bfa; }

.timeline-line {
  width: 2px;
  flex: 1;
  background: var(--nl-border);
  margin: 4px 0;
}

.item-body {
  flex: 1;
  min-width: 0;
  padding-bottom: 1rem;
}

.item-text {
  font-size: 0.875rem;
  color: var(--nl-text-2);
  line-height: 1.5;
  margin: 0;
}

.item-user {
  font-weight: 700;
  color: var(--nl-text-1);
}

.item-project {
  font-weight: 600;
  color: var(--nl-accent);
}

.item-detail {
  font-size: 0.8rem;
  color: var(--nl-text-3);
  margin: 0.15rem 0 0;
}

.item-time {
  font-size: 0.75rem;
  color: var(--nl-text-3);
  margin-top: 0.25rem;
  display: block;
}

/* Load more */
.load-more {
  display: flex;
  justify-content: center;
  padding-top: 0.5rem;
}

/* Responsive */
@media (max-width: 600px) {
  .stats-strip { flex-direction: column; }
  .stat-divider { width: 100%; height: 1px; margin: 0; }
  .filter-select { min-width: 0; width: 100%; }
}
</style>
