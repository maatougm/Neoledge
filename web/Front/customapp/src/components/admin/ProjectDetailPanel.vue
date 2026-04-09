<!--
  @file     ProjectDetailPanel.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-26
  @desc     Project detail — questionnaire fields, add/remove custom fields, PM permission toggle
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
        :value="PROJECT_STATUS_LABELS[project.status]"
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

      <!-- Inner tabs -->
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

      <!-- Project meta -->
      <div v-show="activeTab === 'fields'" class="meta-card">
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

      <!-- Field management -->
      <div v-show="activeTab === 'fields'" class="fields-card">
        <div class="fields-header">
          <div>
            <h3 class="fields-title">Questionnaire</h3>
            <p class="fields-sub">{{ project.fields.length }} champ(s)</p>
          </div>

          <!-- PM permission toggle -->
          <div class="permission-toggle">
            <span class="toggle-label">
              Autoriser le chef de projet à ajouter des champs
            </span>
            <ToggleSwitch
              :modelValue="project.allowManagerCustomFields"
              @update:modelValue="handleToggle"
              :title="project.allowManagerCustomFields ? 'Révoquer la permission' : 'Accorder la permission'"
            />
          </div>
        </div>

        <!-- Field list -->
        <div class="field-list">
          <div
            v-for="field in project.fields"
            :key="field.id"
            class="field-row"
          >
            <div class="field-info">
              <span class="field-label">{{ field.label }}</span>
              <span class="field-meta">
                <NeoTag
                  :value="FIELD_TYPE_LABELS[field.fieldType] ?? field.fieldType"
                  severity="secondary"
                />
                <NeoTag
                  v-if="field.isRequired"
                  value="Requis"
                  severity="danger"
                />
                <NeoTag
                  :value="FIELD_CATEGORY_LABELS[field.fieldCategory] ?? field.fieldCategory"
                  severity="info"
                />
              </span>
            </div>
            <NeoButton
              v-if="field.fieldCategory !== 'Static'"
              icon="pi pi-trash"
              size="small"
              outlined
              severity="danger"
              title="Supprimer ce champ"
              @click="handleRemoveField(field.id, field.label)"
            />
          </div>
        </div>

        <!-- Apply template -->
        <div class="add-field-form" style="border-top: 1px solid #f3f4f6; padding-top: 1rem; margin-top: 0.5rem;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
            <h4 class="add-field-title" style="margin:0">Appliquer un modèle de champs</h4>
            <NeoButton label="Choisir un modèle" icon="pi pi-copy" outlined size="small" @click="openTemplateDialog" />
          </div>
        </div>

        <!-- Add custom field -->
        <div class="add-field-form">
          <h4 class="add-field-title">Ajouter un champ personnalisé</h4>
          <div class="add-field-row">
            <NeoInputText
              v-model="newField.label"
              label="Libellé"
              placeholder="Ex : Numéro de contrat"
              class="add-field-input"
            />
            <NeoSelect
              v-model="newField.fieldType"
              label="Type"
              :options="fieldTypeOptions"
              optionLabel="label"
              optionValue="value"
              class="add-field-select"
            />
            <div class="add-field-required">
              <NeoCheckbox v-model="newField.isRequired" :binary="true" />
            </div>
            <NeoButton
              label="Ajouter"
              icon="pi pi-plus"
              :loading="store.loading"
              :disabled="!newField.label.trim()"
              @click="handleAddField"
            />
          </div>
        </div>
      </div>
      <!-- Activity feed tab -->
      <div v-if="activeTab === 'activity'" class="fields-card" style="padding: 1rem 1.5rem;">
        <ActivityFeed :activities="store.activities" />
      </div>

      <!-- Validation history tab (read-only) -->
      <div v-if="activeTab === 'validations' && validationsLoaded" class="fields-card" style="padding: 1rem 1.5rem;">
        <ValidationTimeline :project-id="props.projectId" />
      </div>

      <!-- Template picker dialog -->
      <Dialog v-model:visible="showTemplateDialog" header="Appliquer un modèle" :modal="true" style="width: 480px">
        <div v-if="store.templates.length === 0" style="padding: 1rem; color: #6b7280; text-align:center;">
          Aucun modèle disponible.
        </div>
        <div v-else style="display:flex;flex-direction:column;gap:0.75rem;padding:0.5rem 0">
          <div
            v-for="tpl in store.templates"
            :key="tpl.id"
            style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem;border:1px solid #e5e7eb;border-radius:8px"
          >
            <div>
              <div style="font-weight:600;font-size:0.875rem;color:#111827">{{ tpl.name }}</div>
              <div style="font-size:0.78rem;color:#6b7280">{{ tpl.fieldCount }} champ(s)</div>
            </div>
            <NeoButton label="Appliquer" size="small" :loading="applyingTemplate" @click="handleApplyTemplate(tpl.id)" />
          </div>
        </div>
      </Dialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { NeoButton, NeoTag, NeoInputText, NeoSelect, NeoCheckbox, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import ToggleSwitch from 'primevue/toggleswitch'
import { useProjectStore, computeProgress } from '@/stores/projectStore'
import ActivityFeed from '@/components/pm/ActivityFeed.vue'
import ValidationTimeline from '@/components/pm/ValidationTimeline.vue'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus, FieldType } from '@/types/project.types'

const FIELD_TYPE_LABELS: Record<string, string> = {
  Text: 'Texte', Number: 'Nombre', Date: 'Date', Select: 'Liste', Checkbox: 'Case à cocher',
}
const FIELD_CATEGORY_LABELS: Record<string, string> = {
  Static: 'Statique', Dynamic: 'Dynamique', Custom: 'Personnalisé',
}

const fieldTypeOptions = Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => ({ value, label }))

const props = defineProps<{ projectId: string }>()
const emit  = defineEmits<{ close: [] }>()

const store   = useProjectStore()
const toast   = useNeoToast()
const confirm = useNeoConfirm()

const project = ref(store.currentProject?.id === props.projectId ? store.currentProject : null)
const loading = ref(false)
const newField = ref({ label: '', fieldType: 'Text' as FieldType, isRequired: false })

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

type PanelTabId = 'fields' | 'activity' | 'validations'
const activeTab = ref<PanelTabId>('fields')
const validationsLoaded = ref(false)
const panelTabs: { id: PanelTabId; label: string; icon: string }[] = [
  { id: 'fields',      label: 'Questionnaire',           icon: 'pi-list-check' },
  { id: 'validations', label: 'Historique validations',  icon: 'pi-clock' },
  { id: 'activity',    label: 'Activité',                icon: 'pi-history' },
]

const showTemplateDialog = ref(false)
const applyingTemplate   = ref(false)

function switchTab(tab: PanelTabId) {
  activeTab.value = tab
  if (tab === 'activity') store.fetchActivity(props.projectId)
  if (tab === 'validations') validationsLoaded.value = true
}

async function openTemplateDialog() {
  if (store.templates.length === 0) await store.fetchTemplates()
  showTemplateDialog.value = true
}

async function handleApplyTemplate(templateId: string) {
  applyingTemplate.value = true
  try {
    await store.applyTemplate(templateId, props.projectId)
    await load()
    showTemplateDialog.value = false
    toast.add({ severity: 'success', detail: 'Modèle appliqué avec succès.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: "Erreur lors de l'application du modèle.", life: 4000 })
  } finally {
    applyingTemplate.value = false
  }
}

const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

const load = async () => {
  loading.value = true
  await store.fetchById(props.projectId)
  project.value = store.currentProject
  loading.value = false
}

onMounted(load)
watch(() => store.currentProject, (v) => { project.value = v })

const handleToggle = async () => {
  if (!project.value) return
  const next = !project.value.allowManagerCustomFields
  await store.toggleManagerFields(props.projectId, next)
  toast.add({
    severity: 'info',
    detail: next
      ? 'Permission accordée au chef de projet.'
      : 'Permission révoquée.',
    life: 3000,
  })
}

const handleAddField = async () => {
  if (!newField.value.label.trim()) return
  const result = await store.addField(props.projectId, {
    label: newField.value.label.trim(),
    fieldType: newField.value.fieldType,
    isRequired: newField.value.isRequired,
    options: null,
  })
  if (result) {
    toast.add({ severity: 'success', detail: `Champ « ${result.label} » ajouté.`, life: 3000 })
    newField.value = { label: '', fieldType: 'Text', isRequired: false }
  }
}

const handleRemoveField = (fieldId: string, label: string) => {
  confirm.require({
    message: `Supprimer le champ « ${label} » ?`,
    header: 'Confirmer la suppression',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    accept: async () => {
      await store.removeField(props.projectId, fieldId)
      toast.add({ severity: 'info', detail: `Champ « ${label} » supprimé.`, life: 3000 })
    },
  })
}
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

.fields-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--nl-surface-2);
  flex-wrap: wrap;
  gap: 1rem;
}

.fields-title { font-size: 1rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.fields-sub   { font-size: 0.8rem; color: var(--nl-text-3); margin: 0.15rem 0 0; }

/* Permission toggle */
.permission-toggle {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.toggle-label { font-size: 0.82rem; color: var(--nl-text-2); max-width: 220px; line-height: 1.3; }

/* Field list */
.field-list {
  padding: 0.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--nl-surface-2);
}
.field-row:last-child { border-bottom: none; }

.field-info { display: flex; flex-direction: column; gap: 0.3rem; }
.field-label { font-size: 0.875rem; font-weight: 500; color: var(--nl-text-2); }
.field-meta  { display: flex; gap: 0.4rem; flex-wrap: wrap; }

/* Add field form */
.add-field-form {
  padding: 1.25rem 1.5rem;
  background: var(--nl-surface-2);
  border-top: 1px solid var(--nl-surface-2);
}

.add-field-title { font-size: 0.875rem; font-weight: 600; color: var(--nl-text-2); margin: 0 0 0.75rem; }

.add-field-row {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.add-field-input  { flex: 2; min-width: 160px; }
.add-field-select { flex: 1; min-width: 130px; }

.add-field-required { display: flex; align-items: center; padding-bottom: 0.25rem; }
</style>
