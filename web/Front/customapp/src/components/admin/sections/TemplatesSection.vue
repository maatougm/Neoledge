<template>
  <div class="templates-section">
    <div class="section-header">
      <div>
        <h2 class="section-title">Modèles de projets</h2>
        <p class="section-sub">Créez des configurations réutilisables de champs personnalisés.</p>
      </div>
      <NeoButton label="Nouveau modèle" icon="pi pi-plus" @click="showCreateDialog = true" />
    </div>

    <div v-if="store.loading" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size:1.5rem;color:#0d9488" />
    </div>

    <div v-else-if="store.templates.length === 0" class="empty-state">
      <i class="pi pi-copy" style="font-size:2.5rem;color:#334155" />
      <p>Aucun modèle créé. Créez votre premier modèle pour accélérer la configuration des projets.</p>
    </div>

    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Description</th>
            <th>Champs</th>
            <th>Créé le</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tpl in store.templates" :key="tpl.id">
            <td class="td-name">{{ tpl.name }}</td>
            <td class="td-desc">{{ tpl.description ?? '—' }}</td>
            <td>{{ tpl.fieldCount }}</td>
            <td>{{ formatDate(tpl.createdAt) }}</td>
            <td class="td-actions">
              <NeoButton
                label="Appliquer"
                icon="pi pi-play"
                size="small"
                outlined
                @click="openApplyDialog(tpl)"
              />
              <NeoButton
                icon="pi pi-trash"
                size="small"
                outlined
                severity="danger"
                @click="handleDelete(tpl.id, tpl.name)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create dialog -->
    <AppModal v-model:visible="showCreateDialog" header="Nouveau modèle" width="600px">
      <div class="create-form">
        <NeoInputText v-model="form.name" label="Nom du modèle" placeholder="Ex : Modèle Neo Project standard" class="w-full" />
        <NeoInputText v-model="form.description" label="Description (optionnel)" placeholder="Description courte" class="w-full" />

        <div class="fields-block">
          <div class="fields-block-header">
            <span class="fields-block-title">Champs du modèle</span>
            <NeoButton label="Ajouter un champ" icon="pi pi-plus" outlined size="small" @click="addRow" />
          </div>
          <div v-for="(row, idx) in form.fields" :key="row.uid" class="field-row">
            <div class="field-row__main">
              <NeoInputText v-model="row.label" placeholder="Libellé" class="flex-2" />
              <NeoSelect
                v-model="row.fieldType"
                :options="fieldTypeOptions"
                optionLabel="label"
                optionValue="value"
                style="min-width:120px"
              />
              <button class="remove-row-btn" title="Supprimer" @click="removeRow(idx)">
                <i class="pi pi-times" />
              </button>
            </div>
            <div class="field-row__flags">
              <label class="field-flag">
                <input v-model="row.isRequired" type="checkbox" />
                <span>Obligatoire</span>
              </label>
              <label class="field-flag" title="Ce champ alimente la génération IA du cahier des charges et du backlog. Sans réponse, l'IA bloque la génération.">
                <input v-model="row.isBacklogDriver" type="checkbox" />
                <span>Alimente l'IA <i class="pi pi-sparkles" style="color:var(--nl-accent)" /></span>
              </label>
              <NeoInputText
                v-if="row.isBacklogDriver"
                v-model="row.backlogHint"
                placeholder="Indication pour l'IA (optionnel)"
                :maxlength="500"
                style="flex:1; min-width:0;"
              />
            </div>
          </div>
          <div v-if="form.fields.length === 0" class="no-fields">Aucun champ ajouté.</div>
        </div>
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showCreateDialog = false" />
        <NeoButton label="Créer" :loading="saving" :disabled="!form.name.trim()" @click="handleCreate" />
      </template>
    </AppModal>

    <!-- Apply to project dialog -->
    <AppModal v-model:visible="showApplyDialog" header="Appliquer le modèle" width="480px">
      <div class="apply-form">
        <p class="apply-hint">
          Sélectionnez un projet pour y ajouter les champs du modèle
          <strong>{{ applyTarget?.name }}</strong>.
        </p>
        <NeoSelect
          v-model="selectedProjectId"
          :options="projectOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Sélectionner un projet"
          class="w-full"
        />
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showApplyDialog = false" />
        <NeoButton
          label="Appliquer"
          icon="pi pi-check"
          :loading="applying"
          :disabled="!selectedProjectId"
          @click="handleApply"
        />
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { NeoButton, NeoInputText, NeoSelect, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import { useTemplateStore } from '@/stores/templateStore'
import { useProjectStore } from '@/stores/projectStore'
import type { ProjectTemplateSummary } from '@/types/project.types'

const store        = useTemplateStore()
const projectStore = useProjectStore()
const toast        = useNeoToast()
const confirm      = useNeoConfirm()

const showCreateDialog = ref(false)
const showApplyDialog  = ref(false)
const saving           = ref(false)
const applying         = ref(false)

const applyTarget       = ref<ProjectTemplateSummary | null>(null)
const selectedProjectId = ref<string | null>(null)

const fieldTypeOptions = [
  { value: 'Text',     label: 'Texte' },
  { value: 'Number',   label: 'Nombre' },
  { value: 'Date',     label: 'Date' },
  { value: 'Select',   label: 'Liste' },
  { value: 'Checkbox', label: 'Case à cocher' },
]

interface FieldRow {
  uid: string
  label: string
  fieldType: string
  isRequired: boolean
  isBacklogDriver: boolean
  backlogHint: string
}
const emptyForm = (): { name: string; description: string; fields: FieldRow[] } => ({
  name: '', description: '', fields: [],
})
const form = reactive(emptyForm())

const projectOptions = computed(() =>
  projectStore.projects.map((p) => ({
    value: p.id,
    label: `${p.name} — ${p.clientName}`,
  })),
)

onMounted(() => {
  store.fetchTemplates()
  if (projectStore.projects.length === 0) projectStore.fetchAll()
})

function addRow() {
  form.fields.push({
    uid: crypto.randomUUID(),
    label: '',
    fieldType: 'Text',
    isRequired: false,
    isBacklogDriver: false,
    backlogHint: '',
  })
}

function removeRow(idx: number) {
  form.fields.splice(idx, 1)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR')
}

async function handleCreate() {
  if (!form.name.trim()) return
  saving.value = true
  try {
    const result = await store.createTemplate({
      name: form.name.trim(),
      description: form.description.trim() || null,
      fields: form.fields.map((f, i) => ({
        label: f.label,
        fieldType: f.fieldType,
        category: 'Custom',
        isRequired: f.isRequired,
        displayOrder: i,
        options: null,
        isBacklogDriver: f.isBacklogDriver,
        backlogHint: f.backlogHint.trim() || null,
      })),
    })
    if (result) {
      toast.add({ severity: 'success', detail: `Modèle « ${form.name} » créé.`, life: 3000 })
      showCreateDialog.value = false
      Object.assign(form, emptyForm())
    } else {
      toast.add({ severity: 'error', detail: store.error ?? 'Erreur lors de la création du modèle.', life: 4000 })
    }
  } finally {
    saving.value = false
  }
}

function handleDelete(id: string, name: string) {
  confirm.require({
    message: `Supprimer le modèle « ${name} » ?`,
    header: 'Confirmer la suppression',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    accept: async () => {
      await store.deleteTemplate(id)
      toast.add({ severity: 'info', detail: `Modèle « ${name} » supprimé.`, life: 3000 })
    },
  })
}

function openApplyDialog(tpl: ProjectTemplateSummary) {
  applyTarget.value = tpl
  selectedProjectId.value = null
  showApplyDialog.value = true
}

async function handleApply() {
  if (!applyTarget.value || !selectedProjectId.value) return
  applying.value = true
  try {
    await store.applyToProject(applyTarget.value.id, selectedProjectId.value)
    const projectName = projectStore.projects.find((p) => p.id === selectedProjectId.value)?.name ?? ''
    toast.add({
      severity: 'success',
      detail: `Modèle « ${applyTarget.value.name} » appliqué au projet « ${projectName} ».`,
      life: 3000,
    })
    showApplyDialog.value = false
  } catch {
    toast.add({ severity: 'error', detail: "Erreur lors de l'application du modèle.", life: 4000 })
  } finally {
    applying.value = false
  }
}
</script>

<style scoped>
.templates-section { display: flex; flex-direction: column; gap: 1.5rem; }

.section-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 1rem; }
.section-title  { font-size: 1.25rem; font-weight: 800; color: var(--nl-text-1); margin: 0; }
.section-sub    { font-size: 0.875rem; color: var(--nl-text-3); margin: 0.25rem 0 0; }

.loading-state, .empty-state {
  display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
  padding: 3rem; color: #94a3b8; font-size: 0.875rem; text-align: center;
}

.table-wrap { background: var(--nl-surface); border: 1px solid var(--nl-border); border-radius: 10px; overflow: hidden; }

.data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.data-table th {
  background: var(--nl-surface-2); padding: 0.75rem 1rem;
  text-align: left; font-size: 0.78rem; font-weight: 600;
  color: var(--nl-text-3); text-transform: uppercase; letter-spacing: 0.5px;
  border-bottom: 1px solid var(--nl-border);
}
.data-table td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--nl-surface-2); color: var(--nl-text-2); }
.data-table tr:last-child td { border-bottom: none; }
.td-name { font-weight: 600; color: var(--nl-text-1); }
.td-desc {
  color: var(--nl-text-3);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.td-actions { text-align: right; display: flex; gap: 0.5rem; justify-content: flex-end; }

.create-form { display: flex; flex-direction: column; gap: 1rem; padding: 0.5rem 0; }

.fields-block {
  border: 1px solid var(--nl-border); border-radius: var(--nl-radius); overflow: hidden;
}
.fields-block-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1rem; background: var(--nl-surface-2); border-bottom: 1px solid var(--nl-border);
}
.fields-block-title { font-size: 0.875rem; font-weight: 600; color: var(--nl-text-2); }

.field-row {
  display: flex; flex-direction: column; gap: 0.4rem;
  padding: 0.6rem 1rem; border-bottom: 1px solid var(--nl-surface-2);
}
.field-row:last-child { border-bottom: none; }
.field-row__main { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.field-row__flags {
  display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
  padding-left: 0.25rem;
}
.field-flag {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-size: 0.8125rem; color: var(--nl-text-2); cursor: pointer;
}
.field-flag input[type="checkbox"] { margin: 0; }
.flex-2 { flex: 2; min-width: 120px; }

.remove-row-btn {
  background: none; border: none; color: var(--nl-danger); cursor: pointer;
  padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.8rem;
  transition: background 0.15s;
}
.remove-row-btn:hover { background: #fee2e2; }

.no-fields { padding: 1rem; text-align: center; color: var(--nl-text-3); font-size: 0.875rem; }

.apply-form { display: flex; flex-direction: column; gap: 1rem; padding: 0.5rem 0; }
.apply-hint { font-size: 0.875rem; color: var(--nl-text-2); margin: 0; }

.w-full { width: 100%; }
</style>
