<!-- @file src/views/BudgetView.vue — Project budget + line items + burn report -->
<template>
  <ProjectModuleShell :project-id="id" title="Budget">
    <template #actions>
      <NeoButton label="Modifier budget" icon="pi pi-pencil" outlined @click="showEditBudget = true" />
      <NeoButton label="Ajouter ligne" icon="pi pi-plus" @click="showAddLine = true" />
    </template>

    <div class="bg" v-if="budgetStore.budget">
      <!-- Summary cards -->
      <div class="bg__summary">
        <div class="bg__card">
          <div class="bg__card-label">Budget total</div>
          <div class="bg__card-value">{{ format(total) }} {{ currency }}</div>
        </div>
        <div class="bg__card">
          <div class="bg__card-label">Dépensé</div>
          <div class="bg__card-value">{{ format(burn?.spent ?? 0) }} {{ currency }}</div>
          <NeoTag v-if="burn" :value="`${burn.percentUsed}%`" :severity="burn.percentUsed > 100 ? 'danger' : burn.percentUsed > 80 ? 'warn' : 'success'" />
        </div>
        <div class="bg__card">
          <div class="bg__card-label">Restant</div>
          <div class="bg__card-value">{{ format(burn?.remaining ?? total) }} {{ currency }}</div>
        </div>
        <div class="bg__card">
          <div class="bg__card-label">Lignes</div>
          <div class="bg__card-value">{{ budgetStore.budget.lineItems.length }}</div>
        </div>
      </div>

      <!-- Line items table -->
      <div class="bg__table-wrap">
        <table class="bg-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Type</th>
              <th class="bg-table__num">Coût unitaire</th>
              <th class="bg-table__num">Quantité</th>
              <th class="bg-table__num">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in budgetStore.budget.lineItems" :key="line.id">
              <td>{{ line.description }}</td>
              <td><NeoTag :value="line.type" severity="secondary" /></td>
              <td class="bg-table__num">{{ format(line.unitCost) }}</td>
              <td class="bg-table__num">{{ line.units }}</td>
              <td class="bg-table__num">{{ format(line.total) }}</td>
              <td>
                <NeoButton icon="pi pi-trash" text severity="danger" aria-label="Supprimer la ligne" @click="deleteLine(line.id)" />
              </td>
            </tr>
            <tr v-if="!budgetStore.budget.lineItems.length">
              <td colspan="6" class="bg-table__empty">Aucune ligne.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-else class="bg__loading">Chargement…</div>

  </ProjectModuleShell>

  <!-- Edit budget dialog -->
  <AppModal v-model:visible="showEditBudget" header="Modifier le budget" width="480px">
      <div class="bg__form">
        <NeoInputText v-model="budgetFormText.laborBudget" label="Budget main-d'œuvre" />
        <NeoInputText v-model="budgetFormText.materialBudget" label="Budget matériel" />
        <NeoInputText v-model="budgetFormText.currency" label="Devise (EUR, USD…)" />
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showEditBudget = false" />
        <NeoButton label="Enregistrer" icon="pi pi-check" @click="submitBudget" />
      </template>
    </AppModal>

    <!-- Add line dialog -->
    <AppModal v-model:visible="showAddLine" header="Nouvelle ligne" width="480px">
      <div class="bg__form">
        <NeoInputText v-model="lineForm.description" label="Description" />
        <NeoSelect v-model="lineForm.type" :options="typeOptions" optionLabel="label" optionValue="value" placeholder="Type" />
        <NeoInputText v-model="lineFormText.unitCost" label="Coût unitaire" />
        <NeoInputText v-model="lineFormText.units" label="Quantité" />
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showAddLine = false" />
        <NeoButton label="Ajouter" icon="pi pi-check" @click="submitLine" />
      </template>
    </AppModal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { NeoButton, NeoInputText, NeoSelect, NeoTag, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import { useBudgetStore } from '@/stores/budgetStore'

const props = defineProps<{ id: string }>()
const toast = useNeoToast()
const confirm = useNeoConfirm()
const budgetStore = useBudgetStore()

const showEditBudget = ref(false)
const showAddLine = ref(false)

const budgetFormText = reactive<{ laborBudget: string; materialBudget: string; currency: string }>({ laborBudget: '0', materialBudget: '0', currency: 'EUR' })
const lineForm = reactive<{ description: string; type: string }>({ description: '', type: 'material' })
const lineFormText = reactive<{ unitCost: string; units: string }>({ unitCost: '0', units: '1' })

const typeOptions = [
  { label: 'Matériel', value: 'material' },
  { label: 'Main d\'œuvre', value: 'labor' },
  { label: 'Service', value: 'service' },
]

const budget = computed(() => budgetStore.budget)
const burn = computed(() => budgetStore.burn)
const currency = computed(() => budget.value?.currency ?? 'EUR')
const total = computed(() => Number(budget.value?.laborBudget ?? 0) + Number(budget.value?.materialBudget ?? 0))

function format(n: number): string {
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function load() {
  await budgetStore.fetchBudget(props.id)
  if (!budget.value) {
    await budgetStore.upsertBudget(props.id, {})
  }
  await budgetStore.fetchBurn(props.id)
  if (budget.value) {
    budgetFormText.laborBudget = String(budget.value.laborBudget)
    budgetFormText.materialBudget = String(budget.value.materialBudget)
    budgetFormText.currency = budget.value.currency
  }
}

async function submitBudget() {
  await budgetStore.upsertBudget(props.id, {
    laborBudget: parseFloat(budgetFormText.laborBudget) || 0,
    materialBudget: parseFloat(budgetFormText.materialBudget) || 0,
    currency: budgetFormText.currency || 'EUR',
  })
  await budgetStore.fetchBurn(props.id)
  showEditBudget.value = false
  toast.add({ severity: 'success', detail: 'Budget enregistré.', life: 3000 })
}

async function submitLine() {
  if (!lineForm.description.trim()) return
  await budgetStore.createLineItem(props.id, {
    description: lineForm.description.trim(),
    type: lineForm.type,
    unitCost: parseFloat(lineFormText.unitCost) || 0,
    units: parseFloat(lineFormText.units) || 1,
  })
  await budgetStore.fetchBurn(props.id)
  showAddLine.value = false
  lineForm.description = ''
  lineFormText.unitCost = '0'
  lineFormText.units = '1'
  toast.add({ severity: 'success', detail: 'Ligne ajoutée.', life: 3000 })
}

function deleteLine(id: string) {
  confirm.require({
    message: 'Supprimer cette ligne ?',
    header: 'Confirmation',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await budgetStore.deleteLineItem(props.id, id)
      await budgetStore.fetchBurn(props.id)
      toast.add({ severity: 'success', detail: 'Supprimée.', life: 3000 })
    },
  })
}

onMounted(load)
</script>

<style scoped>
.bg-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); overflow-y: auto; }
.bg { padding: 1.5rem; }
.bg__summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
.bg__card {
  background: var(--nl-card-bg, #fff);
  padding: 1rem 1.25rem;
  border-radius: 8px;
  border: 1px solid var(--nl-border, #e5e7eb);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.bg__card-label { font-size: 0.75rem; font-weight: 600; color: var(--nl-text-muted, #6b7280); text-transform: uppercase; letter-spacing: 0.03em; }
.bg__card-value { font-size: 1.5rem; font-weight: 700; color: var(--nl-text, #111827); }
.bg__table-wrap { background: var(--nl-card-bg, #fff); border-radius: 8px; border: 1px solid var(--nl-border, #e5e7eb); overflow: hidden; }
.bg-table { width: 100%; border-collapse: collapse; }
.bg-table thead th {
  padding: 0.75rem 1rem;
  background: var(--nl-table-header-bg, #f3f4f6);
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
  text-align: left;
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--nl-text-muted, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.bg-table tbody tr { border-bottom: 1px solid var(--nl-border, #f3f4f6); }
.bg-table tbody td { padding: 0.75rem 1rem; font-size: 0.875rem; }
.bg-table__num { text-align: right; font-family: monospace; }
.bg-table__empty { text-align: center; color: var(--nl-text-muted, #9ca3af); padding: 2rem 1rem !important; }
.bg__form { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.5rem 0; }
.bg__loading { padding: 2rem; text-align: center; color: var(--nl-text-muted, #9ca3af); }
</style>
