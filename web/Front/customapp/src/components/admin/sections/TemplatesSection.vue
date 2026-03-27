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
    <Dialog v-model:visible="showCreateDialog" header="Nouveau modèle" :modal="true" style="width: 600px">
      <div class="create-form">
        <NeoInputText v-model="form.name" label="Nom du modèle" placeholder="Ex : Modèle NeoLeadge standard" class="w-full" />
        <NeoInputText v-model="form.description" label="Description (optionnel)" placeholder="Description courte" class="w-full" />

        <div class="fields-block">
          <div class="fields-block-header">
            <span class="fields-block-title">Champs du modèle</span>
            <NeoButton label="Ajouter un champ" icon="pi pi-plus" outlined size="small" @click="addRow" />
          </div>
          <div v-for="(row, idx) in form.fields" :key="idx" class="field-row">
            <NeoInputText v-model="row.label" placeholder="Libellé" class="flex-2" />
            <NeoSelect
              v-model="row.fieldType"
              :options="fieldTypeOptions"
              optionLabel="label"
              optionValue="value"
              style="min-width:120px"
            />
            <NeoCheckbox :modelValue="(row.isRequired as unknown as any[])" @update:modelValue="v => row.isRequired = (v as unknown as boolean)" binary />
            <button class="remove-row-btn" @click="removeRow(idx)" title="Supprimer">
              <i class="pi pi-times" />
            </button>
          </div>
          <div v-if="form.fields.length === 0" class="no-fields">Aucun champ ajouté.</div>
        </div>
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showCreateDialog = false" />
        <NeoButton label="Créer" :loading="saving" :disabled="!form.name.trim()" @click="handleCreate" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import Dialog from 'primevue/dialog'
import { NeoButton, NeoInputText, NeoSelect, NeoCheckbox, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import { useProjectStore } from '@/stores/projectStore'

const store   = useProjectStore()
const toast   = useNeoToast()
const confirm = useNeoConfirm()

const showCreateDialog = ref(false)
const saving = ref(false)

const fieldTypeOptions = [
  { value: 'Text',     label: 'Texte' },
  { value: 'Number',   label: 'Nombre' },
  { value: 'Date',     label: 'Date' },
  { value: 'Select',   label: 'Liste' },
  { value: 'Checkbox', label: 'Case à cocher' },
]

const emptyForm = () => ({ name: '', description: '', fields: [] as Array<{ label: string; fieldType: string; isRequired: boolean }> })
const form = reactive(emptyForm())

onMounted(() => store.fetchTemplates())

function addRow() {
  form.fields.push({ label: '', fieldType: 'Text', isRequired: false })
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
    await store.createTemplate({
      name: form.name.trim(),
      description: form.description.trim() || null,
      fields: form.fields.map((f, i) => ({
        label: f.label,
        fieldType: f.fieldType,
        category: 'Custom',
        isRequired: f.isRequired,
        displayOrder: i + 1,
        options: null,
      })),
    })
    toast.add({ severity: 'success', detail: `Modèle « ${form.name} » créé.`, life: 3000 })
    showCreateDialog.value = false
    Object.assign(form, emptyForm())
  } catch {
    toast.add({ severity: 'error', detail: 'Erreur lors de la création du modèle.', life: 4000 })
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
</script>

<style scoped>
.templates-section { display: flex; flex-direction: column; gap: 1.5rem; }

.section-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 1rem; }
.section-title  { font-size: 1.25rem; font-weight: 800; color: #111827; margin: 0; }
.section-sub    { font-size: 0.875rem; color: #6b7280; margin: 0.25rem 0 0; }

.loading-state, .empty-state {
  display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
  padding: 3rem; color: #94a3b8; font-size: 0.875rem; text-align: center;
}

.table-wrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }

.data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.data-table th {
  background: #f9fafb; padding: 0.75rem 1rem;
  text-align: left; font-size: 0.78rem; font-weight: 600;
  color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;
  border-bottom: 1px solid #e5e7eb;
}
.data-table td { padding: 0.75rem 1rem; border-bottom: 1px solid #f3f4f6; color: #374151; }
.data-table tr:last-child td { border-bottom: none; }
.td-name { font-weight: 600; color: #111827; }
.td-desc { color: #6b7280; max-width: 240px; }
.td-actions { text-align: right; }

.create-form { display: flex; flex-direction: column; gap: 1rem; padding: 0.5rem 0; }

.fields-block {
  border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;
}
.fields-block-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1rem; background: #f9fafb; border-bottom: 1px solid #e5e7eb;
}
.fields-block-title { font-size: 0.875rem; font-weight: 600; color: #374151; }

.field-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.6rem 1rem; border-bottom: 1px solid #f3f4f6; flex-wrap: wrap;
}
.field-row:last-child { border-bottom: none; }
.flex-2 { flex: 2; min-width: 120px; }

.remove-row-btn {
  background: none; border: none; color: #ef4444; cursor: pointer;
  padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.8rem;
  transition: background 0.15s;
}
.remove-row-btn:hover { background: #fee2e2; }

.no-fields { padding: 1rem; text-align: center; color: #9ca3af; font-size: 0.875rem; }
</style>
