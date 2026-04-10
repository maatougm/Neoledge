<template>
  <div class="ai-panel">
    <!-- Header row -->
    <div class="ai-header" @click="expanded = !expanded">
      <div class="ai-header-left">
        <i class="pi pi-sparkles ai-icon" />
        <span class="ai-title">Analyse IA</span>
        <NeoTag
          v-if="results"
          :value="statusLabel"
          :severity="statusSeverity"
        />
        <span v-if="results?.aiStatus === 'processing'" class="processing-dots">
          <span />
          <span />
          <span />
        </span>
      </div>
      <div class="ai-header-right" @click.stop>
        <NeoButton
          v-if="!results || results.aiStatus === 'none' || results.aiStatus === 'failed'"
          label="Analyser avec l'IA"
          icon="pi pi-play"
          size="small"
          :loading="triggering"
          :disabled="triggering"
          @click="handleAnalyze"
        />
        <NeoButton
          v-else-if="results.aiStatus === 'completed'"
          label="Ré-analyser"
          icon="pi pi-refresh"
          size="small"
          outlined
          :disabled="false"
          @click="handleAnalyze"
        />
        <i :class="['pi', expanded ? 'pi-chevron-up' : 'pi-chevron-down', 'chevron']" />
      </div>
    </div>

    <!-- Body -->
    <div v-if="expanded" class="ai-body">
      <!-- Processing state -->
      <div v-if="results?.aiStatus === 'processing'" class="ai-processing">
        <i class="pi pi-spin pi-spinner" />
        <span>Analyse en cours... Cela peut prendre quelques secondes.</span>
      </div>

      <!-- Error state -->
      <div v-else-if="results?.aiStatus === 'failed'" class="ai-error-block">
        <div class="ai-error-msg">
          <i class="pi pi-exclamation-triangle" />
          <span>{{ results.aiError ?? "Une erreur est survenue lors de l'analyse." }}</span>
        </div>
        <NeoButton
          label="Réessayer"
          icon="pi pi-refresh"
          size="small"
          :loading="triggering"
          @click="handleAnalyze"
        />
      </div>

      <!-- Completed state -->
      <div v-else-if="results?.aiStatus === 'completed'" class="ai-content">
        <!-- Tabs -->
        <div class="ai-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="['ai-tab', { 'ai-tab--active': activeTab === tab.key }]"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
            <span v-if="tab.count !== undefined" class="tab-badge">{{ tab.count }}</span>
          </button>
        </div>

        <!-- Tab: Summary (Compte-rendu) -->
        <div v-if="activeTab === 'summary'" class="tab-panel">
          <pre v-if="results.aiSummary" class="ai-summary">{{ results.aiSummary }}</pre>
          <p v-else class="empty-state">Aucun compte-rendu disponible.</p>
          <p class="ai-meta">
            Généré par <strong>{{ results.aiModel }}</strong>
            <span v-if="results.aiProcessedAt"> · {{ formatDate(results.aiProcessedAt) }}</span>
          </p>
        </div>

        <!-- Tab: Action items -->
        <div v-if="activeTab === 'actions'" class="tab-panel">
          <div v-if="results.actionItems.length === 0" class="empty-state">
            Aucune action identifiée.
          </div>
          <table v-else class="ai-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Assigné à</th>
                <th>Échéance</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in results.actionItems" :key="item.id">
                <td class="action-desc">{{ item.description }}</td>
                <td class="action-assignee">{{ item.assigneeName ?? '—' }}</td>
                <td class="action-due">{{ item.dueDate ? formatShortDate(item.dueDate) : '—' }}</td>
                <td class="action-status">
                  <NeoTag
                    :value="item.isCompleted ? 'Fait' : 'À faire'"
                    :severity="item.isCompleted ? 'success' : 'warning'"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Tab: Decisions & risks -->
        <div v-if="activeTab === 'decisions'" class="tab-panel">
          <div v-if="results.decisions.length === 0" class="empty-state">
            Aucune décision ou risque identifié.
          </div>
          <ul v-else class="decision-list">
            <li v-for="d in results.decisions" :key="d.id" class="decision-item">
              <NeoTag
                :value="d.category === 'risk' ? 'Risque' : 'Décision'"
                :severity="d.category === 'risk' ? 'warning' : 'info'"
              />
              <span class="decision-desc">{{ d.description }}</span>
            </li>
          </ul>
        </div>
      </div>

      <!-- None state (not yet analyzed) -->
      <div v-else class="ai-none">
        <p>L'analyse IA n'a pas encore été lancée pour cette réunion.</p>
        <NeoButton
          label="Lancer l'analyse"
          icon="pi pi-play"
          :loading="triggering"
          :disabled="triggering"
          @click="handleAnalyze"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { NeoButton, NeoTag } from '@neolibrary/components'
import { useNeoToast } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import type { AiResults } from '@/types/pm.types'

const props = defineProps<{
  projectId: string
  meetingId: string
}>()

const store = usePmStore()
const toast = useNeoToast()

const expanded = ref(false)
const triggering = ref(false)
const activeTab = ref<'summary' | 'actions' | 'decisions'>('summary')

const results = computed<AiResults | null>(() => store.aiResults)

const statusLabel = computed(() => {
  switch (results.value?.aiStatus) {
    case 'processing': return 'En cours'
    case 'completed': return 'Complété'
    case 'failed': return 'Échec'
    default: return 'Non analysé'
  }
})

const statusSeverity = computed((): 'secondary' | 'warning' | 'success' | 'danger' => {
  switch (results.value?.aiStatus) {
    case 'processing': return 'warning'
    case 'completed': return 'success'
    case 'failed': return 'danger'
    default: return 'secondary'
  }
})

const tabs = computed(() => [
  { key: 'summary' as const, label: 'Compte-rendu' },
  { key: 'actions' as const, label: 'Actions', count: results.value?.actionItems.length ?? 0 },
  { key: 'decisions' as const, label: 'Décisions & Risques', count: results.value?.decisions.length ?? 0 },
])

async function handleAnalyze() {
  triggering.value = true
  expanded.value = true
  activeTab.value = 'summary'
  try {
    await store.triggerAiAnalysis(props.projectId, props.meetingId)
    toast.add({ severity: 'info', detail: "Analyse IA lancée. Les résultats seront disponibles dans quelques instants.", life: 4000 })
  } catch {
    toast.add({ severity: 'error', detail: "Impossible de lancer l'analyse IA.", life: 3000 })
  } finally {
    triggering.value = false
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

// Watch for completion to show toast
watch(
  () => results.value?.aiStatus,
  (newStatus, oldStatus) => {
    if (oldStatus === 'processing' && newStatus === 'completed') {
      toast.add({ severity: 'success', detail: 'Analyse IA terminée avec succès.', life: 3000 })
    } else if (oldStatus === 'processing' && newStatus === 'failed') {
      toast.add({ severity: 'error', detail: "L'analyse IA a échoué.", life: 4000 })
    }
  },
)

onMounted(async () => {
  // Load existing results if any
  await store.fetchAiResults(props.projectId, props.meetingId)
  // Auto-expand if there are results
  if (results.value && results.value.aiStatus !== 'none') {
    expanded.value = true
  }
  // If processing from a previous session, resume polling without re-triggering
  if (results.value?.aiStatus === 'processing') {
    store.resumeAiPolling(props.projectId, props.meetingId)
  }
})

onUnmounted(() => {
  store.stopAiPolling()
})
</script>

<style scoped>
.ai-panel {
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  overflow: hidden;
}

.ai-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background: var(--nl-surface-2);
  cursor: pointer;
  user-select: none;
  gap: 0.75rem;
}

.ai-header:hover {
  background: var(--nl-surface-3, var(--nl-surface-2));
}

.ai-header-left {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1;
}

.ai-icon {
  color: var(--nl-accent);
  font-size: 1rem;
}

.ai-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--nl-text-1);
}

.ai-header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.chevron {
  color: var(--nl-text-3);
  font-size: 0.8rem;
  cursor: pointer;
}

/* Animated processing dots */
.processing-dots {
  display: inline-flex;
  gap: 3px;
  align-items: center;
}

.processing-dots span {
  width: 5px;
  height: 5px;
  background: var(--nl-accent);
  border-radius: 50%;
  animation: dot-pulse 1.4s infinite ease-in-out both;
}

.processing-dots span:nth-child(1) { animation-delay: 0s; }
.processing-dots span:nth-child(2) { animation-delay: 0.2s; }
.processing-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dot-pulse {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* Body */
.ai-body {
  padding: 1rem;
  border-top: 1px solid var(--nl-border);
}

.ai-processing {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--nl-text-2);
  font-size: 0.875rem;
  padding: 0.5rem 0;
}

.ai-processing .pi-spin {
  color: var(--nl-accent);
}

.ai-error-block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.ai-error-msg {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  color: #dc2626;
  font-size: 0.875rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: var(--nl-radius);
  padding: 0.75rem;
}

.ai-none {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
  color: var(--nl-text-3);
  font-size: 0.875rem;
}

/* Tabs */
.ai-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--nl-border);
  margin-bottom: 1rem;
}

.ai-tab {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--nl-text-3);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.ai-tab:hover { color: var(--nl-text-1); }

.ai-tab--active {
  color: var(--nl-accent);
  border-bottom-color: var(--nl-accent);
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--nl-surface-2);
  color: var(--nl-text-2);
  font-size: 0.7rem;
  font-weight: 700;
}

.tab-panel {
  min-height: 4rem;
}

/* Summary */
.ai-summary {
  font-size: 0.875rem;
  line-height: 1.7;
  color: var(--nl-text-1);
  white-space: pre-wrap;
  font-family: inherit;
  margin: 0 0 0.75rem 0;
  background: var(--nl-surface-2);
  padding: 1rem;
  border-radius: var(--nl-radius);
  overflow-x: auto;
}

.ai-meta {
  font-size: 0.75rem;
  color: var(--nl-text-3);
  margin: 0;
}

/* Action items table */
.ai-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.ai-table th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  font-weight: 700;
  color: var(--nl-text-2);
  border-bottom: 2px solid var(--nl-border);
}

.ai-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--nl-border);
  color: var(--nl-text-1);
  vertical-align: top;
}

.ai-table tr:last-child td { border-bottom: none; }

.action-desc { max-width: 320px; }
.action-assignee { white-space: nowrap; }
.action-due { white-space: nowrap; }

/* Decisions list */
.decision-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.decision-item {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  background: var(--nl-surface-1);
}

.decision-desc {
  font-size: 0.875rem;
  color: var(--nl-text-1);
  line-height: 1.5;
}

.empty-state {
  font-size: 0.875rem;
  color: var(--nl-text-3);
  padding: 1rem 0;
  margin: 0;
}
</style>
