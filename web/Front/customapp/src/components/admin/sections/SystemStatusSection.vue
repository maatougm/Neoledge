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
      <!-- Health cards -->
      <div class="kpi-grid">
        <div class="kpi-card kpi-card--green">
          <i class="pi pi-server kpi-icon" style="color:#10b981" />
          <div class="kpi-body">
            <p class="kpi-label">Serveur</p>
            <p class="kpi-value">En ligne</p>
            <p class="kpi-hint">depuis {{ formatUptime(status.uptimeSeconds) }} · {{ status.memoryUsedMb }} Mo · {{ status.nodeVersion }}</p>
          </div>
        </div>
        <div class="kpi-card" :class="status.databaseStatus === 'Connecté' ? 'kpi-card--green' : 'kpi-card--red'">
          <i class="pi pi-database kpi-icon" />
          <div class="kpi-body">
            <p class="kpi-label">Base de données</p>
            <p class="kpi-value">{{ status.databaseStatus }}</p>
          </div>
        </div>
        <div class="kpi-card" :class="depClass(status.transcriptionStatus)">
          <i class="pi pi-microphone kpi-icon" />
          <div class="kpi-body">
            <p class="kpi-label">Service transcription</p>
            <p class="kpi-value">{{ status.transcriptionStatus }}</p>
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

      <!-- Security / attack surface -->
      <div class="security-grid">
        <div class="kpi-card" :class="status.security.lockedAccounts > 0 ? 'kpi-card--red' : ''">
          <i class="pi pi-lock kpi-icon" :style="status.security.lockedAccounts > 0 ? 'color:#dc2626' : ''" />
          <div class="kpi-body">
            <p class="kpi-label">Comptes verrouillés</p>
            <p class="kpi-value">{{ status.security.lockedAccounts }}</p>
          </div>
        </div>
        <div class="kpi-card" :class="status.security.accountsUnderAttack > 0 ? 'kpi-card--amber' : ''">
          <i class="pi pi-shield kpi-icon" :style="status.security.accountsUnderAttack > 0 ? 'color:#d97706' : ''" />
          <div class="kpi-body">
            <p class="kpi-label">Comptes sous attaque</p>
            <p class="kpi-value">{{ status.security.accountsUnderAttack }}</p>
            <p class="kpi-hint">{{ status.security.failedLoginsCurrent }} tentative(s) échouée(s) en cours</p>
          </div>
        </div>
        <div class="kpi-card">
          <i class="pi pi-sign-in kpi-icon" />
          <div class="kpi-body">
            <p class="kpi-label">Connexions (24 h)</p>
            <p class="kpi-value">{{ status.security.logins24h }}</p>
          </div>
        </div>
      </div>

      <!-- Recent security events -->
      <div class="status-breakdown" v-if="status.security.recentEvents.length">
        <h3 class="breakdown-title">Évènements de sécurité récents</h3>
        <div class="event-list">
          <div v-for="(e, i) in status.security.recentEvents" :key="i" class="event-row">
            <NeoTag :value="actionLabel(e.action)" :severity="actionSeverity(e.action)" />
            <span class="event-user">{{ e.userEmail ?? '—' }}</span>
            <span class="event-time">{{ formatTime(e.createdAt) }}</span>
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

interface SecurityEvent {
  action: string
  userEmail: string | null
  createdAt: string
}

interface SystemStatus {
  serverStatus: 'up'
  uptimeSeconds: number
  memoryUsedMb: number
  nodeVersion: string
  databaseStatus: string
  transcriptionStatus: string
  userTotal: number
  userActive: number
  projectTotal: number
  projectByStatus: Record<string, number>
  security: {
    lockedAccounts: number
    accountsUnderAttack: number
    logins24h: number
    failedLoginsCurrent: number
    recentEvents: SecurityEvent[]
  }
}

const status  = ref<SystemStatus | null>(null)
const loading = ref(false)

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}j ${h}h`
  if (h > 0) return `${h}h ${m}min`
  return `${m}min`
}

function depClass(s: string): string {
  if (s === 'Connecté') return 'kpi-card--green'
  if (s === 'Désactivé') return ''
  return 'kpi-card--amber'
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Connexion', LOGOUT: 'Déconnexion', RESET_PASSWORD: 'Réinit. mot de passe',
  TOTP_ENABLED: 'A2F activée', TOTP_DISABLED: 'A2F désactivée',
}
const actionLabel = (a: string): string => ACTION_LABELS[a] ?? a
const actionSeverity = (a: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' => {
  if (a === 'LOGIN') return 'success'
  if (a === 'RESET_PASSWORD' || a === 'TOTP_DISABLED') return 'warn'
  if (a === 'LOGOUT') return 'secondary'
  return 'info'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000)
  if (diffMin < 1) return "à l'instant"
  if (diffMin < 60) return `il y a ${diffMin} min`
  if (diffMin < 1440) return `il y a ${Math.round(diffMin / 60)} h`
  return d.toLocaleDateString('fr-FR')
}

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
.kpi-card--red   { border-left: 4px solid #dc2626; }
.kpi-card--amber { border-left: 4px solid #d97706; }

.kpi-hint { font-size: 0.72rem; color: var(--nl-text-3); margin: 0.25rem 0 0; }

.security-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1rem;
}

.event-list { display: flex; flex-direction: column; gap: 0.5rem; }
.event-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--nl-border);
}
.event-row:last-child { border-bottom: none; }
.event-user { flex: 1; font-size: 0.85rem; color: var(--nl-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event-time { font-size: 0.75rem; color: var(--nl-text-3); white-space: nowrap; }

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
