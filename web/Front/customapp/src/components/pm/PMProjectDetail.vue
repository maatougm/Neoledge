<template>
  <div class="pm-detail">
    <div v-if="!project" class="pm-detail__loading">Chargement…</div>
    <template v-else>
    <div class="detail-header">
      <button class="back-btn" @click="emit('close')">
        <i class="pi pi-arrow-left" /> Mes projets
      </button>
      <div class="detail-header-right">
        <NeoTag
          :value="PROJECT_STATUS_LABELS[project.status]"
          :severity="statusSeverity(project.status)"
        />
        <NeoButton
          label="Exporter PDF"
          icon="pi pi-file-pdf"
          outlined
          size="small"
          @click="exportPdf"
        />
      </div>
    </div>

    <!-- Hidden print area -->
    <div id="pm-print-area" style="display: none">
      <h1>{{ project.name }}</h1>
      <div class="meta">
        Client : {{ project.clientName }} | Statut : {{ PROJECT_STATUS_LABELS[project.status] }}
      </div>
      <table>
        <thead>
          <tr>
            <th>Champ</th>
            <th>Valeur</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="field in project.fields" :key="field.id">
            <td>{{ field.label }}</td>
            <td>{{ fieldValue(field.id) }}</td>
          </tr>
        </tbody>
      </table>
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
      <ActivityFeed
        v-else-if="activeTab === 'activity'"
        :activities="store.activities"
      />
      <MeetingSection
        v-else-if="activeTab === 'meetings'"
        :project-id="project.id"
      />
      <CommentsSection
        v-else-if="activeTab === 'comments'"
        :project-id="project.id"
      />
      <AutomationSection
        v-else-if="activeTab === 'automation'"
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
import { NeoButton, NeoTag } from '@neolibrary/components'
import { watch } from 'vue'
import PhasesStepper         from '@/components/pm/PhasesStepper.vue'
import QuestionnaireForm     from '@/components/pm/QuestionnaireForm.vue'
import AIOutputSection       from '@/components/pm/AIOutputSection.vue'
import TeamValidationSection from '@/components/pm/TeamValidationSection.vue'
import ActivityFeed          from '@/components/pm/ActivityFeed.vue'
import MeetingSection        from '@/components/pm/MeetingSection.vue'
import CommentsSection       from '@/components/pm/CommentsSection.vue'
import ValidationTimeline    from '@/components/pm/ValidationTimeline.vue'
import AutomationSection     from '@/components/pm/AutomationSection.vue'
import CahierDesChargesSection from '@/components/pm/CahierDesChargesSection.vue'
import { usePmStore }        from '@/stores/pmStore'
import { useCommentStore }   from '@/stores/commentStore'
import { useAuthStore }      from '@/stores/authStore'
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

type TabId = 'questionnaire' | 'ai' | 'validation' | 'history' | 'activity' | 'meetings' | 'comments' | 'automation' | 'cahier'
const VALID_TABS: TabId[] = ['questionnaire', 'ai', 'validation', 'history', 'activity', 'meetings', 'comments', 'automation', 'cahier']
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
  if (tab === 'activity') store.fetchActivity(props.project.id)
  if (tab === 'comments') commentStore.fetchComments(props.project.id)
  if (tab === 'history') historyLoaded.value = true
})

// Ordre aligné sur le flux de travail réel du chef de projet :
// 1. Remplir le questionnaire → 2. Faire les réunions → 3. Générer l'analyse IA
// → 4. Finaliser le cahier des charges → 5. Validation par les équipes
// → 6. Consulter l'historique → 7. Échanger en commentaires
// → 8. Consulter l'activité → 9. Configurer les automatisations
const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: 'automation',    label: 'Automatisations',         icon: 'pi-bolt' },
  { id: 'questionnaire', label: 'Questionnaire',           icon: 'pi-list-check' },
  { id: 'meetings',      label: 'Réunions',                icon: 'pi-microphone' },
  { id: 'ai',            label: 'Résultat IA',             icon: 'pi-sparkles' },
  { id: 'cahier',        label: 'Cahier des charges',      icon: 'pi-file-word' },
  { id: 'validation',    label: 'Validation équipes',      icon: 'pi-shield' },
  { id: 'history',       label: 'Historique validations',  icon: 'pi-clock' },
  { id: 'comments',      label: 'Commentaires',            icon: 'pi-comments' },
  { id: 'activity',      label: 'Activité',                icon: 'pi-history' },
]

// Per-role tab visibility.
// - SpecificationTeam: approves the cahier → focused on validation flow
// - Member: not part of the approval flow — read-only observer
const TABS_BY_ROLE: Record<string, TabId[]> = {
  // Spec team: first sees the validation they own, then cahier context, then comms
  SpecificationTeam: ['validation', 'cahier', 'history', 'comments', 'activity'],
  Member:            ['cahier', 'history', 'comments', 'activity'],
}

const visibleTabs = computed(() => {
  const role = authStore.userRole ?? ''
  const allowed = TABS_BY_ROLE[role]
  if (!allowed) return tabs // Admin + ProjectManager see everything
  return tabs.filter((t) => allowed.includes(t.id))
})

// Make sure the active tab is always one the user can actually see
watch(visibleTabs, (list) => {
  if (list.length > 0 && !list.some((t) => t.id === activeTab.value)) {
    activeTab.value = list[0].id
  }
}, { immediate: true })

// ── Live stepper polling — phase changes propagate even when another user
// triggers a validation or an automation bumps the status.
let _poll: number | null = null
onMounted(() => {
  _poll = window.setInterval(() => {
    // Refetch the project detail so PhasesStepper's :current-status prop updates.
    store.fetchProject(props.project.id)
  }, 15_000)
})
onUnmounted(() => {
  if (_poll !== null) clearInterval(_poll)
})

const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

function fieldValue(fieldId: string): string {
  const fv = props.project.fieldValues.find((v) => v.projectFieldId === fieldId)
  return fv?.value ?? '—'
}

function exportPdf(): void {
  const printArea = document.getElementById('pm-print-area')
  if (!printArea) return
  const win = window.open('', '_blank')
  if (!win) return

  // Build DOM safely — no innerHTML injection from user data (#11)
  const doc = win.document
  doc.open()
  doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;padding:2rem;color:#111827}' +
    'h1{font-size:1.4rem;margin-bottom:0.5rem}' +
    '.meta{color:#6b7280;font-size:0.9rem;margin-bottom:1.5rem}' +
    'table{width:100%;border-collapse:collapse}' +
    'th{background:#f3f4f6;padding:0.5rem 0.75rem;text-align:left;font-size:0.8rem;text-transform:uppercase}' +
    'td{padding:0.5rem 0.75rem;border-bottom:1px solid #e5e7eb;font-size:0.9rem}' +
    '.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem}' +
    '</style></head><body></body></html>')
  doc.close()

  // Set title via textContent — safe against HTML injection
  const titleEl = doc.createElement('title')
  titleEl.textContent = props.project.name
  doc.head.appendChild(titleEl)

  // Clone the print area into the popup body — field values rendered by Vue are already text nodes
  const clone = printArea.cloneNode(true) as HTMLElement
  clone.style.display = 'block'
  doc.body.appendChild(clone)

  win.print()
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
