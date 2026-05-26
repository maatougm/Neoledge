<!--
  @file     ProjectDetailPanel.vue
  @desc     Admin executive summary for a single project. Pulled inline
            into the projects list so an admin can audit one project
            without losing the table context. NOT a project-management
            UI — for that, use the "Ouvrir en détail" button which
            routes to the PM full-modules view.
-->
<template>
  <div class="adm-panel">
    <!-- ── Header bar ──────────────────────────────────────────────────────── -->
    <div class="panel-header">
      <button class="back-btn" @click="emit('close')">
        <i class="pi pi-arrow-left" /> Retour à la liste
      </button>
      <div class="header-spacer" />
      <RouterLink
        v-if="project"
        :to="`/app/pm/projects/${project.id}`"
        class="open-deep-btn"
      >
        Ouvrir en détail <i class="pi pi-external-link" />
      </RouterLink>
    </div>

    <div v-if="loading && !project" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: var(--nl-accent)" />
    </div>

    <template v-else-if="project">
      <!-- ── Identity card ───────────────────────────────────────────────────── -->
      <div class="identity-card">
        <div class="identity-main">
          <h2 class="identity-name">{{ project.name }}</h2>
          <p class="identity-meta">
            <span>{{ project.clientName }}</span>
            <span class="dot">·</span>
            <span>
              CP : {{ project.projectManager
                ? `${project.projectManager.firstName} ${project.projectManager.lastName}`
                : '— non assigné —' }}
            </span>
          </p>
        </div>
        <NeoTag
          :value="PROJECT_STATUS_LABELS[project.status] ?? project.status"
          :severity="statusSeverity(project.status)"
          class="identity-status"
        />
      </div>

      <!-- ── Health KPI tiles ────────────────────────────────────────────────── -->
      <div class="kpi-row">
        <div class="kpi-tile">
          <span class="kpi-label">Avancement</span>
          <span class="kpi-value">{{ projectProgress }}%</span>
          <div class="kpi-bar">
            <div class="kpi-bar-fill" :class="progressBarClass" :style="{ width: `${projectProgress}%` }" />
          </div>
        </div>

        <div class="kpi-tile" :class="{ 'kpi-tile--warn': dueDays !== null && dueDays < 14 && dueDays >= 0, 'kpi-tile--danger': dueDays !== null && dueDays < 0 }">
          <span class="kpi-label">Échéance</span>
          <span class="kpi-value">
            <template v-if="dueDays === null">—</template>
            <template v-else-if="dueDays < 0">{{ Math.abs(dueDays) }} j de retard</template>
            <template v-else-if="dueDays === 0">aujourd'hui</template>
            <template v-else>dans {{ dueDays }} j</template>
          </span>
          <span class="kpi-sub">{{ project.endDate ? formatDate(project.endDate) : 'Non définie' }}</span>
        </div>

        <div class="kpi-tile" :class="{ 'kpi-tile--warn': membersCount === 0 }">
          <span class="kpi-label">Équipe</span>
          <span class="kpi-value">{{ membersCount + (project.projectManager ? 1 : 0) }}</span>
          <span class="kpi-sub">{{ project.projectManager ? '1 CP' : 'sans CP' }} · {{ membersCount }} membre(s)</span>
        </div>

        <div class="kpi-tile" :class="kpiTileClass(cahierStatus?.status)">
          <span class="kpi-label">Cahier</span>
          <span class="kpi-value">{{ cahierStatusLabel }}</span>
          <span class="kpi-sub">
            {{ cahierStatus?.cahierSavedAt ? `MAJ ${formatDate(cahierStatus.cahierSavedAt)}` : 'pas encore généré' }}
          </span>
        </div>
      </div>

      <!-- ── Team card ───────────────────────────────────────────────────────── -->
      <div class="team-card">
        <div class="team-header">
          <h3>Équipe</h3>
          <RouterLink :to="`/app/pm/projects/${project.id}/members`" class="team-link">
            Gérer <i class="pi pi-arrow-right" />
          </RouterLink>
        </div>
        <div class="team-list">
          <!-- PM is implicit -->
          <div v-if="project.projectManager" class="team-row team-row--pm">
            <span class="team-avatar team-avatar--pm">
              {{ initials(project.projectManager.firstName, project.projectManager.lastName) }}
            </span>
            <div class="team-info">
              <span class="team-name">{{ project.projectManager.firstName }} {{ project.projectManager.lastName }}</span>
              <span class="team-role">Chef de projet</span>
            </div>
            <span class="team-pill team-pill--pm">CP</span>
          </div>

          <div
            v-for="m in members"
            :key="m.id"
            class="team-row"
          >
            <span class="team-avatar">{{ initials(m.user.firstName, m.user.lastName) }}</span>
            <div class="team-info">
              <span class="team-name">{{ m.user.firstName }} {{ m.user.lastName }}</span>
              <span class="team-role">{{ m.label || roleLabel(m.user.role) }}</span>
            </div>
            <span class="team-pill" :class="rolePillClass(m.user.role)">{{ roleShort(m.user.role) }}</span>
          </div>

          <div v-if="members.length === 0 && !membersLoading" class="team-empty">
            Aucun membre supplémentaire — seul le CP a accès.
          </div>
        </div>
      </div>

      <!-- ── Tabs: Activity | Validations | Audit ─────────────────────────────── -->
      <div class="tabs-row">
        <button
          v-for="tab in panelTabs"
          :key="tab.id"
          :class="['tab-btn', { 'tab-btn--active': activeTab === tab.id }]"
          @click="switchTab(tab.id)"
        >
          <i :class="['pi', tab.icon]" />
          {{ tab.label }}
        </button>
      </div>

      <div v-if="activeTab === 'activity'" class="tab-pane">
        <ActivityFeed :activities="store.activities" />
      </div>

      <div v-if="activeTab === 'validations' && validationsLoaded" class="tab-pane">
        <ValidationTimeline :project-id="props.projectId" />
      </div>

      <div v-if="activeTab === 'audit'" class="tab-pane">
        <div v-if="auditLoading" class="loading-state">
          <i class="pi pi-spin pi-spinner" />
        </div>
        <div v-else-if="auditLog.length === 0" class="audit-empty">
          Aucune action enregistrée pour ce projet.
        </div>
        <ul v-else class="audit-list">
          <li
            v-for="a in auditLog"
            :key="a.id"
            class="audit-row"
          >
            <span class="audit-action" :class="auditActionClass(a.action)">{{ a.action }}</span>
            <div class="audit-body">
              <div class="audit-text">
                <strong>{{ a.user || 'Système' }}</strong>
                <span v-if="a.userRole" class="audit-role">({{ a.userRole }})</span>
              </div>
              <div class="audit-meta">{{ formatDateTime(a.createdAt) }}</div>
            </div>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { NeoTag } from '@neolibrary/components'
import { useProjectStore, computeProgress } from '@/stores/projectStore'
import ActivityFeed from '@/components/pm/ActivityFeed.vue'
import ValidationTimeline from '@/components/pm/ValidationTimeline.vue'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'
import api from '@/lib/api'

const props = defineProps<{ projectId: string }>()
const emit  = defineEmits<{ close: [] }>()

const store   = useProjectStore()

const project = ref(store.currentProject?.id === props.projectId ? store.currentProject : null)
const loading = ref(false)

const projectProgress = computed(() => project.value ? computeProgress(project.value) : 0)
const progressBarClass = computed(() => {
  const pct = projectProgress.value
  if (pct >= 80) return 'kpi-bar-fill--green'
  if (pct >= 50) return 'kpi-bar-fill--orange'
  return 'kpi-bar-fill--red'
})
const dueDays = computed<number | null>(() => {
  if (!project.value?.endDate) return null
  const ms = new Date(project.value.endDate).getTime() - Date.now()
  return Math.ceil(ms / 86_400_000)
})

const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

// ── Tabs ─────────────────────────────────────────────────────────────────────
type PanelTabId = 'activity' | 'validations' | 'audit'
const activeTab = ref<PanelTabId>('activity')
const validationsLoaded = ref(false)
const panelTabs: { id: PanelTabId; label: string; icon: string }[] = [
  { id: 'activity',    label: 'Activité',                icon: 'pi-history' },
  { id: 'validations', label: 'Historique validations',  icon: 'pi-clock' },
  { id: 'audit',       label: 'Journal d\'audit',        icon: 'pi-shield' },
]

function switchTab(tab: PanelTabId) {
  activeTab.value = tab
  if (tab === 'activity') store.fetchActivity(props.projectId)
  if (tab === 'validations') validationsLoaded.value = true
  if (tab === 'audit' && auditLog.value.length === 0) void loadAudit()
}

// ── Members ──────────────────────────────────────────────────────────────────
interface Member {
  id: string
  userId: string
  label: string
  user: {
    id: string
    firstName: string
    lastName: string
    email: string
    role: string
  }
}
const members = ref<Member[]>([])
const membersLoading = ref(false)
const membersCount = computed(() => members.value.length)

async function loadMembers(): Promise<void> {
  membersLoading.value = true
  try {
    const { data } = await api.get<{ members: Member[] } | Member[]>(`/pm/projects/${props.projectId}/members`)
    members.value = Array.isArray(data) ? data : (data.members ?? [])
  } catch {
    members.value = []
  } finally {
    membersLoading.value = false
  }
}

// ── Cahier status ────────────────────────────────────────────────────────────
interface CahierStatus {
  cahierSavedAt: string | null
  status: 'none' | 'pending' | 'approved' | 'rejected'
}
const cahierStatus = ref<CahierStatus | null>(null)

const cahierStatusLabel = computed(() => {
  if (!cahierStatus.value) return '—'
  switch (cahierStatus.value.status) {
    case 'none':     return 'Non généré'
    case 'pending':  return 'En attente'
    case 'approved': return 'Approuvé'
    case 'rejected': return 'Rejeté'
  }
})

function kpiTileClass(s?: string): string {
  if (s === 'rejected') return 'kpi-tile--danger'
  if (s === 'approved') return 'kpi-tile--ok'
  if (s === 'pending')  return 'kpi-tile--warn'
  return 'kpi-tile--neutral'
}

async function loadCahierStatus(): Promise<void> {
  try {
    const { data } = await api.get<CahierStatus>(`/pm/projects/${props.projectId}/cahier-des-charges/status`)
    cahierStatus.value = data
  } catch {
    cahierStatus.value = { cahierSavedAt: null, status: 'none' }
  }
}

// ── Audit log ────────────────────────────────────────────────────────────────
interface AuditLogEntry {
  id: string
  action: string
  user: string | null
  userRole: string | null
  createdAt: string
}
const auditLog = ref<AuditLogEntry[]>([])
const auditLoading = ref(false)

async function loadAudit(): Promise<void> {
  auditLoading.value = true
  try {
    const { data } = await api.get<AuditLogEntry[]>(`/admin/audit/Project/${props.projectId}`)
    auditLog.value = Array.isArray(data) ? data : []
  } catch {
    auditLog.value = []
  } finally {
    auditLoading.value = false
  }
}

function auditActionClass(action: string): string {
  const a = (action || '').toUpperCase()
  if (a.includes('DELETE'))  return 'audit-action--danger'
  if (a.includes('CREATE'))  return 'audit-action--ok'
  if (a.includes('UPDATE') || a.includes('STATUS_CHANGE')) return 'audit-action--info'
  return ''
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function initials(first: string, last: string): string {
  return ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?'
}
function roleLabel(role: string): string {
  switch (role) {
    case 'ProjectManager':    return 'Chef de projet'
    case 'SpecificationTeam': return 'Équipe spécification'
    case 'Member':            return 'Équipe'
    case 'Admin':             return 'Administrateur'
    default:                  return role
  }
}
function roleShort(role: string): string {
  switch (role) {
    case 'ProjectManager':    return 'CP'
    case 'SpecificationTeam': return 'Spec'
    case 'Member':            return 'Mbr'
    case 'Admin':             return 'Admin'
    default:                  return '?'
  }
}
function rolePillClass(role: string): string {
  switch (role) {
    case 'ProjectManager':    return 'team-pill--pm'
    case 'SpecificationTeam': return 'team-pill--spec'
    case 'Member':            return 'team-pill--member'
    case 'Admin':             return 'team-pill--admin'
    default:                  return ''
  }
}
const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const formatDateTime = (iso: string) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

// ── Bootstrap ────────────────────────────────────────────────────────────────
const load = async () => {
  loading.value = true
  await store.fetchById(props.projectId)
  project.value = store.currentProject
  await Promise.allSettled([
    store.fetchActivity(props.projectId),
    loadMembers(),
    loadCahierStatus(),
  ])
  loading.value = false
}

onMounted(load)
watch(() => store.currentProject, (v) => { project.value = v })
watch(() => props.projectId, () => { void load() })
</script>

<style scoped>
.adm-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.panel-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.header-spacer { flex: 1; }
.back-btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  background: none; border: none;
  color: var(--nl-text-3); font-size: 0.875rem;
  cursor: pointer; padding: 0.3rem 0;
  transition: color 0.15s;
}
.back-btn:hover { color: var(--nl-accent); }
.open-deep-btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  background: var(--nl-accent); color: var(--nl-on-accent);
  font-size: 0.8125rem; font-weight: 600;
  padding: 0.5rem 0.875rem; border-radius: 8px;
  text-decoration: none;
  transition: background 0.15s;
}
.open-deep-btn:hover { background: var(--nl-accent-strong, #0d4f5e); }

.loading-state {
  display: flex; align-items: center; justify-content: center; padding: 3rem;
}

/* ── Identity card ─────────────────────────────────────────────────────── */
.identity-card {
  display: flex; align-items: center; gap: 1rem;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 12px;
  padding: 1rem 1.25rem;
}
.identity-main { flex: 1; min-width: 0; }
.identity-name { margin: 0; font-size: 1.125rem; font-weight: 700; color: var(--nl-text-1); }
.identity-meta {
  margin: 0.25rem 0 0; font-size: 0.8125rem; color: var(--nl-text-3);
  display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
}
.dot { color: var(--nl-text-3); }
.identity-status { flex-shrink: 0; }

/* ── KPI tiles ──────────────────────────────────────────────────────────── */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
}
.kpi-tile {
  display: flex; flex-direction: column; gap: 0.25rem;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 10px;
  padding: 0.875rem 1rem;
}
.kpi-tile--warn   { border-color: #fde68a; background: #fffbeb; }
.kpi-tile--danger { border-color: #fecaca; background: #fef2f2; }
.kpi-tile--ok     { border-color: #a7f3d0; background: #ecfdf5; }
.kpi-tile--neutral { background: var(--nl-surface-2); }
.kpi-label { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--nl-text-3); }
.kpi-value { font-size: 1.25rem; font-weight: 800; color: var(--nl-text-1); line-height: 1.2; }
.kpi-sub   { font-size: 0.75rem; color: var(--nl-text-3); }
.kpi-bar {
  margin-top: 0.4rem;
  height: 6px; background: var(--nl-border); border-radius: 999px; overflow: hidden;
}
.kpi-bar-fill { height: 100%; transition: width 0.4s ease; border-radius: inherit; }
.kpi-bar-fill--red    { background: #ef4444; }
.kpi-bar-fill--orange { background: #f59e0b; }
.kpi-bar-fill--green  { background: #10b981; }

/* ── Team card ─────────────────────────────────────────────────────────── */
.team-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 12px;
  padding: 1rem 1.25rem;
}
.team-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 0.75rem;
}
.team-header h3 { margin: 0; font-size: 0.9375rem; font-weight: 700; color: var(--nl-text-1); }
.team-link {
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-size: 0.8125rem; color: var(--nl-accent); font-weight: 600;
  text-decoration: none;
}
.team-link:hover { text-decoration: underline; }

.team-list { display: flex; flex-direction: column; }
.team-row {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  gap: 0.75rem; align-items: center;
  padding: 0.5rem 0; border-bottom: 1px solid var(--nl-border);
}
.team-row:last-child { border-bottom: none; }
.team-row--pm .team-avatar { background: var(--nl-accent); color: var(--nl-on-accent); }

.team-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--nl-surface-2); color: var(--nl-text-2);
  font-size: 0.75rem; font-weight: 700;
}
.team-info { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.team-name { font-size: 0.875rem; font-weight: 600; color: var(--nl-text-1); }
.team-role { font-size: 0.75rem; color: var(--nl-text-3); }
.team-pill {
  font-size: 0.6875rem; font-weight: 700;
  padding: 0.2rem 0.55rem; border-radius: 999px;
  background: var(--nl-surface-2); color: var(--nl-text-3);
}
.team-pill--pm     { background: #dbeafe; color: #1d4ed8; }
.team-pill--spec   { background: #ede9fe; color: #6d28d9; }
.team-pill--member { background: #ecfdf5; color: #047857; }
.team-pill--admin  { background: #fef3c7; color: #b45309; }
.team-empty { padding: 0.75rem; text-align: center; color: var(--nl-text-3); font-size: 0.8125rem; }

/* ── Tabs ──────────────────────────────────────────────────────────────── */
.tabs-row {
  display: flex; gap: 0.25rem; border-bottom: 2px solid var(--nl-border);
}
.tab-btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  background: none; border: none; border-bottom: 2px solid transparent;
  margin-bottom: -2px; padding: 0.625rem 1rem;
  font-size: 0.875rem; font-weight: 600; color: var(--nl-text-3);
  cursor: pointer; border-radius: 4px 4px 0 0;
  transition: color 0.15s, border-color 0.15s;
}
.tab-btn:hover { color: var(--nl-text-1); }
.tab-btn--active { color: var(--nl-accent); border-bottom-color: var(--nl-accent); }

.tab-pane {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 12px;
  padding: 1rem 1.25rem;
}

/* ── Audit log ─────────────────────────────────────────────────────────── */
.audit-list { list-style: none; margin: 0; padding: 0; }
.audit-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.75rem;
  padding: 0.5rem 0; border-bottom: 1px solid var(--nl-border);
}
.audit-row:last-child { border-bottom: none; }
.audit-action {
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.05em;
  padding: 0.2rem 0.5rem; border-radius: 999px;
  background: var(--nl-surface-2); color: var(--nl-text-2);
  white-space: nowrap;
  align-self: start;
  margin-top: 2px;
}
.audit-action--ok     { background: #ecfdf5; color: #047857; }
.audit-action--info   { background: #eff6ff; color: #1d4ed8; }
.audit-action--danger { background: #fee2e2; color: #b91c1c; }

.audit-body { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.audit-text { font-size: 0.875rem; color: var(--nl-text-2); }
.audit-text strong { color: var(--nl-text-1); font-weight: 600; }
.audit-role { font-size: 0.75rem; color: var(--nl-text-3); margin-left: 0.25rem; }
.audit-meta { font-size: 0.75rem; color: var(--nl-text-3); }
.audit-empty { padding: 1rem; text-align: center; color: var(--nl-text-3); font-size: 0.875rem; }

/* ── Responsive ────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 540px) {
  .kpi-row { grid-template-columns: 1fr; }
  .identity-card { flex-direction: column; align-items: flex-start; }
}
</style>
