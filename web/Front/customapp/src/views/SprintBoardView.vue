<!-- @file src/views/SprintBoardView.vue — Sprint board with burndown chart -->
<template>
  <ProjectModuleShell :project-id="id" :title="`Sprint: ${activeSprint?.name ?? '—'}`">
    <template #actions>
      <NeoSelect
        v-model="activeSprintId"
        :options="sprintOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Sprint"
      />
      <NeoButton v-if="activeSprint?.status === 'Planning'" label="Démarrer" icon="pi pi-play" @click="start" />
      <NeoButton v-if="activeSprint?.status === 'Active'" label="Clôturer" icon="pi pi-check" outlined @click="close" />
    </template>

    <div v-if="activeSprint" class="sb">
      <!-- Sprint meta -->
      <div class="sb__meta">
        <div class="sb__meta-item">
          <label>Statut</label>
          <NeoTag :value="activeSprint.status" :severity="activeSprint.status === 'Active' ? 'info' : activeSprint.status === 'Closed' ? 'success' : 'secondary'" />
        </div>
        <div class="sb__meta-item">
          <label>Dates</label>
          <span>{{ formatDate(activeSprint.startDate) }} → {{ formatDate(activeSprint.endDate) }}</span>
        </div>
        <div class="sb__meta-item" v-if="activeSprint.goal">
          <label>Objectif</label>
          <span>{{ activeSprint.goal }}</span>
        </div>
      </div>

      <!-- Burndown + WP list side by side -->
      <div class="sb__grid">
        <div class="sb__card">
          <h3>Burndown</h3>
          <div class="sb__chart">
            <canvas ref="chartRef" />
          </div>
        </div>

        <div class="sb__card">
          <h3>Work Packages</h3>
          <table class="sb-table">
            <thead>
              <tr><th>Titre</th><th>Statut</th><th>%</th></tr>
            </thead>
            <tbody>
              <tr v-for="wp in sprintWps" :key="wp.id">
                <td>{{ wp.title }}</td>
                <td><NeoTag :value="wp.status" severity="info" /></td>
                <td>{{ wp.percentDone }}%</td>
              </tr>
              <tr v-if="!sprintWps.length"><td colspan="3" class="sb-empty">Aucun WP.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div v-else class="sb-empty">Sélectionnez un sprint.</div>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { NeoButton, NeoSelect, NeoTag, useNeoToast } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import { formatDateShort as formatDate } from '@/lib/formatDate'
import { useAgileStore } from '@/stores/agileStore'
import { useWorkPackageStore } from '@/stores/workPackageStore'
import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

const props = defineProps<{ id: string }>()
const toast = useNeoToast()
const agileStore = useAgileStore()
const wpStore = useWorkPackageStore()

const activeSprintId = ref<string | null>(null)
const chartRef = ref<HTMLCanvasElement | null>(null)
let chartInstance: Chart | null = null

const activeSprint = computed(() => agileStore.sprints.find((s) => s.id === activeSprintId.value) ?? null)
const sprintWps = computed(() => wpStore.items.filter((w) => w.sprintId === activeSprintId.value))
const sprintOptions = computed(() => agileStore.sprints.map((s) => ({ label: `${s.name} (${s.status})`, value: s.id })))

async function load() {
  await wpStore.fetchAll(props.id)
  await agileStore.fetchBoards(props.id)
  if (agileStore.boards.length) {
    await agileStore.fetchSprints(props.id, agileStore.boards[0].id)
    if (agileStore.sprints.length && !activeSprintId.value) {
      activeSprintId.value = agileStore.sprints[0].id
    }
  }
}

async function loadBurndown() {
  if (!activeSprintId.value) return
  await agileStore.fetchBurndown(props.id, activeSprintId.value)
  await nextTick()
  renderChart()
}

function renderChart() {
  if (!chartRef.value || !agileStore.burndown) return
  const data = agileStore.burndown.days
  chartInstance?.destroy()
  chartInstance = new Chart(chartRef.value, {
    type: 'line',
    data: {
      labels: data.map((d) => d.date),
      datasets: [
        {
          label: 'Idéal',
          data: data.map((d) => d.ideal),
          borderColor: '#9ca3af',
          borderDash: [5, 5],
          fill: false,
          tension: 0,
        },
        {
          label: 'Restant',
          data: data.map((d) => d.remaining),
          borderColor: '#1e9e8f',
          backgroundColor: 'rgba(30,158,143,0.15)',
          fill: true,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: 'Heures' } } },
    },
  })
}

async function start() {
  if (!activeSprintId.value) return
  await agileStore.startSprint(props.id, activeSprintId.value)
  toast.add({ severity: 'success', detail: 'Sprint démarré.', life: 3000 })
}

async function close() {
  if (!activeSprintId.value) return
  await agileStore.closeSprint(props.id, activeSprintId.value)
  toast.add({ severity: 'success', detail: 'Sprint clôturé.', life: 3000 })
}

watch(activeSprintId, loadBurndown)
onMounted(async () => {
  await load()
  await loadBurndown()
})
onUnmounted(() => { chartInstance?.destroy(); chartInstance = null })
</script>

<style scoped>
.sb-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.sb { padding: 1rem 1.5rem; overflow-y: auto; flex: 1; }
.sb__meta {
  display: flex;
  gap: 2rem;
  padding: 1rem 1.5rem;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  margin-bottom: 1rem;
}
.sb__meta-item { display: flex; flex-direction: column; gap: 0.25rem; }
.sb__meta-item label {
  font-size: 0.75rem; font-weight: 600; color: var(--nl-text-muted, #6b7280);
  text-transform: uppercase; letter-spacing: 0.03em;
}
.sb__grid { display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; }
.sb__card {
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  padding: 1rem 1.25rem;
}
.sb__card h3 { margin: 0 0 0.75rem; font-size: 1rem; }
.sb__chart { height: 280px; position: relative; }
.sb-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.sb-table th, .sb-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--nl-border, #f3f4f6); text-align: left; }
.sb-table th { background: var(--nl-table-header-bg, #f3f4f6); font-size: 0.75rem; font-weight: 600; color: var(--nl-text-muted, #6b7280); text-transform: uppercase; }
.sb-empty { text-align: center; color: var(--nl-text-muted, #9ca3af); padding: 2rem; }
</style>
