<template>
  <div class="pm-detail">
    <div v-if="!project" class="pm-detail__loading">Chargement…</div>
    <template v-else>
    <div class="detail-header">
      <button class="back-btn" @click="emit('close')">
        <i class="pi pi-arrow-left" /> Mes projets
      </button>
      <div class="detail-header-right">
        <!-- Cahier validation badge — only shown when in_review or validated.
             Rejected goes back to "no badge" state per UX spec; the PM gets
             the rejection details via the existing notification + the
             reject banner inside the cahier tab. -->
        <NeoTag
          v-if="cahierBadge"
          :value="cahierBadge.label"
          :severity="cahierBadge.severity"
          :icon="cahierBadge.icon"
        />
        <NeoTag
          :value="PROJECT_STATUS_LABELS[project.status]"
          :severity="statusSeverity(project.status)"
        />
        <NeoButton
          v-if="canExport"
          label="Exporter CSV"
          icon="pi pi-file-excel"
          outlined
          severity="secondary"
          size="small"
          :loading="exporting === 'csv'"
          :disabled="exporting !== null"
          @click="onExportCsv"
        />
        <NeoButton
          v-if="canExport"
          label="Exporter PDF"
          icon="pi pi-file-pdf"
          outlined
          severity="secondary"
          size="small"
          :loading="exporting === 'pdf'"
          :disabled="exporting !== null"
          @click="onExportPdf"
        />
      </div>
    </div>

    <!-- Project title + meta -->
    <div class="detail-meta">
      <div>
        <h2 class="detail-name">{{ project.name }}</h2>
        <p class="detail-client">{{ project.clientName }}</p>
      </div>
    </div>

    <!-- Phase stepper -->
    <PhasesStepper :status="project.status" />

    <!-- Inner tabs -->
    <div class="inner-tabs">
      <button
        v-for="tab in visibleTabs"
        :key="tab.id"
        :class="['inner-tab', { 'inner-tab--active': activeTab === tab.id }]"
        @click="activeTab = tab.id"
      >
        <i :class="['pi', tab.icon]" />
        {{ tab.label }}
      </button>
    </div>

    <div class="tab-body">
      <QuestionnaireForm v-if="activeTab === 'questionnaire'" :project="project" :readonly="readonly" />
      <AIOutputSection   v-else-if="activeTab === 'ai'"      :project-id="project.id" :ai-output="project.aiOutput" />
      <TeamValidationSection
        v-else-if="activeTab === 'validation'"
        :project-id="project.id"
        :validations="validations"
      />
      <ValidationTimeline
        v-else-if="activeTab === 'history' && historyLoaded"
        :project-id="project.id"
      />
      <MeetingSection
        v-else-if="activeTab === 'meetings'"
        :project-id="project.id"
        :readonly="readonly"
      />
      <CommentsSection
        v-else-if="activeTab === 'comments'"
        :project-id="project.id"
      />
      <CahierDesChargesSection
        v-else-if="activeTab === 'cahier'"
        :project-id="project.id"
      />
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { NeoButton, NeoTag, useNeoToast } from '@neolibrary/components'
import { watch } from 'vue'
import PhasesStepper         from '@/components/pm/PhasesStepper.vue'
import QuestionnaireForm     from '@/components/pm/QuestionnaireForm.vue'
import AIOutputSection       from '@/components/pm/AIOutputSection.vue'
import TeamValidationSection from '@/components/pm/TeamValidationSection.vue'
import MeetingSection        from '@/components/pm/MeetingSection.vue'
import CommentsSection       from '@/components/pm/CommentsSection.vue'
import ValidationTimeline    from '@/components/pm/ValidationTimeline.vue'
import CahierDesChargesSection from '@/components/pm/CahierDesChargesSection.vue'
import { usePmStore }        from '@/stores/pmStore'
import { useCommentStore }   from '@/stores/commentStore'
import { useAuthStore }      from '@/stores/authStore'
import api, { extractErrorMessage } from '@/lib/api'
import { exportProjectCsv, exportProjectPdf } from '@/lib/projectReport'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectDetail, ProjectStatus } from '@/types/project.types'
import type { ProjectValidation } from '@/types/pm.types'

const props = defineProps<{
  project: ProjectDetail
  validations: ProjectValidation[]
  readonly?: boolean
  /** Optional initial tab — used by router-driven mounts that pass `?tab=cahier` etc. */
  initialTab?: string
}>()
const emit = defineEmits<{ close: [] }>()
const store = usePmStore()
const commentStore = useCommentStore()
const authStore = useAuthStore()
const toast = useNeoToast()

type TabId = 'questionnaire' | 'ai' | 'validation' | 'history' | 'meetings' | 'comments' | 'cahier'
const VALID_TABS: TabId[] = ['questionnaire', 'ai', 'validation', 'history', 'meetings', 'comments', 'cahier']
const activeTab = ref<TabId>(
  (VALID_TABS as string[]).includes(props.initialTab ?? '')
    ? (props.initialTab as TabId)
    : 'questionnaire',
)
watch(() => props.initialTab, (t) => {
  if (t && (VALID_TABS as string[]).includes(t)) activeTab.value = t as TabId
})

const historyLoaded = ref(false)

watch(activeTab, (tab) => {
  if (tab === 'comments') commentStore.fetchComments(props.project.id)
  if (tab === 'history') historyLoaded.value = true
})

// Ordre aligné sur le flux de travail réel du chef de projet :
// 1. Remplir le questionnaire → 2. Faire les réunions → 3. Générer l'analyse IA
// → 4. Finaliser le cahier des charges → 5. Validation par les équipes
// → 6. Consulter l'historique → 7. Échanger en commentaires.
const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: 'questionnaire', label: 'Questionnaire',           icon: 'pi-list-check' },
  { id: 'meetings',      label: 'Réunions',                icon: 'pi-microphone' },
  { id: 'ai',            label: 'Résultat IA',             icon: 'pi-sparkles' },
  { id: 'cahier',        label: 'Cahier des charges',      icon: 'pi-file-word' },
  { id: 'validation',    label: 'Validation équipes',      icon: 'pi-shield' },
  { id: 'history',       label: 'Historique validations',  icon: 'pi-clock' },
  { id: 'comments',      label: 'Commentaires',            icon: 'pi-comments' },
]

// Per-role tab visibility.
// - Admin: sees everything
// - ProjectManager: drives the project but does NOT validate the cahier — hide the
//   "Validation équipes" tab (that action belongs to SpecificationTeam exclusively).
//   PM keeps the read-only "Historique validations" tab to see what was decided.
// - SpecificationTeam: focused on validation
// - Member: read-only observer
const TABS_BY_ROLE: Record<string, TabId[]> = {
  ProjectManager:    ['questionnaire', 'meetings', 'ai', 'cahier', 'history', 'comments'],
  // Validation team needs full read context to review the cahier:
  // questionnaire (formulaire), meetings (transcripts), the cahier (read-only —
  // they approve/reject via the validation actions; only PM/Admin edit/regenerate).
  SpecificationTeam: ['questionnaire', 'meetings', 'cahier', 'validation', 'history', 'comments'],
  Member:            ['cahier', 'history', 'comments'],
}

const visibleTabs = computed(() => {
  const role = authStore.userRole ?? ''
  const allowed = TABS_BY_ROLE[role]
  if (!allowed) return tabs // Admin sees everything
  return tabs.filter((t) => allowed.includes(t.id))
})

// Make sure the active tab is always one the user can actually see
watch(visibleTabs, (list) => {
  if (list.length > 0 && !list.some((t) => t.id === activeTab.value)) {
    activeTab.value = list[0].id
  }
}, { immediate: true })

// ── Live stepper polling — phase changes propagate when another user
// bumps the status. Two safeguards:
//  1. Pause polling when the document is hidden (browser tab in background) — no
//     point burning bandwidth or hammering the API.
//  2. Pause when the user is editing the questionnaire — refetching mid-edit
//     would clobber the form's reactive `fields` array with stale server data.
let _poll: number | null = null
function shouldPoll(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
  if (activeTab.value === 'questionnaire') return false
  return true
}

// ─── Cahier validation status (drives the header badge) ───────────────────────
//
// Per UX spec: only show badge for `pending` (En validation) and `approved`
// (Validé). `none` and `rejected` show no badge — when rejected, the cahier
// is back to a draft-like state and the PM is expected to fix-and-resave.
// The rejection feedback reaches the PM via:
//   - the existing notification (cahier_rejected) triggered by saveFeedback()
//   - the inline reject banner inside CahierDesChargesSection
type CahierStatusValue = 'none' | 'pending' | 'approved' | 'rejected'
const cahierStatus = ref<CahierStatusValue>('none')

async function refreshCahierStatus(): Promise<void> {
  const id = props.project?.id
  if (!id) return
  try {
    const { data } = await api.get<{ status: CahierStatusValue }>(
      `/pm/projects/${id}/cahier-des-charges/status`,
    )
    cahierStatus.value = data.status
  } catch {
    cahierStatus.value = 'none'
  }
}

const cahierBadge = computed<{
  label: string
  severity: 'info' | 'success'
  icon: string
} | null>(() => {
  if (cahierStatus.value === 'pending') {
    return { label: 'Cahier en validation', severity: 'info', icon: 'pi pi-hourglass' }
  }
  if (cahierStatus.value === 'approved') {
    return { label: 'Cahier validé', severity: 'success', icon: 'pi pi-check-circle' }
  }
  return null
})

onMounted(() => {
  void refreshCahierStatus()
  _poll = window.setInterval(() => {
    if (!shouldPoll()) return
    const id = props.project?.id
    if (!id) return
    store.fetchProject(id)
    void refreshCahierStatus()
  }, 15_000)
})
onUnmounted(() => {
  if (_poll !== null) clearInterval(_poll)
})

// Refetch the status when the project id changes (route navigation between projects).
watch(() => props.project?.id, (id) => {
  if (id) void refreshCahierStatus()
})

const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

// ─── Report export (CSV / PDF) ────────────────────────────────────────────────
// Fetches a structured report from the backend and renders it client-side.
// `exporting` doubles as a per-format loading flag and a re-entrancy guard.
const exporting = ref<'csv' | 'pdf' | null>(null)

// Only Admin + PM may export. The backend report-data endpoint is gated by
// @Roles('Admin', 'ProjectManager'), so showing these buttons to a
// SpecificationTeam reviewer (who also lands on this view) would render
// always-failing buttons (403). Keep the frontend gate in lock-step with the
// controller's @Roles.
const canExport = computed(
  () => authStore.userRole === 'ProjectManager' || authStore.userRole === 'Admin',
)

async function onExportCsv(): Promise<void> {
  if (exporting.value) return
  exporting.value = 'csv'
  try {
    await exportProjectCsv(props.project.id)
    toast.add({ severity: 'success', detail: 'Export CSV téléchargé.', life: 3000 })
  } catch (err) {
    toast.add({ severity: 'error', detail: extractErrorMessage(err) ?? "Échec de l'export CSV.", life: 4000 })
  } finally {
    exporting.value = null
  }
}

async function onExportPdf(): Promise<void> {
  if (exporting.value) return
  exporting.value = 'pdf'
  try {
    await exportProjectPdf(props.project.id)
    toast.add({ severity: 'success', detail: 'Export PDF téléchargé.', life: 3000 })
  } catch (err) {
    toast.add({ severity: 'error', detail: extractErrorMessage(err) ?? "Échec de l'export PDF.", life: 4000 })
  } finally {
    exporting.value = null
  }
}
</script>

<style scoped>
.pm-detail { display: flex; flex-direction: column; gap: 24px; }

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.detail-header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.back-btn {
  display: flex; align-items: center; gap: 0.4rem;
  background: none; border: none; color: var(--nl-text-3);
  font-size: 0.875rem; cursor: pointer; padding: 0.3rem 0;
  transition: color 0.15s;
}
.back-btn:hover { color: var(--nl-accent); }

.detail-meta { display: flex; align-items: flex-start; justify-content: space-between; }
.detail-name { font-size: 1.4rem; font-weight: 800; color: var(--nl-text-1); margin: 0; }
.detail-client {
  font-size: 0.8125rem;
  color: var(--nl-text-3);
  margin: 0.3rem 0 0;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.inner-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--nl-border);
}

.inner-tab {
  display: flex; align-items: center; gap: 0.4rem;
  background: none; border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  padding: 10px 16px;
  font-size: 13px; font-weight: 500;
  color: var(--nl-text-3); cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.inner-tab:hover { color: var(--nl-text-1); }
.inner-tab--active {
  color: var(--nl-accent);
  border-bottom: 2px solid var(--nl-accent);
  font-weight: 600;
}

.tab-body {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  padding: 24px;
}
</style>
