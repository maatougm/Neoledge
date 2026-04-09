<template>
  <div class="section">
    <!-- Modal de création -->
    <Dialog v-model:visible="showCreateDialog" header="Nouveau modèle" :modal="true" style="width: 600px">
      <div class="create-form">
        <NeoInputText
          v-model="form.name"
          label="Nom du modèle"
          placeholder="Ex : Modèle NeoLeadge standard"
          class="w-full"
        />
        <NeoInputText
          v-model="form.description"
          label="Description (optionnel)"
          placeholder="Description courte"
          class="w-full"
        />

        <div class="fields-section">
          <h4>Champs du modèle</h4>
          <div v-for="(f, i) in form.fields" :key="f.uid" class="field-row">
            <NeoInputText v-model="f.label" placeholder="Libellé" class="flex-1" />
            <NeoSelect
              v-model="f.fieldType"
              :options="fieldTypes"
              optionLabel="label"
              optionValue="value"
              style="min-width: 120px"
            />
            <NeoCheckbox v-model="f.isRequired" :binary="true" />
            <NeoButton icon="pi pi-times" severity="danger" size="small" outlined @click="removeField(i)" />
          </div>
          <NeoButton
            label="Ajouter un champ"
            icon="pi pi-plus"
            outlined
            size="small"
            @click="addFieldRow"
          />
        </div>
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showCreateDialog = false" />
        <NeoButton label="Créer" :loading="saving" :disabled="!form.name.trim()" @click="handleCreate" />
      </template>
    </Dialog>

    <!-- Header -->
    <div class="section-header">
      <div>
        <h2 class="section-title">Modèles de projets</h2>
        <p class="section-subtitle">
          Modèles disponibles : {{ store.templates.length }}
        </p>
      </div>
      <NeoButton
        label="Créer un modèle"
        icon="pi pi-plus"
        @click="openCreateDialog"
      />
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="loading-state">
      <i class="pi pi-spin pi-spinner" />
    </div>

    <!-- Liste des modèles -->
    <div v-else-if="store.templates.length" class="template-list">
      <div
        v-for="tpl in store.templates"
        :key="tpl.id"
        class="template-card"
      >
        <div class="template-main">
          <div class="template-header">
            <div class="template-meta">
              <h3 class="template-name">{{ tpl.name }}</h3>
              <p v-if="tpl.description" class="template-desc">{{ tpl.description }}</p>
            </div>
            <NeoButton
              icon="pi pi-trash"
              severity="danger"
              outlined
              size="small"
              @click="confirmDelete(tpl)"
            />
          </div>

          <div class="template-stats">
            <div class="stat-item">
              <i class="pi pi-list-check stat-icon" />
              <span class="stat-label">{{ tpl.fieldCount }} champ(s)</span>
            </div>
            <div v-if="tpl.createdAt" class="stat-item">
              <i class="pi pi-calendar stat-icon" />
              <span class="stat-label">{{ formatDate(tpl.createdAt) }}</span>
            </div>
          </div>

          <!-- Liste des champs (en lecture seule) - uniquement en mode détail -->
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <i class="pi pi-copy empty-icon" />
      <p class="empty-text">Aucun modèle de projet</p>
      <p class="empty-hint">
        Créez un modèle pour facilement répliquer des questionnaires sur plusieurs projets.
      </p>
      <NeoButton label="Créer mon premier modèle" icon="pi pi-plus" @click="openCreateDialog" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import Dialog from 'primevue/dialog'
import { NeoButton, NeoInputText, NeoSelect, NeoCheckbox, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import { useTemplateStore } from '@/stores/templateStore'
import { type FieldType } from '@/types/project.types'

const fieldTypes = [
  { label: 'Texte', value: 'Text' },
  { label: 'Nombre', value: 'Number' },
  { label: 'Date', value: 'Date' },
  { label: 'Liste', value: 'Select' },
  { label: 'Case à cocher', value: 'Checkbox' },
]

const store   = useTemplateStore()
const toast   = useNeoToast()
const confirm = useNeoConfirm()

const showCreateDialog = ref(false)
const saving           = ref(false)

interface FieldRow { uid: string; label: string; fieldType: FieldType; isRequired: boolean }
const form = reactive<{ name: string; description: string; fields: FieldRow[] }>({
  name: '',
  description: '',
  fields: [],
})

function openCreateDialog() {
  form.name = ''
  form.description = ''
  form.fields = []
  addFieldRow()
  showCreateDialog.value = true
}

function addFieldRow() {
  form.fields.push({ uid: crypto.randomUUID(), label: '', fieldType: 'Text', isRequired: false })
}

function removeField(index: number) {
  form.fields.splice(index, 1)
}

async function handleCreate() {
  if (!form.name.trim()) return
  saving.value = true
  try {
    const result = await store.createTemplate({
      name: form.name.trim(),
      description: form.description.trim() || null,
      fields: form.fields.filter(f => f.label.trim()).map((f, idx) => ({
        label: f.label.trim(),
        fieldType: f.fieldType,
        category: 'Custom',
        isRequired: f.isRequired,
        displayOrder: idx,
        options: null,
      })),
    })
    if (!result) throw new Error(store.error ?? 'Erreur inconnue')
    toast.add({ severity: 'success', detail: 'Modèle créé.', life: 3000 })
    showCreateDialog.value = false
  } catch {
    toast.add({ severity: 'error', detail: 'Erreur lors de la création.', life: 4000 })
  } finally {
    saving.value = false
  }
}

function confirmDelete(tpl: { id: string; name: string }) {
  confirm.require({
    message: `Supprimer le modèle « ${tpl.name} » ? Cette action est irréversible.`,
    header: 'Confirmer la suppression',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    accept: async () => {
      await store.deleteTemplate(tpl.id)
      toast.add({ severity: 'info', detail: 'Modèle supprimé.', life: 3000 })
    },
  })
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

onMounted(() => {
  if (!store.templates.length) void store.fetchTemplates()
})
</script>

<style scoped>
.section { display: flex; flex-direction: column; gap: 1rem; }

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}

.section-title  { font-size: 1.25rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.section-subtitle { font-size: 0.875rem; color: var(--nl-text-3); margin: 0.2rem 0 0; }

.loading-state { display: flex; justify-content: center; padding: 2rem; }

.create-form { display: flex; flex-direction: column; gap: 1rem; }

.fields-section { margin-top: 0.5rem; }
.fields-section h4 { font-size: 0.95rem; margin: 0 0 0.75rem; color: var(--nl-text-2); }

.field-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}

.template-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.template-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 10px;
}

.template-main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.template-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.template-name { font-size: 1.1rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.template-desc { font-size: 0.85rem; color: var(--nl-text-3); margin: 0.2rem 0 0; }

.template-stats {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--nl-text-3);
}
.stat-icon { color: var(--nl-accent); font-size: 0.9rem; }

.field-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.field-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  font-size: 0.82rem;
  color: var(--nl-text-2);
}
.field-name { font-weight: 500; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 3rem;
}
.empty-icon { font-size: 2.5rem; color: #cbd5e1; margin-bottom: 1rem; }
.empty-text { font-size: 1.1rem; font-weight: 600; color: var(--nl-text-2); margin: 0 0 0.25rem; }
.empty-hint { font-size: 0.875rem; color: var(--nl-text-3); max-width: 400px; margin: 0 0 1.25rem; }
</style>
