<!--
  @file     PortalTokenTable.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Read-only token list table with hover-reveal actions
-->
<template>
  <table class="token-table">
    <thead>
      <tr>
        <th>Libellé</th>
        <th>Statut</th>
        <th>Expire le</th>
        <th>Accès</th>
        <th>Avis</th>
        <th class="token-table__th-right">Actions</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="t in tokens"
        :key="t.id"
        :class="['token-table__row', { 'token-table__row--revoked': t.isRevoked, 'token-table__row--expired': isExpired(t) }]"
      >
        <td class="token-table__label">{{ t.label || '(sans libellé)' }}</td>
        <td>
          <div class="token-table__status">
            <span v-if="t.isRevoked" class="token-table__badge token-table__badge--revoked">Révoqué</span>
            <span v-else-if="isExpired(t)" class="token-table__badge token-table__badge--expired">Expiré</span>
            <span v-else class="token-table__badge token-table__badge--active">
              <span class="token-table__dot" />
              Actif
            </span>
          </div>
        </td>
        <td class="token-table__meta">{{ formatDate(t.expiresAt) }}</td>
        <td class="token-table__meta">{{ t.accessCount }}</td>
        <td class="token-table__meta">{{ t.signoffCount || '—' }}</td>
        <td class="token-table__th-right">
          <div class="token-table__actions">
            <NeoButton
              v-if="!t.isRevoked && !isExpired(t)"
              icon="pi pi-copy"
              severity="secondary"
              text
              size="small"
              title="Copier le lien"
              @click="emit('copy', t)"
            />
            <NeoButton
              v-if="!t.isRevoked"
              icon="pi pi-ban"
              severity="danger"
              text
              size="small"
              title="Révoquer ce lien"
              :loading="revokingId === t.id"
              @click="emit('revoke', t.id)"
            />
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import { NeoButton } from '@neolibrary/components'

export interface TokenSummary {
  id: string
  token: string
  label: string | null
  url: string
  expiresAt: string
  isRevoked: boolean
  accessCount: number
  lastAccessedAt: string | null
  createdAt: string
  signoffCount: number
}

defineProps<{
  tokens: TokenSummary[]
  revokingId: string | null
}>()

const emit = defineEmits<{
  copy: [token: TokenSummary]
  revoke: [id: string]
}>()

function isExpired(t: TokenSummary): boolean {
  return !t.isRevoked && new Date(t.expiresAt) < new Date()
}

function formatDate(d: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(d))
}
</script>

<style scoped>
.token-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.token-table th {
  padding: 0 1rem;
  height: 32px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--nl-text-3);
  background: var(--nl-surface-2);
  border-bottom: 1px solid var(--nl-border);
  white-space: nowrap;
}

.token-table__th-right { text-align: right; }

.token-table td {
  padding: 0 1rem;
  height: 48px;
  border-bottom: 1px solid var(--nl-border);
  vertical-align: middle;
  color: var(--nl-text-2);
}

.token-table tr:last-child td { border-bottom: none; }

.token-table__row { transition: background 0.12s; }
.token-table__row:hover td { background: var(--nl-surface-2); }
.token-table__row--revoked td { opacity: 0.5; }
.token-table__row--expired td { opacity: 0.65; }

.token-table__label { font-weight: 600; color: var(--nl-text-1); }

.token-table__meta {
  color: var(--nl-text-3);
  font-size: 0.8125rem;
  white-space: nowrap;
}

/* ── Status badge ─────────────────────────────────────────────────────────── */
.token-table__status { display: flex; align-items: center; }

.token-table__badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: var(--nl-radius-pill);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.token-table__badge--active  { background: var(--nl-success-light); color: var(--nl-success); }
.token-table__badge--revoked { background: var(--nl-danger-light); color: var(--nl-danger); text-decoration: line-through; }
.token-table__badge--expired { background: var(--nl-surface-2); color: var(--nl-text-3); }

.token-table__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--nl-success);
  flex-shrink: 0;
}

/* ── Action menu (hover reveal) ──────────────────────────────────────────── */
.token-table__actions {
  display: flex;
  gap: 0.125rem;
  justify-content: flex-end;
  opacity: 0;
  transition: opacity 0.15s;
}

.token-table__row:hover .token-table__actions { opacity: 1; }
</style>
