<!-- @file AuditLogView.vue — Admin audit log viewer -->
<template>
  <div class="audit-view">
    <ModulePageHeader title="Journal d'audit">
      <template #actions>
        <NeoSelect
          v-model="filters.entityType"
          :options="entityOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les types"
        />
        <NeoButton label="Rafraîchir" icon="pi pi-refresh" outlined @click="load" />
      </template>
    </ModulePageHeader>

    <div class="audit-content">
      <table class="audit-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Entité</th>
            <th>Action</th>
            <th>Utilisateur</th>
            <th>ID entité</th>
            <th>Détails</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log.id">
            <td class="audit-table__date">{{ formatDateTime(log.createdAt) }}</td>
            <td><NeoTag :value="log.entityType" severity="info" /></td>
            <td>{{ log.action }}</td>
            <td>{{ log.userId ? log.userId.slice(0, 8) + '…' : '—' }}</td>
            <td class="audit-table__entity-id">{{ log.entityId.slice(0, 8) }}…</td>
            <td class="audit-table__meta" :title="log.changes || log.metadata || ''">
              {{ truncate(log.changes || log.metadata || '—') }}
            </td>
          </tr>
          <tr v-if="!logs.length"><td colspan="6" class="audit-empty">Aucune entrée.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { NeoButton, NeoSelect, NeoTag } from '@neolibrary/components'
import ModulePageHeader from '@/components/common/ModulePageHeader.vue'
import { formatDateTime } from '@/lib/formatDate'
import api from '@/lib/api'

interface AuditLog {
  id: string
  entityType: string
  entityId: string
  action: string
  userId: string | null
  changes: string | null
  metadata: string | null
  createdAt: string
}

const logs = ref<AuditLog[]>([])
const filters = reactive<{ entityType: string }>({ entityType: '' })

const entityOptions = [
  { label: 'Tous les types', value: '' },
  { label: 'Project', value: 'Project' },
  { label: 'AppUser', value: 'AppUser' },
  { label: 'WorkPackage', value: 'WorkPackage' },
  { label: 'Meeting', value: 'Meeting' },
]

async function load() {
  const params = new URLSearchParams({ limit: '100' })
  if (filters.entityType) params.append('entityType', filters.entityType)
  const { data } = await api.get<AuditLog[]>(`/api/audit?${params.toString()}`)
  logs.value = Array.isArray(data) ? data : []
}

function truncate(s: string): string {
  if (!s) return '—'
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

onMounted(load)
</script>

<style scoped>
.audit-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.audit-content { flex: 1; overflow-y: auto; padding: 1.5rem; }
.audit-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--nl-card-bg, #fff);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--nl-border, #e5e7eb);
  font-size: 0.875rem;
}
.audit-table th {
  padding: 0.75rem 1rem;
  background: var(--nl-table-header-bg, #f3f4f6);
  text-align: left;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--nl-text-muted, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
}
.audit-table td { padding: 0.5rem 1rem; border-bottom: 1px solid var(--nl-border, #f3f4f6); vertical-align: middle; }
.audit-table__date { white-space: nowrap; color: var(--nl-text-muted, #6b7280); font-size: 0.8125rem; }
.audit-table__entity-id { font-family: monospace; font-size: 0.75rem; color: var(--nl-text-muted, #9ca3af); }
.audit-table__meta { color: var(--nl-text-muted, #6b7280); font-size: 0.8125rem; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.audit-empty { text-align: center; color: var(--nl-text-muted, #9ca3af); padding: 2rem !important; }
</style>
