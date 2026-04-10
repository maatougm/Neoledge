<!--
  @file     SystemStatusSection.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-26
  @desc     État du système — DB status, user/project counts by status
-->
<template>
  <div class="section">
    <div class="section-header">
      <div>
        <h2 class="section-title">État du système</h2>
        <p class="section-sub">Vue d'ensemble des ressources</p>
      </div>
      <NeoButton label="Actualiser" icon="pi pi-refresh" outlined :loading="loading" @click="load" />
    </div>

    <div v-if="loading" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: #0d9488" />
    </div>

    <template v-else-if="status">
      <!-- KPI cards -->
      <div class="kpi-grid">
        <div class="kpi-card kpi-card--green">
          <i class="pi pi-database kpi-icon" />
          <div class="kpi-body">
            <p class="kpi-label">Base de données</p>
            <p class="kpi-value">{{ status.databaseStatus }}</p>
          </div>
        </div>
        <div class="kpi-card">
          <i class="pi pi-users kpi-icon" />
          <div class="kpi-body">
            <p class="kpi-label">Utilisateurs actifs</p>
            <p class="kpi-value">{{ status.userActive }} <span class="kpi-total">/ {{ status.userTotal }}</span></p>
          </div>
        </div>
        <div class="kpi-card">
          <i class="pi pi-folder kpi-icon" />
          <div class="kpi-body">
            <p class="kpi-label">Projets au total</p>
            <p class="kpi-value">{{ status.projectTotal }}</p>
          </div>
        </div>
      </div>

      <!-- Projects by status -->
      <div class="status-breakdown">
        <h3 class="breakdown-title">Répartition des projets par statut</h3>
        <div class="breakdown-list">
          <div
            v-for="(count, statusKey) in status.projectByStatus"
            :key="statusKey"
            class="breakdown-row"
          >
            <NeoTag
              :value="PROJECT_STATUS_LABELS[statusKey as ProjectStatus] ?? statusKey"
              :severity="statusSeverity(statusKey as ProjectStatus)"
            />
            <div class="breakdown-bar-wrap">
              <div
                class="breakdown-bar"
                :style="{ width: barWidth(count, status.projectTotal) }"
              />
            </div>
            <span class="breakdown-count">{{ count }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoButton, NeoTag } from '@neolibrary/components'
import api from '@/lib/api'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_SEVERITY } from '@/types/project.types'
import type { ProjectStatus } from '@/types/project.types'

interface SystemStatus {
  databaseStatus: string
  userTotal: number
  userActive: number
  projectTotal: number
  projectByStatus: Record<string, number>
}

const status  = ref<SystemStatus | null>(null)
const loading = ref(false)

const load = async () => {
  loading.value = true
  try {
    const { data } = await api.get<SystemStatus>('/admin/SystemStatus')
    status.value = data
  } finally {
    loading.value = false
  }
}

const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

const barWidth = (count: number, total: number) =>
  total === 0 ? '0%' : `${Math.round((count / total) * 100)}%`

onMounted(load)
</script>

<style scoped>
.section { display: flex; flex-direction: column; gap: 1.5rem; }

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}

.section-title { font-size: 1.25rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.section-sub   { font-size: 0.85rem; color: var(--nl-text-3); margin: 0.2rem 0 0; }

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3rem;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}

.kpi-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.kpi-card--green { border-left: 4px solid #10b981; }

.kpi-icon {
  font-size: 1.75rem;
  color: var(--nl-accent);
  flex-shrink: 0;
}

.kpi-label { font-size: 0.8rem; color: var(--nl-text-3); margin: 0; }
.kpi-value { font-size: 1.5rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.kpi-total { font-size: 0.9rem; font-weight: 400; color: var(--nl-text-3); }

.status-breakdown {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
}

.breakdown-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--nl-text-2);
  margin: 0 0 1rem;
}

.breakdown-list { display: flex; flex-direction: column; gap: 0.6rem; }

.breakdown-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.breakdown-bar-wrap {
  flex: 1;
  background: var(--nl-surface-2);
  border-radius: 4px;
  height: 8px;
  overflow: hidden;
}

.breakdown-bar {
  height: 100%;
  background: var(--nl-accent);
  border-radius: 4px;
  transition: width 0.4s ease;
  min-width: 4px;
}

.breakdown-count {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--nl-text-2);
  min-width: 24px;
  text-align: right;
}
</style>
