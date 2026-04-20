<!-- @file src/views/BudgetView.vue — Project budget + line items + burn report -->
<template>
  <ProjectModuleShell :project-id="id" title="Budget">
    <template #actions>
      <NeoButton label="Modifier budget" icon="pi pi-pencil" outlined @click="showEditBudget = true" />
      <NeoButton label="Ajouter ligne" icon="pi pi-plus" @click="showAddLine = true" />
    </template>

    <div class="bg" v-if="budgetStore.budget">
      <!-- Summary cards + burn donut -->
      <div class="bg__overview">
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

        <!-- Burn progress bar + breakdown -->
        <div class="bg__burn">
          <div class="bg__burn-head">
            <span class="nl-section-title">Consommation</span>
            <span class="bg__burn-pct" :class="{ 'bg__burn-pct--danger': (burn?.percentUsed ?? 0) > 100, 'bg__burn-pct--warn': (burn?.percentUsed ?? 0) > 80 && (burn?.percentUsed ?? 0) <= 100 }">
              {{ burn?.percentUsed ?? 0 }}%
            </span>
          </div>
          <div class="bg__burn-bar">
            <div class="bg__burn-fill" :style="{ width: Math.min(100, burn?.percentUsed ?? 0) + '%', background: burnColor }" />
            <div v-if="(burn?.percentUsed ?? 0) > 100" class="bg__burn-overflow" />
          </div>
          <div class="bg__breakdown">
            <div v-for="b in breakdown" :key="b.type" class="bg__breakdown-row">
              <span class="bg__breakdown-dot" :style="{ background: b.color }" />
              <span class="bg__breakdown-label">{{ b.label }}</span>
              <span class="bg__breakdown-val">{{ format(b.total) }} {{ currency }}</span>
              <span class="bg__breakdown-pct">{{ Math.round((b.total / Math.max(1, total)) * 100) }}%</span>
            </div>
          </div>
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

const burnColor = computed<string>(() => {
  const pct = burn.value?.percentUsed ?? 0
  if (pct > 100) return 'var(--nl-danger)'
  if (pct > 80)  return 'var(--nl-warning)'
  return 'var(--nl-success)'
})

const BREAKDOWN_COLORS: Record<string, string> = {
  labor:    '#0F62FE',
  material: '#10B981',
  service:  '#F59E0B',
  other:    '#A855F7',
}
const BREAKDOWN_LABELS: Record<string, string> = {
  labor:    "Main-d'œuvre",
  material: 'Matériel',
  service:  'Service',
  other:    'Autre',
}

const breakdown = computed<{ type: string; label: string; color: string; total: number }[]>(() => {
  const lines = budget.value?.lineItems ?? []
  const map = new Map<string, number>()
  for (const l of lines) {
    const t = l.type || 'other'
    map.set(t, (map.get(t) ?? 0) + Number(l.total))
  }
  return Array.from(map.entries())
    .map(([type, total]) => ({
      type,
      label: BREAKDOWN_LABELS[type] ?? type,
      color: BREAKDOWN_COLORS[type] ?? '#6B7280',
      total,
    }))
    .sort((a, b) => b.total - a.total)
})

function format(n: number): string {
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function load() {
  await budgetStore.fetchBudget(props.id)
  if (budget.value) {
    await budgetStore.fetchBurn(props.id)
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
.bg__overview { display: grid; grid-template-columns: 1fr 320px; gap: var(--nl-sp-4); margin-bottom: var(--nl-sp-4); }
.bg__summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--nl-sp-3); }

.bg__burn {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  padding: var(--nl-sp-4);
  display: flex; flex-direction: column; gap: var(--nl-sp-3);
}
.bg__burn-head { display: flex; justify-content: space-between; align-items: baseline; }
.bg__burn-pct { font-size: var(--nl-fs-2xl); font-weight: 700; color: var(--nl-success); line-height: 1; }
.bg__burn-pct--warn   { color: var(--nl-warning); }
.bg__burn-pct--danger { color: var(--nl-danger); }
.bg__burn-bar {
  height: 8px; background: var(--nl-surface-2);
  border-radius: var(--nl-radius-pill); overflow: hidden;
  position: relative;
}
.bg__burn-fill { height: 100%; border-radius: inherit; transition: width 0.3s; }
.bg__burn-overflow {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(45deg, var(--nl-danger) 0 8px, color-mix(in srgb, var(--nl-danger) 60%, #000) 8px 16px);
  opacity: 0.35;
}
.bg__breakdown { display: flex; flex-direction: column; gap: var(--nl-sp-2); }
.bg__breakdown-row { display: grid; grid-template-columns: 8px 1fr auto auto; gap: var(--nl-sp-2); align-items: center; font-size: var(--nl-fs-sm); }
.bg__breakdown-dot { width: 8px; height: 8px; border-radius: 50%; }
.bg__breakdown-label { color: var(--nl-text-2); }
.bg__breakdown-val { color: var(--nl-text-1); font-weight: 600; font-family: var(--nl-font-mono); }
.bg__breakdown-pct { color: var(--nl-text-3); font-size: var(--nl-fs-xs); min-width: 30px; text-align: right; }

@media (max-width: 900px) {
  .bg__overview { grid-template-columns: 1fr; }
  .bg__summary { grid-template-columns: repeat(2, 1fr); }
}
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
