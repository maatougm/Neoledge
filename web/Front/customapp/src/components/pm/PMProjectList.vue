<template>
  <div class="pm-list">
    <!-- Header -->
    <div class="list-header">
      <div>
        <h1 class="list-title">Mes projets</h1>
        <p class="list-sub">{{ store.projects.length }} projet{{ store.projects.length !== 1 ? 's' : '' }} assigné{{ store.projects.length !== 1 ? 's' : '' }}</p>
      </div>
      <div class="header-filters">
        <button
          v-for="f in STATUS_FILTERS"
          :key="f.value"
          :class="['filter-chip', { 'filter-chip--active': activeFilter === f.value }]"
          @click="activeFilter = f.value"
        >
          {{ f.label }}
          <span class="filter-chip__count">{{ f.count }}</span>
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="loading-state">
      <i class="pi pi-spin pi-spinner" />
      <span>Chargement des projets…</span>
    </div>

    <!-- Empty -->
    <div v-else-if="filtered.length === 0" class="empty-state">
      <div class="empty-icon-wrap"><i class="pi pi-folder-open" /></div>
      <p class="empty-title">Aucun projet</p>
      <p class="empty-sub">{{ activeFilter === 'all' ? 'Aucun projet ne vous est assigné.' : 'Aucun projet dans ce statut.' }}</p>
    </div>

    <!-- Project cards -->
    <div v-else class="project-grid">
      <div
        v-for="p in filtered"
        :key="p.id"
        class="project-card"
        :class="cardUrgencyClass(p)"
        @click="emit('select', p.id)"
      >
        <!-- Left accent bar (urgency/status color) -->
        <div class="card-accent" :style="{ background: statusColor(p.status) }" />

        <div class="card-body">
          <!-- Top row: name + status -->
          <div class="card-top">
            <h3 class="card-name">{{ p.name }}</h3>
            <NeoTag
              :value="PROJECT_STATUS_LABELS[p.status]"
              :severity="statusSeverity(p.status)"
            />
          </div>

          <!-- Client + PM -->
          <div class="card-meta-row">
            <span class="card-meta"><i class="pi pi-building" /> {{ p.clientName }}</span>
            <span v-if="p.projectManagerName" class="card-meta"><i class="pi pi-user" /> {{ p.projectManagerName }}</span>
          </div>

          <!-- Phase pipeline stepper -->
          <div class="phase-track" :aria-label="`Phase: ${PROJECT_STATUS_LABELS[p.status]}`">
            <div class="phase-dots-row">
              <template v-for="(phase, idx) in PIPELINE_PHASES" :key="phase">
                <div
                  class="phase-dot"
                  :class="{
                    'phase-dot--done':    phaseIndex(p.status) > idx,
                    'phase-dot--active':  phaseIndex(p.status) === idx,
                    'phase-dot--pending': phaseIndex(p.status) < idx,
                  }"
                />
                <div
                  v-if="idx < PIPELINE_PHASES.length - 1"
                  class="phase-line"
                  :class="{ 'phase-line--done': phaseIndex(p.status) > idx }"
                />
              </template>
            </div>
            <div class="phase-labels">
              <span
                v-for="(phase, idx) in PIPELINE_PHASES"
                :key="phase"
                class="phase-label"
                :class="{ 'phase-label--active': phaseIndex(p.status) === idx }"
              >{{ PHASE_SHORT_LABELS[phase] }}</span>
            </div>
          </div>

          <!-- Footer: dates + urgency -->
          <div class="card-footer">
            <div class="card-dates">
              <span v-if="p.startDate"><i class="pi pi-calendar" /> {{ formatDate(p.startDate) }}</span>
              <span class="arrow">→</span>
              <span v-if="p.endDate">{{ formatDate(p.endDate) }}</span>
            </div>
            <span v-if="p.endDate" class="urgency-badge" :class="urgencyClass(p.endDate, p.status)">
              {{ urgencyLabel(p.endDate, p.status) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NeoTag } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus, ProjectSummary } from '@/types/project.types'

const emit = defineEmits<{ select: [id: string] }>()
const store = usePmStore()

// ─── Phase pipeline ────────────────────────────────────────────────────────────

const PIPELINE_PHASES: ProjectStatus[] = [
  'Draft', 'InProgress', 'SpecificationValidation', 'Realization', 'DeploymentValidation', 'Completed',
]

const PHASE_SHORT_LABELS: Record<ProjectStatus, string> = {
  Draft:                   'Brouillon',
  InProgress:              'En cours',
  SpecificationValidation: 'Spéc.',
  Realization:             'Réalisation',
  DeploymentValidation:    'Déploiement',
  Completed:               'Terminé',
  Archived:                'Archivé',
}

const STATUS_COLORS: Record<ProjectStatus, string> = {
  Draft:                   'var(--nl-border-strong)',
  InProgress:              '#3b82f6',
  SpecificationValidation: '#f59e0b',
  Realization:             '#6366f1',
  DeploymentValidation:    '#f59e0b',
  Completed:               '#10b981',
  Archived:                'var(--nl-border-strong)',
}

function phaseIndex(status: ProjectStatus): number {
  const idx = PIPELINE_PHASES.indexOf(status)
  return idx === -1 ? 0 : idx
}

function statusColor(status: ProjectStatus): string {
  return STATUS_COLORS[status] ?? 'var(--nl-border-strong)'
}

// ─── Filters ───────────────────────────────────────────────────────────────────

type FilterValue = 'all' | 'active' | 'pending' | 'completed'
const activeFilter = ref<FilterValue>('all')

const activeCount    = computed(() => store.projects.filter(p => p.status !== 'Completed' && p.status !== 'Archived').length)
const pendingCount   = computed(() => store.projects.filter(p => p.status === 'SpecificationValidation' || p.status === 'DeploymentValidation').length)
const completedCount = computed(() => store.projects.filter(p => p.status === 'Completed').length)

const STATUS_FILTERS = computed<{ value: FilterValue; label: string; count: number }[]>(() => [
  { value: 'all',       label: 'Tous',         count: store.projects.length },
  { value: 'active',    label: 'Actifs',        count: activeCount.value    },
  { value: 'pending',   label: 'En validation', count: pendingCount.value   },
  { value: 'completed', label: 'Terminés',      count: completedCount.value },
])

const filtered = computed<ProjectSummary[]>(() => {
  if (activeFilter.value === 'all')       return store.projects
  if (activeFilter.value === 'active')    return store.projects.filter(p => p.status !== 'Completed' && p.status !== 'Archived')
  if (activeFilter.value === 'pending')   return store.projects.filter(p => p.status === 'SpecificationValidation' || p.status === 'DeploymentValidation')
  if (activeFilter.value === 'completed') return store.projects.filter(p => p.status === 'Completed')
  return store.projects
})

// ─── Urgency ───────────────────────────────────────────────────────────────────

function urgencyClass(iso: string, status: ProjectStatus): string {
  if (status === 'Completed' || status === 'Archived') return 'urgency--done'
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0)                return 'urgency--overdue'
  if (ms < 7 * 86_400_000)  return 'urgency--critical'
  if (ms < 14 * 86_400_000) return 'urgency--warn'
  return 'urgency--ok'
}

function urgencyLabel(iso: string, status: ProjectStatus): string {
  if (status === 'Completed') return 'Terminé'
  if (status === 'Archived')  return 'Archivé'
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0) return 'En retard'
  const days = Math.ceil(ms / 86_400_000)
  return `${days} j restants`
}

function cardUrgencyClass(p: ProjectSummary): string {
  if (!p.endDate || p.status === 'Completed' || p.status === 'Archived') return ''
  const ms = new Date(p.endDate).getTime() - Date.now()
  if (ms < 0)               return 'project-card--overdue'
  if (ms < 7 * 86_400_000) return 'project-card--critical'
  return ''
}

const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—'
</script>

<style scoped>
/* ── Container ───────────────────────────────────────────────────────────────── */
.pm-list {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* ── Header ──────────────────────────────────────────────────────────────────── */
.list-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.list-title {
  font-size: 1.375rem;
  font-weight: 800;
  color: var(--nl-text-1);
  letter-spacing: -0.3px;
  margin: 0;
}

.list-sub {
  font-size: 0.8125rem;
  color: var(--nl-text-3);
  margin: 0.2rem 0 0;
}

/* ── Filter chips ─────────────────────────────────────────────────────────────── */
.header-filters {
  display: flex;
  gap: 0.375rem;
  flex-wrap: wrap;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.3rem 0.75rem;
  border-radius: 20px;
  border: 1px solid var(--nl-border);
  background: var(--nl-surface);
  color: var(--nl-text-2);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: var(--nl-font);
}

.filter-chip:hover {
  border-color: var(--nl-accent);
  color: var(--nl-accent);
}

.filter-chip--active {
  background: var(--nl-accent);
  border-color: var(--nl-accent);
  color: #fff;
}

.filter-chip__count {
  background: rgba(255,255,255,0.25);
  border-radius: 10px;
  padding: 0 0.35rem;
  font-size: 0.65rem;
  font-weight: 700;
}

.filter-chip:not(.filter-chip--active) .filter-chip__count {
  background: var(--nl-border);
  color: var(--nl-text-3);
}

/* ── States ──────────────────────────────────────────────────────────────────── */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem;
  color: var(--nl-text-3);
  font-size: 0.875rem;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  text-align: center;
}

.empty-icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--nl-surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: var(--nl-text-3);
  margin-bottom: 0.5rem;
}

.empty-title { font-size: 1rem; font-weight: 600; color: var(--nl-text-1); margin: 0; }
.empty-sub   { font-size: 0.8125rem; color: var(--nl-text-3); margin: 0; }

/* ── Grid ─────────────────────────────────────────────────────────────────────── */
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}

/* ── Card ─────────────────────────────────────────────────────────────────────── */
.project-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 12px;
  display: flex;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.18s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.project-card:hover {
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.1);
  transform: translateY(-2px);
  border-color: var(--nl-accent);
}

.project-card--overdue {
  border-left-color: var(--nl-danger);
}

.project-card--critical {
  border-left-color: var(--nl-warning);
}

/* ── Left accent bar ─────────────────────────────────────────────────────────── */
.card-accent {
  width: 4px;
  flex-shrink: 0;
}

/* ── Card body ───────────────────────────────────────────────────────────────── */
.card-body {
  flex: 1;
  padding: 1rem 1.125rem;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  min-width: 0;
}

.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.625rem;
}

.card-name {
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.card-meta-row {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--nl-text-3);
}

.card-meta .pi {
  font-size: 0.7rem;
}

/* ── Phase pipeline ──────────────────────────────────────────────────────────── */
.phase-track {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.375rem 0 0.125rem;
}

.phase-dots-row {
  display: flex;
  align-items: center;
}

.phase-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.2s;
}

.phase-dot--done    { background: var(--nl-accent); }
.phase-dot--active  { background: var(--nl-accent); box-shadow: 0 0 0 3px rgba(13,148,136,0.2); width: 12px; height: 12px; }
.phase-dot--pending { background: var(--nl-border-strong); }

.phase-line {
  flex: 1;
  height: 2px;
  background: var(--nl-border-strong);
  transition: background 0.2s;
}

.phase-line--done { background: var(--nl-accent); }

.phase-labels {
  display: flex;
  justify-content: space-between;
}

.phase-label {
  font-size: 0.55rem;
  color: var(--nl-text-3);
  text-align: center;
  width: 10px;
  transform: translateX(-50%);
  white-space: nowrap;
}

.phase-label--active {
  color: var(--nl-accent);
  font-weight: 600;
}

/* ── Footer ───────────────────────────────────────────────────────────────────── */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.25rem;
  padding-top: 0.625rem;
  border-top: 1px solid var(--nl-border);
}

.card-dates {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.725rem;
  color: var(--nl-text-3);
}

.card-dates .pi { font-size: 0.65rem; }
.arrow { opacity: 0.4; }

/* ── Urgency badges ──────────────────────────────────────────────────────────── */
.urgency-badge {
  padding: 0.2rem 0.5rem;
  border-radius: 10px;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.urgency--overdue  { background: #FEE2E2; color: #DC2626; }
.urgency--critical { background: #FEF3C7; color: #B45309; }
.urgency--warn     { background: #FEF9C3; color: #92400E; }
.urgency--ok       { background: #DCFCE7; color: #15803D; }
.urgency--done     { background: var(--nl-border); color: var(--nl-text-3); }

:global(.dark) .urgency--overdue  { background: rgba(220,38,38,0.2);  color: #fb7185; }
:global(.dark) .urgency--critical { background: rgba(217,119,6,0.2);  color: #fcd34d; }
:global(.dark) .urgency--warn     { background: rgba(234,179,8,0.2);  color: #fef08a; }
:global(.dark) .urgency--ok       { background: rgba(5,150,105,0.2);  color: #34d399; }

@media (max-width: 640px) {
  .project-grid { grid-template-columns: 1fr; }
  .list-header  { flex-direction: column; }
}
</style>
