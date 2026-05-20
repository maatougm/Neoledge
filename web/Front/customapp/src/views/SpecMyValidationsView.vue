<!-- @file src/views/SpecMyValidationsView.vue — Spec team: history of cahiers I've reviewed (approved/rejected) -->
<template>
  <div class="spec-reviews-view">
    <ModulePageHeader title="Mes validations">
      <template #actions>
        <NeoButton
          label="Rafraîchir"
          icon="pi pi-refresh"
          outlined
          :loading="loading"
          @click="load"
        />
      </template>
    </ModulePageHeader>

    <div class="spec-reviews-content">
      <!-- Loading state -->
      <div v-if="loading" class="spec-reviews-loading">
        <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: #0d9488" />
        <span class="spec-reviews-loading__label">Chargement…</span>
      </div>

      <!-- Empty state -->
      <NeoMessage
        v-else-if="rows.length === 0"
        severity="info"
        text="Vous n'avez encore validé aucun cahier des charges."
        class="spec-reviews-empty"
      />

      <!-- Data table -->
      <table v-else class="spec-reviews-table">
        <thead>
          <tr>
            <th>Projet</th>
            <th>Verdict</th>
            <th>Examiné le</th>
            <th>Statut actuel</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.projectId">
            <td>
              <div class="spec-reviews-table__project-name">{{ row.projectName }}</div>
              <div class="spec-reviews-table__client-name">{{ row.clientName }}</div>
            </td>

            <td>
              <NeoTag
                :value="row.verdict === 'approved' ? 'Approuvé' : 'Rejeté'"
                :severity="row.verdict === 'approved' ? 'success' : 'danger'"
              />
            </td>

            <td class="spec-reviews-table__date">
              {{ formatRelative(row.reviewedAt) }}
            </td>

            <!-- Whether the verdict still applies to the currently-saved cahier -->
            <td>
              <NeoTag
                v-if="row.isCurrent"
                value="À jour"
                severity="info"
              />
              <NeoTag
                v-else
                value="Cahier régénéré depuis"
                severity="warn"
              />
            </td>

            <td>
              <NeoButton
                label="Voir"
                icon="pi pi-eye"
                outlined
                @click="openProject(row.projectId)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NeoButton, NeoTag, NeoMessage, useNeoToast } from '@neolibrary/components'
import ModulePageHeader from '@/components/common/ModulePageHeader.vue'
import api from '@/lib/api'
import { formatRelative } from '@/lib/formatDate'

interface MyReviewRow {
  projectId: string
  projectName: string
  clientName: string
  phase: string
  verdict: 'approved' | 'rejected'
  comment: string | null
  reviewedAt: string
  cahierSavedAt: string | null
  isCurrent: boolean
}

const router = useRouter()
const toast = useNeoToast()

const rows = ref<MyReviewRow[]>([])
const loading = ref(false)

function openProject(projectId: string): void {
  const routes = router.getRoutes().map((r) => r.name)
  const target = routes.includes('team-project-detail')
    ? 'team-project-detail'
    : 'pm-project-detail'
  router.push({ name: target, params: { id: projectId } })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const { data } = await api.get<MyReviewRow[]>('/spec/my-reviews')
    rows.value = Array.isArray(data) ? data : []
  } catch {
    toast.add({
      severity: 'error',
      detail: 'Impossible de charger vos validations. Veuillez réessayer.',
      life: 4000,
    })
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.spec-reviews-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--nl-bg, #f5f7f9);
}

.spec-reviews-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.spec-reviews-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 3rem;
  color: #0d9488;
}

.spec-reviews-loading__label {
  font-size: 0.9rem;
  color: var(--nl-text-2, #6b7280);
}

.spec-reviews-empty {
  margin: 0 auto;
  max-width: 520px;
}

.spec-reviews-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--nl-card-bg, #fff);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--nl-border, #e5e7eb);
  font-size: 0.875rem;
}

.spec-reviews-table th {
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

.spec-reviews-table td {
  padding: 0.625rem 1rem;
  border-bottom: 1px solid var(--nl-border, #f3f4f6);
  vertical-align: middle;
}

.spec-reviews-table__project-name {
  font-weight: 600;
  color: var(--nl-text, #111827);
}

.spec-reviews-table__client-name {
  font-size: 0.78rem;
  color: var(--nl-text-muted, #9ca3af);
  margin-top: 0.15rem;
}

.spec-reviews-table__date {
  white-space: nowrap;
  color: var(--nl-text-muted, #6b7280);
  font-size: 0.8125rem;
}
</style>
