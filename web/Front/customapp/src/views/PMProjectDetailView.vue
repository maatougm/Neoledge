<!-- @file src/views/PMProjectDetailView.vue — Project Overview as a LIVE dashboard (not a tile launcher). -->
<template>
  <ProjectModuleShell :project-id="id" :title="projectName" :status="projectStatus" status-severity="info">
    <template #actions>
      <NeoButton label="Work Packages" icon="pi pi-list" outlined size="small" @click="go('workpackages')" />
      <NeoButton label="Board" icon="pi pi-th-large" outlined size="small" @click="go('board')" />
      <NeoButton label="Gantt" icon="pi pi-chart-bar" outlined size="small" @click="go('gantt')" />
      <NeoButton
        :icon="isPinned ? 'pi pi-thumbtack' : 'pi pi-bookmark'"
        outlined
        size="small"
        :title="isPinned ? 'Désépingler' : 'Épingler'"
        @click="uiStore.togglePinnedProject(id)"
      />
    </template>

    <div v-if="!loading" class="po">
      <!-- Progress banner -->
      <div class="po__progress">
        <div class="po__progress-head">
          <span class="po__progress-label">
            Progression globale
            <span class="po__progress-mode">{{ isManualProgress ? '(manuel)' : '(auto)' }}</span>
          </span>
          <span class="po__progress-controls">
            <span class="po__progress-value">{{ overallProgress }}%</span>
            <button
              v-if="canManage && !editingProgress"
              class="po__progress-edit"
              title="Définir la progression manuellement"
              @click="startEditProgress"
            >
              <i class="pi pi-pencil" /> Modifier
            </button>
          </span>
        </div>

        <!-- Edit mode: slider + number + save / auto / cancel -->
        <div v-if="editingProgress" class="po__progress-editor">
          <input
            v-model.number="progressDraft"
            type="range" min="0" max="100" step="1"
            class="po__progress-range"
          />
          <input
            v-model.number="progressDraft"
            type="number" min="0" max="100"
            class="po__progress-num"
          />
          <NeoButton label="Enregistrer" size="small" :loading="savingProgress" @click="saveProgress(progressDraft)" />
          <NeoButton label="Auto" size="small" outlined :disabled="savingProgress" title="Revenir au calcul automatique" @click="saveProgress(null)" />
          <NeoButton label="Annuler" size="small" severity="secondary" outlined :disabled="savingProgress" @click="cancelEditProgress" />
        </div>

        <div class="po__progress-bar">
          <div class="po__progress-fill" :style="{ width: `${overallProgress}%` }" />
        </div>
        <div class="po__progress-meta">
          <span v-if="isManualProgress">Progression définie manuellement · {{ wpClosed }} / {{ wpTotal }} WP clôturés</span>
          <span v-else>{{ wpClosed }} / {{ wpTotal }} work packages clôturés</span>
          <span v-if="daysToEnd !== null" :class="{ 'po__progress-danger': daysToEnd < 0 }">
            {{ daysToEndLabel }}
          </span>
        </div>
      </div>

      <!-- Stat row -->
      <div class="po__stats">
        <StatCard icon="pi-list"                 label="Work Packages"   :value="wpTotal" tone="normal" />
        <StatCard icon="pi-exclamation-triangle" label="En retard"       :value="wpOverdue" :tone="wpOverdue > 0 ? 'danger' : 'normal'" />
        <StatCard icon="pi-forward"              label="Sprint actif"    :value="activeSprintName || '—'" tone="normal" />
      </div>

      <!-- Grid -->
      <div class="po__grid">
        <!-- Col 1 — work-package status breakdown -->
        <div class="po__col">
          <div v-if="statusByCount.length > 0" class="nl-card">
            <div class="po__head">
              <h2 class="po__head-title"><i class="pi pi-chart-pie" /> Répartition par statut</h2>
            </div>
            <div class="po__status-bars">
              <div v-for="s in statusByCount" :key="s.status" class="po__status-bar">
                <span class="po__status-label">
                  <StatusChip :status="s.status" />
                </span>
                <div class="po__status-track">
                  <div class="po__status-fill" :style="{ width: `${(s.count / wpTotal) * 100}%` }" />
                </div>
                <span class="po__status-count">{{ s.count }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Col 2 — milestones + activity -->
        <div class="po__col">
          <div class="nl-card">
            <div class="po__head">
              <h2 class="po__head-title"><i class="pi pi-flag" /> Prochain jalon</h2>
              <RouterLink :to="`/app/pm/projects/${id}/gantt`" class="po__head-link">Gantt →</RouterLink>
            </div>
            <div v-if="!nextMilestone" class="nl-empty">
              <p>Aucun jalon à venir.</p>
            </div>
            <div v-else class="po__milestone">
              <div class="po__milestone-days">
                <span class="po__milestone-n">{{ daysToMilestone }}</span>
                <span class="po__milestone-u">jours</span>
              </div>
              <div class="po__milestone-body">
                <div class="po__milestone-title">{{ nextMilestone.title }}</div>
                <div class="po__milestone-date">
                  {{ new Date(nextMilestone.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }}
                </div>
              </div>
            </div>
          </div>

          <div class="nl-card">
            <div class="po__head">
              <h2 class="po__head-title"><i class="pi pi-history" /> Activité récente</h2>
            </div>
            <div v-if="activity.length === 0" class="nl-empty">
              <p>Aucune activité récente.</p>
            </div>
            <ul v-else class="po__activity-list">
              <li v-for="(a, i) in (Array.isArray(activity) ? activity : []).slice(0, 6)" :key="i" class="po__activity">
                <i class="pi po__activity-icon" :class="activityIcon(a.action)" />
                <div class="po__activity-body">
                  <div class="po__activity-text">
                    <strong>{{ a.userName || 'Quelqu\'un' }}</strong>
                    {{ activityLabel(a.action) }}
                    <span v-if="a.details">— {{ a.details }}</span>
                  </div>
                  <div class="po__activity-time">{{ formatRelative(a.timestamp) }}</div>
                </div>
              </li>
            </ul>
          </div>

          <div v-if="presenceList.length > 0" class="nl-card">
            <div class="po__head">
              <h2 class="po__head-title"><i class="pi pi-users" /> En ligne maintenant</h2>
            </div>
            <div class="po__presence">
              <div
                v-for="p in presenceList"
                :key="p.userId"
                class="po__avatar"
                :style="{ background: p.color }"
                :title="p.name"
              >
                {{ initials(p.name) }}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <div v-else class="po__loading">Chargement du projet…</div>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { NeoButton } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import StatCard from '@/components/common/StatCard.vue'
import StatusChip from '@/components/common/StatusChip.vue'
import { useUiStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { useCollaborationSocket } from '@/composables/useCollaborationSocket'
import { formatRelative } from '@/lib/formatDate'
import { isTerminal } from '@/lib/wpStatus'
import api from '@/lib/api'

interface WorkPackage {
  id: string; title: string; status: string; priority: string;
  dueDate: string | null; assigneeId: string | null
  assignee: { id: string; firstName: string; lastName: string } | null
}
interface Milestone  { id: string; title: string; date: string; isReached: boolean }
interface Activity   { action: string; details: string | null; userName: string | null; timestamp: string }
interface Sprint     { id: string; name: string; isActive: boolean; startDate: string; endDate: string }
const props   = defineProps<{ id: string }>()
const router  = useRouter()
const uiStore = useUiStore()
const authStore = useAuthStore()
const collab  = useCollaborationSocket()

const loading         = ref<boolean>(true)
const projectName     = ref<string>('Projet')
const projectStatus   = ref<string>('')
const projectEndDate  = ref<string | null>(null)
const wps             = ref<WorkPackage[]>([])
const milestones      = ref<Milestone[]>([])
const activity        = ref<Activity[]>([])
const activeSprint    = ref<Sprint | null>(null)

const presenceList = collab.presenceList

const isPinned    = computed<boolean>(() => uiStore.isProjectPinned(props.id))
// Only PM/Admin manage team responsibilities (validation + deployment leads).
const canManage   = computed<boolean>(() => authStore.userRole === 'Admin' || authStore.userRole === 'ProjectManager')

const manualProgressPct = ref<number | null>(null)
const wpTotal       = computed<number>(() => wps.value.length)
const wpClosed      = computed<number>(() => wps.value.filter((w) => isTerminal(w.status)).length)
const autoProgress  = computed<number>(() => wpTotal.value ? Math.round((wpClosed.value / wpTotal.value) * 100) : 0)
// Manual override wins when set; otherwise auto from closed work packages.
const overallProgress = computed<number>(() => manualProgressPct.value ?? autoProgress.value)
const isManualProgress = computed<boolean>(() => manualProgressPct.value !== null)
const wpOverdue     = computed<number>(() => wps.value.filter((w) =>
  w.dueDate && new Date(w.dueDate).getTime() < Date.now() && !isTerminal(w.status),
).length)

const statusByCount = computed(() => {
  const counts: Record<string, number> = {}
  const list = Array.isArray(wps.value) ? wps.value : []
  for (const w of list) counts[w.status] = (counts[w.status] ?? 0) + 1
  const order = ['New', 'InProgress', 'OnHold', 'Blocked', 'Resolved', 'Closed']
  return order.filter((s) => counts[s] > 0).map((s) => ({ status: s, count: counts[s] ?? 0 }))
})

const nextMilestone = computed<Milestone | null>(() =>
  milestones.value
    .filter((m) => !m.isReached && new Date(m.date).getTime() > Date.now())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0] ?? null,
)

const daysToMilestone = computed<number>(() => {
  if (!nextMilestone.value) return 0
  return Math.max(0, Math.round((new Date(nextMilestone.value.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
})

const daysToEnd = computed<number | null>(() => {
  if (!projectEndDate.value) return null
  return Math.round((new Date(projectEndDate.value).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
})

const daysToEndLabel = computed<string>(() => {
  if (daysToEnd.value === null) return ''
  if (daysToEnd.value < 0) return `En retard de ${Math.abs(daysToEnd.value)} jours`
  if (daysToEnd.value === 0) return "Échéance aujourd'hui"
  return `${daysToEnd.value} jours restants`
})

const activeSprintName = computed<string>(() => activeSprint.value?.name ?? '')

function go(module: string): void { void router.push(`/app/pm/projects/${props.id}/${module}`) }

// ── Manual progress override (PM/Admin) ──────────────────────────────────────
const editingProgress = ref<boolean>(false)
const progressDraft   = ref<number>(0)
const savingProgress  = ref<boolean>(false)

function startEditProgress(): void {
  progressDraft.value = overallProgress.value
  editingProgress.value = true
}
function cancelEditProgress(): void { editingProgress.value = false }

async function saveProgress(value: number | null): Promise<void> {
  savingProgress.value = true
  try {
    const clamped = value === null ? null : Math.max(0, Math.min(100, Math.round(value)))
    const { data } = await api.patch<{ manualProgressPct: number | null }>(
      `/pm/projects/${props.id}/progress`,
      { manualProgressPct: clamped },
    )
    manualProgressPct.value = data.manualProgressPct
    editingProgress.value = false
  } catch {
    /* api interceptor toasts 5xx; 4xx surfaces via the disabled guard */
  } finally {
    savingProgress.value = false
  }
}

function activityIcon(action: string): string {
  if (action.includes('creat')) return 'pi-plus-circle'
  if (action.includes('updat') || action.includes('chang')) return 'pi-pencil'
  if (action.includes('delet')) return 'pi-trash'
  if (action.includes('valid')) return 'pi-check-circle'
  if (action.includes('comment')) return 'pi-comment'
  return 'pi-info-circle'
}
function activityLabel(action: string): string {
  if (action.includes('creat'))  return 'a créé'
  if (action.includes('updat'))  return 'a modifié'
  if (action.includes('delet'))  return 'a supprimé'
  if (action.includes('valid'))  return 'a validé'
  if (action.includes('comment')) return 'a commenté'
  if (action.includes('status')) return 'a changé le statut'
  return 'a agi sur'
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('')
}

async function loadAll(): Promise<void> {
  loading.value = true
  try {
    interface Project { name: string; status: string; endDate: string | null; manualProgressPct?: number | null }
    const [projRes, wpsRes] = await Promise.all([
      api.get<Project>(`/pm/projects/${props.id}`),
      api.get<{ items: WorkPackage[] }>(`/pm/projects/${props.id}/work-packages?limit=200`),
    ])
    projectName.value    = projRes.data.name
    projectStatus.value  = projRes.data.status
    projectEndDate.value = projRes.data.endDate
    manualProgressPct.value = projRes.data.manualProgressPct ?? null
    wps.value            = Array.isArray(wpsRes.data?.items) ? wpsRes.data.items : []

    // Best-effort fetches — tolerate missing endpoints + varying response shapes.
    try {
      const { data } = await api.get<Milestone[] | { items: Milestone[] }>(`/pm/projects/${props.id}/milestones`, { suppressErrorToast: true } as never)
      milestones.value = Array.isArray(data) ? data : (data?.items ?? [])
    } catch { /* silent */ }

    try {
      const { data } = await api.get<Activity[] | { items: Activity[] }>(`/pm/projects/${props.id}/activity`, { suppressErrorToast: true } as never)
      activity.value = Array.isArray(data) ? data : (data?.items ?? [])
    } catch { /* silent */ }

    try {
      interface Board { id: string }
      const { data: boards } = await api.get<Board[]>(`/pm/projects/${props.id}/boards`, { suppressErrorToast: true } as never)
      if (boards.length > 0) {
        const { data: sprints } = await api.get<Sprint[]>(`/pm/projects/${props.id}/boards/${boards[0].id}/sprints`, { suppressErrorToast: true } as never)
        activeSprint.value = sprints.find((s) => s.isActive) ?? null
      }
    } catch { /* silent */ }

  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadAll()
  collab.joinProject(props.id)
})
onUnmounted(() => {
  collab.leaveProject(props.id)
})
</script>

<style scoped>
.po { display: flex; flex-direction: column; gap: var(--nl-sp-4); padding: var(--nl-sp-4); }
.po__loading { padding: var(--nl-sp-8); text-align: center; color: var(--nl-text-3); }

.po__progress {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  padding: var(--nl-sp-4);
}
.po__progress-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: var(--nl-sp-2); }
.po__progress-label { font-size: var(--nl-fs-sm); color: var(--nl-text-3); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.po__progress-value { font-size: var(--nl-fs-2xl); font-weight: 700; color: var(--nl-text-1); line-height: 1; }
.po__progress-mode { font-size: 0.7rem; font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--nl-text-3); margin-left: 0.4rem; }
.po__progress-controls { display: inline-flex; align-items: center; gap: 0.5rem; }
.po__progress-edit {
  display: inline-flex; align-items: center; gap: 0.3rem;
  border: 1px solid var(--nl-border); background: var(--nl-surface);
  cursor: pointer; color: var(--nl-text-2);
  padding: 0.25rem 0.65rem; border-radius: var(--nl-radius-pill);
  font-size: var(--nl-fs-sm); font-weight: 500;
}
.po__progress-edit:hover { background: var(--nl-accent-light); color: var(--nl-accent); border-color: var(--nl-accent); }
.po__progress-editor { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
.po__progress-range { flex: 1; min-width: 120px; accent-color: var(--nl-accent, #1e9e8f); }
.po__progress-num { width: 64px; padding: 0.3rem 0.4rem; border: 1px solid var(--nl-border, #e5e7eb); border-radius: 6px; }
.po__progress-bar { height: 6px; background: var(--nl-surface-2); border-radius: var(--nl-radius-pill); overflow: hidden; }
.po__progress-fill { height: 100%; background: linear-gradient(90deg, var(--nl-accent), color-mix(in srgb, var(--nl-accent) 80%, var(--nl-success))); border-radius: inherit; transition: width 0.3s; }
.po__progress-meta { display: flex; justify-content: space-between; margin-top: var(--nl-sp-2); font-size: var(--nl-fs-sm); color: var(--nl-text-3); }
.po__progress-danger { color: var(--nl-danger); font-weight: 600; }

.po__stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--nl-sp-3);
}

.po__grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: var(--nl-sp-4);
}
.po__col { display: flex; flex-direction: column; gap: var(--nl-sp-4); }

.po__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--nl-sp-3); }
.po__head-title {
  display: flex; align-items: center; gap: var(--nl-sp-2);
  margin: 0; font-size: var(--nl-fs-md); font-weight: 600; color: var(--nl-text-1);
}
.po__head-title .pi { color: var(--nl-text-3); font-size: 14px; }
.po__head-link { font-size: var(--nl-fs-sm); color: var(--nl-accent); text-decoration: none; font-weight: 500; }
.po__head-link:hover { text-decoration: underline; }

/* Work package list */
.po__wp-list { list-style: none; padding: 0; margin: 0; }
.po__wp { display: flex; align-items: center; gap: var(--nl-sp-3); padding: var(--nl-sp-2) var(--nl-sp-3); border-radius: var(--nl-radius); }
.po__wp-body { flex: 1; min-width: 0; }
.po__wp-title {
  font-size: var(--nl-fs-base); font-weight: 500; color: var(--nl-text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.po__wp-meta { display: flex; align-items: center; gap: var(--nl-sp-2); font-size: var(--nl-fs-sm); color: var(--nl-text-3); margin-top: 2px; }
.po__wp-due--overdue { color: var(--nl-danger); font-weight: 600; }

/* Status bars */
.po__status-bars { display: flex; flex-direction: column; gap: var(--nl-sp-2); }
.po__status-bar { display: grid; grid-template-columns: 90px 1fr 30px; gap: var(--nl-sp-2); align-items: center; }
.po__status-track { height: 6px; background: var(--nl-surface-2); border-radius: var(--nl-radius-pill); overflow: hidden; }
.po__status-fill { height: 100%; background: var(--nl-accent); border-radius: inherit; }
.po__status-count { font-size: var(--nl-fs-sm); font-weight: 600; color: var(--nl-text-2); text-align: right; }

/* Milestone */
.po__milestone { display: flex; align-items: center; gap: var(--nl-sp-4); padding: var(--nl-sp-2); }
.po__milestone-days {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 72px; height: 72px; background: var(--nl-accent-light); color: var(--nl-accent);
  border-radius: var(--nl-radius-lg); flex-shrink: 0;
}
.po__milestone-n { font-size: var(--nl-fs-2xl); font-weight: 700; line-height: 1; }
.po__milestone-u { font-size: var(--nl-fs-xs); text-transform: uppercase; }
.po__milestone-title { font-size: var(--nl-fs-lg); font-weight: 600; color: var(--nl-text-1); }
.po__milestone-date  { font-size: var(--nl-fs-sm); color: var(--nl-text-3); margin-top: 4px; }

/* Activity */
.po__activity-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--nl-sp-1); }
.po__activity { display: flex; align-items: flex-start; gap: var(--nl-sp-2); padding: var(--nl-sp-2); }
.po__activity-icon { color: var(--nl-text-3); font-size: 12px; margin-top: 3px; flex-shrink: 0; }
.po__activity-body { flex: 1; min-width: 0; }
.po__activity-text { font-size: var(--nl-fs-sm); color: var(--nl-text-2); line-height: 1.4; }
.po__activity-text strong { color: var(--nl-text-1); font-weight: 600; }
.po__activity-time { font-size: var(--nl-fs-xs); color: var(--nl-text-3); margin-top: 2px; }

/* Presence avatars */
.po__presence { display: flex; flex-wrap: wrap; gap: var(--nl-sp-1); padding: var(--nl-sp-1); }
.po__avatar {
  width: 32px; height: 32px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; font-size: 11px; font-weight: 600;
  border: 2px solid var(--nl-surface);
}

/* Mobile */
@media (max-width: 900px) {
  .po__grid { grid-template-columns: 1fr; }
  .po__stats { grid-template-columns: repeat(2, 1fr); }
}
</style>
