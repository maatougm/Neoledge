<!-- @file src/views/TeamPlannerView.vue — Team capacity + assignments -->
<template>
  <div class="tp-view">
    <ModulePageHeader title="Planification d'équipe">
      <template #actions>
        <NeoDatePicker v-model="fromDate" dateFormat="yy-mm-dd" placeholder="Du" />
        <NeoDatePicker v-model="toDate" dateFormat="yy-mm-dd" placeholder="Au" />
        <NeoButton label="Rafraîchir" icon="pi pi-refresh" @click="load" />
      </template>
    </ModulePageHeader>

    <div class="tp-tabs">
      <button
        v-for="t in tabs"
        :key="t"
        class="tp-tab"
        :class="{ 'tp-tab--active': activeTab === t }"
        @click="activeTab = t"
      >{{ t }}</button>
    </div>

    <div class="tp-content">
      <!-- Capacity heatmap -->
      <div v-if="activeTab === 'Capacité'">
        <div v-if="store.capacity.length" class="tp-heatmap">
          <div
            v-for="entry in store.capacity"
            :key="entry.user.id"
            class="tp-heatmap__row"
          >
            <div class="tp-heatmap__name">{{ entry.user.firstName }} {{ entry.user.lastName }}</div>
            <div class="tp-heatmap__bar">
              <div
                class="tp-heatmap__fill"
                :class="fillClass(entry.utilizationPercent)"
                :style="{ width: Math.min(100, entry.utilizationPercent) + '%' }"
              />
            </div>
            <div class="tp-heatmap__meta">
              {{ entry.allocatedHours }} / {{ entry.capacityHours }}h ({{ entry.utilizationPercent }}%)
            </div>
          </div>
        </div>
        <div v-else class="tp-empty">Aucune donnée.</div>
      </div>

      <!-- Assignments -->
      <div v-if="activeTab === 'Assignations'">
        <div v-for="u in store.assignments" :key="u.user.id" class="tp-user">
          <h3>{{ u.user.firstName }} {{ u.user.lastName }}</h3>
          <table class="tp-table">
            <thead>
              <tr><th>Work Package</th><th>Début</th><th>Fin</th><th>Statut</th></tr>
            </thead>
            <tbody>
              <tr v-for="wp in u.items" :key="wp.id">
                <td>{{ wp.title }}</td>
                <td>{{ wp.startDate ? formatDate(wp.startDate) : '—' }}</td>
                <td>{{ wp.dueDate ? formatDate(wp.dueDate) : '—' }}</td>
                <td><NeoTag :value="wp.status" severity="info" /></td>
              </tr>
              <tr v-if="!u.items.length"><td colspan="4" class="tp-empty">Aucune assignation.</td></tr>
            </tbody>
          </table>
        </div>
        <div v-if="!store.assignments.length" class="tp-empty">Aucune assignation sur la période.</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoButton, NeoDatePicker, NeoTag, useNeoToast } from '@neolibrary/components'
import ModulePageHeader from '@/components/common/ModulePageHeader.vue'
import { useTeamPlannerStore } from '@/stores/teamPlannerStore'
import { formatDateShort } from '@/lib/formatDate'

const store = useTeamPlannerStore()
const toast = useNeoToast()

const tabs = ['Capacité', 'Assignations'] as const
const activeTab = ref<(typeof tabs)[number]>('Capacité')

const today = new Date()
const monthFromNow = new Date(today)
monthFromNow.setDate(today.getDate() + 30)

const fromDate = ref<string>(today.toISOString().slice(0, 10))
const toDate = ref<string>(monthFromNow.toISOString().slice(0, 10))

function formatDate(iso: string): string {
  return formatDateShort(iso)
}

function fillClass(pct: number): string {
  if (pct > 100) return 'tp-heatmap__fill--over'
  if (pct > 80) return 'tp-heatmap__fill--high'
  return 'tp-heatmap__fill--normal'
}

async function load() {
  if (!fromDate.value || !toDate.value) return
  if (fromDate.value > toDate.value) {
    toast.add({ severity: 'warn', detail: 'La date de début doit être antérieure à la date de fin.', life: 3000 })
    return
  }
  await Promise.all([
    store.fetchCapacity(fromDate.value, toDate.value),
    store.fetchAssignments(fromDate.value, toDate.value),
  ])
}

onMounted(load)
</script>

<style scoped>
.tp-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.tp-tabs { display: flex; gap: 0.25rem; padding: 0 1.5rem; background: var(--nl-card-bg, #fff); border-bottom: 1px solid var(--nl-border, #e5e7eb); }
.tp-tab {
  background: transparent; border: none;
  padding: 0.75rem 1rem; font-size: 0.875rem; color: var(--nl-text-muted, #6b7280);
  cursor: pointer; border-bottom: 2px solid transparent;
}
.tp-tab--active { color: var(--nl-accent, #1e9e8f); border-bottom-color: var(--nl-accent, #1e9e8f); font-weight: 600; }
.tp-content { flex: 1; overflow-y: auto; padding: 1rem 1.5rem; }
.tp-heatmap { background: var(--nl-card-bg, #fff); border-radius: 8px; overflow: hidden; border: 1px solid var(--nl-border, #e5e7eb); }
.tp-heatmap__row { display: grid; grid-template-columns: 200px 1fr 180px; align-items: center; gap: 1rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--nl-border, #f3f4f6); }
.tp-heatmap__name { font-weight: 500; font-size: 0.875rem; }
.tp-heatmap__bar { height: 16px; background: var(--nl-border, #e5e7eb); border-radius: 8px; overflow: hidden; }
.tp-heatmap__fill { height: 100%; transition: width 0.3s; }
.tp-heatmap__fill--normal { background: #10b981; }
.tp-heatmap__fill--high { background: #f59e0b; }
.tp-heatmap__fill--over { background: #ef4444; }
.tp-heatmap__meta { text-align: right; font-size: 0.8125rem; color: var(--nl-text-muted, #6b7280); font-family: monospace; }
.tp-user { background: var(--nl-card-bg, #fff); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; border: 1px solid var(--nl-border, #e5e7eb); }
.tp-user h3 { margin: 0 0 0.75rem; font-size: 1rem; }
.tp-table { width: 100%; border-collapse: collapse; }
.tp-table th, .tp-table td { padding: 0.5rem 0.75rem; text-align: left; font-size: 0.8125rem; border-bottom: 1px solid var(--nl-border, #f3f4f6); }
.tp-table th { background: var(--nl-table-header-bg, #f3f4f6); font-weight: 600; color: var(--nl-text-muted, #6b7280); font-size: 0.75rem; text-transform: uppercase; }
.tp-empty { text-align: center; color: var(--nl-text-muted, #9ca3af); padding: 2rem !important; }
</style>
