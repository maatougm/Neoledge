<!--
  @file     ProjectDetailPanel.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Admin project detail — read-only overview (meta + activity +
            validation history). Questionnaire / templates / custom-field
            management have been moved to the PM workspace.
-->
<template>
  <div class="detail-panel">
    <!-- Header -->
    <div class="detail-header">
      <button class="back-btn" @click="emit('close')">
        <i class="pi pi-arrow-left" /> Retour à la liste
      </button>
      <NeoTag
        v-if="project"
        :value="PROJECT_STATUS_LABELS[project.status] ?? project.status"
        :severity="statusSeverity(project.status)"
      />
    </div>

    <div v-if="loading && !project" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: #0d9488" />
    </div>

    <template v-else-if="project">
      <!-- Progress bar -->
      <div class="progress-section">
        <div class="progress-section__label">
          Complété à <strong>{{ projectProgress }}%</strong>
        </div>
        <div class="progress-section__track">
          <div
            class="progress-section__fill"
            :style="progressFillStyle"
          />
        </div>
      </div>

      <!-- Project meta — always visible -->
      <div class="meta-card">
        <div class="meta-row">
          <div class="meta-item">
            <span class="meta-label">Projet</span>
            <span class="meta-value">{{ project.name }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Client</span>
            <span class="meta-value">{{ project.clientName }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Chef de projet</span>
            <span class="meta-value">
              {{ project.projectManager
                ? `${project.projectManager.firstName} ${project.projectManager.lastName}`
                : '—' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Inner tabs: Activity (default) + Validation history -->
      <div class="inner-tabs">
        <button
          v-for="tab in panelTabs"
          :key="tab.id"
          :class="['inner-tab', { 'inner-tab--active': activeTab === tab.id }]"
          @click="switchTab(tab.id)"
        >
          <i :class="['pi', tab.icon]" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Activity feed -->
      <div v-if="activeTab === 'activity'" class="fields-card" style="padding: 1rem 1.5rem;">
        <ActivityFeed :activities="store.activities" />
      </div>

      <!-- Validation history (read-only) -->
      <div v-if="activeTab === 'validations' && validationsLoaded" class="fields-card" style="padding: 1rem 1.5rem;">
        <ValidationTimeline :project-id="props.projectId" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { NeoTag } from '@neolibrary/components'
import { useProjectStore, computeProgress } from '@/stores/projectStore'
import ActivityFeed from '@/components/pm/ActivityFeed.vue'
import ValidationTimeline from '@/components/pm/ValidationTimeline.vue'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'

const props = defineProps<{ projectId: string }>()
const emit  = defineEmits<{ close: [] }>()

const store   = useProjectStore()

const project = ref(store.currentProject?.id === props.projectId ? store.currentProject : null)
const loading = ref(false)

const projectProgress = computed(() =>
  project.value ? computeProgress(project.value) : 0,
)

const progressFillStyle = computed((): Record<string, string> => {
  const pct = projectProgress.value
  let color = '#E11D48' // red — < 50%
  if (pct >= 80) color = '#059669' // green
  else if (pct >= 50) color = '#D97706' // orange
  return { width: `${pct}%`, background: color }
})

type PanelTabId = 'activity' | 'validations'
const activeTab = ref<PanelTabId>('activity')
const validationsLoaded = ref(false)
const panelTabs: { id: PanelTabId; label: string; icon: string }[] = [
  { id: 'activity',    label: 'Activité',                icon: 'pi-history' },
  { id: 'validations', label: 'Historique validations',  icon: 'pi-clock' },
]

function switchTab(tab: PanelTabId) {
  activeTab.value = tab
  if (tab === 'activity') store.fetchActivity(props.projectId)
  if (tab === 'validations') validationsLoaded.value = true
}

const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

const load = async () => {
  loading.value = true
  await store.fetchById(props.projectId)
  project.value = store.currentProject
  // Pre-load activity since it's the default tab
  await store.fetchActivity(props.projectId)
  loading.value = false
}

onMounted(load)
watch(() => store.currentProject, (v) => { project.value = v })
</script>

<style scoped>
.detail-panel { display: flex; flex-direction: column; gap: 1.5rem; }

/* ── Progress section ── */
.progress-section {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 10px;
  padding: 1rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.progress-section__label {
  font-size: 0.875rem;
  color: var(--nl-text-2);
}

.progress-section__track {
  height: 10px;
  background: var(--nl-border);
  border-radius: 6px;
  overflow: hidden;
}

.progress-section__fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.4s ease;
}

.inner-tabs { display: flex; gap: 0.25rem; border-bottom: 2px solid var(--nl-border); }
.inner-tab {
  display: flex; align-items: center; gap: 0.4rem;
  background: none; border: none; border-bottom: 2px solid transparent;
  margin-bottom: -2px; padding: 0.6rem 1rem;
  font-size: 0.875rem; font-weight: 600; color: var(--nl-text-3); cursor: pointer;
  transition: color 0.15s, border-color 0.15s; border-radius: 4px 4px 0 0;
}
.inner-tab:hover { color: var(--nl-text-1); }
.inner-tab--active { color: var(--nl-accent); border-bottom-color: var(--nl-accent); }

.detail-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: none;
  color: var(--nl-text-3);
  font-size: 0.875rem;
  cursor: pointer;
  padding: 0.3rem 0;
  transition: color 0.15s;
}
.back-btn:hover { color: var(--nl-accent); }

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3rem;
}

.meta-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
}

.meta-row { display: flex; gap: 2rem; flex-wrap: wrap; }
.meta-item { display: flex; flex-direction: column; gap: 0.2rem; }
.meta-label { font-size: 0.75rem; color: var(--nl-text-3); text-transform: uppercase; letter-spacing: 0.5px; }
.meta-value { font-size: 0.9rem; font-weight: 600; color: var(--nl-text-1); }

.fields-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 10px;
  overflow: hidden;
}
</style>
