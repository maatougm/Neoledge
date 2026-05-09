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
          :label="results?.aiStatus === 'failed' ? 'Réessayer' : 'Analyser avec l\'IA'"
          :icon="results?.aiStatus === 'failed' ? 'pi pi-refresh' : 'pi pi-play'"
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
        <i class="pi pi-spin pi-spinner ai-processing-spinner" />
        <div class="ai-processing-text">
          <span>Analyse en cours...</span>
          <span class="processing-dots"><span /><span /><span /></span>
        </div>
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
          <div v-if="results.aiSummary" class="ai-summary-prose" v-html="renderSummary(results.aiSummary)" />
          <p v-else class="empty-state">Aucun compte-rendu disponible.</p>
          <p class="ai-meta">
            Généré par <strong>{{ results.aiModel }}</strong>
            <span v-if="results.aiProcessedAt"> · {{ formatDate(results.aiProcessedAt) }}</span>
          </p>
        </div>

        <!-- Tab: Action items — card per item, convert-to-WP button at top -->
        <div v-if="activeTab === 'actions'" class="tab-panel">
          <div v-if="pendingActions.length > 0" class="action-toolbar">
            <NeoButton
              label="Convertir en tâches"
              icon="pi pi-arrow-circle-right"
              size="small"
              :disabled="convertingActions || pendingActions.length === 0"
              @click="openConvertModal"
            />
            <span class="action-toolbar-hint">
              {{ pendingActions.length }} action(s) à convertir en WorkPackages.
            </span>
          </div>
          <div v-if="results.actionItems.length === 0" class="empty-state">
            Aucune action identifiée.
          </div>
          <div v-else class="action-cards">
            <div
              v-for="item in results.actionItems"
              :key="item.id"
              class="action-card"
              :class="{ 'action-card--done': item.isCompleted }"
            >
              <div class="action-card-left">
                <span class="action-checkbox" :class="{ 'action-checkbox--checked': item.isCompleted }">
                  <i v-if="item.isCompleted" class="pi pi-check" />
                </span>
              </div>
              <div class="action-card-body">
                <span class="action-desc" :class="{ 'action-desc--done': item.isCompleted }">
                  {{ item.description }}
                </span>
                <div class="action-card-meta">
                  <span v-if="item.assigneeName" class="assignee-chip">
                    <span class="assignee-avatar">{{ item.assigneeName.charAt(0).toUpperCase() }}</span>
                    {{ item.assigneeName }}
                  </span>
                  <span v-if="item.dueDate" :class="['due-badge', dueDateClass(item.dueDate)]">
                    <i class="pi pi-calendar" />
                    {{ formatShortDate(item.dueDate) }}
                  </span>
                  <span v-if="item.isCompleted" class="action-converted-tag">
                    <i class="pi pi-check-circle" /> Convertie en tâche
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <AppModal
          v-model:visible="showConvertModal"
          header="Convertir les actions en tâches"
          width="640px"
        >
          <p class="convert-help">
            Sélectionne les actions à convertir en WorkPackages. L'assignataire est
            déduit du nom mentionné dans la transcription (correspondance approximative
            avec les membres du projet) ; tu pourras toujours réassigner ensuite.
          </p>
          <ul class="convert-list">
            <li
              v-for="a in pendingActions"
              :key="a.id"
              class="convert-row"
              :class="{ 'convert-row--checked': selectedActionIds.has(a.id) }"
              @click="toggleAction(a.id)"
            >
              <input
                type="checkbox"
                :checked="selectedActionIds.has(a.id)"
                @click.stop
                @change="toggleAction(a.id)"
              />
              <div class="convert-row-body">
                <span class="convert-row-desc">{{ a.description }}</span>
                <div class="convert-row-meta">
                  <span v-if="a.assigneeName" class="convert-row-chip">
                    <i class="pi pi-user" /> {{ a.assigneeName }}
                  </span>
                  <span v-if="a.dueDate" class="convert-row-chip">
                    <i class="pi pi-calendar" /> {{ formatShortDate(a.dueDate) }}
                  </span>
                </div>
              </div>
            </li>
          </ul>
          <template #footer>
            <NeoButton
              label="Annuler"
              severity="secondary"
              outlined
              :disabled="convertingActions"
              @click="showConvertModal = false"
            />
            <NeoButton
              label="Convertir la sélection"
              icon="pi pi-check"
              :loading="convertingActions"
              :disabled="selectedActionIds.size === 0 || convertingActions"
              @click="confirmConvert"
            />
          </template>
        </AppModal>

        <!-- Tab: Decisions & risks — two column -->
        <div v-if="activeTab === 'decisions'" class="tab-panel">
          <div v-if="results.decisions.length === 0" class="empty-state">
            Aucune décision ou risque identifié.
          </div>
          <div v-else class="decision-grid">
            <div v-for="d in results.decisions" :key="d.id" class="decision-item">
              <span :class="['decision-category-badge', d.category === 'risk' ? 'decision-category-badge--risk' : 'decision-category-badge--decision']">
                {{ d.category === 'risk' ? 'Risque' : 'Décision' }}
              </span>
              <span class="decision-desc">{{ d.description }}</span>
            </div>
          </div>
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
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { NeoButton, NeoTag } from '@neolibrary/components'
import { useNeoToast } from '@neolibrary/components'
import api, { extractErrorMessage } from '@/lib/api'
import { usePmStore } from '@/stores/pmStore'
import AppModal from '@/components/common/AppModal.vue'
import { sanitize } from '@/lib/sanitize'
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

const statusSeverity = computed((): 'secondary' | 'warn' | 'success' | 'danger' => {
  switch (results.value?.aiStatus) {
    case 'processing': return 'warn'
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

/**
 * Converts plain-text summary with Markdown-like headings and lists
 * into safe HTML for prose rendering. AI content is externally influenced
 * (prompt injection risk), so the output is sanitised with DOMPurify as
 * defense in depth even though inputs are HTML-escaped.
 */
function renderSummary(text: string): string {
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n')
    .map((line) => {
      if (/^## (.+)/.test(line)) return `<h2 class="prose-h2">${line.replace(/^## /, '')}</h2>`
      if (/^# (.+)/.test(line))  return `<h1 class="prose-h1">${line.replace(/^# /, '')}</h1>`
      if (/^- (.+)/.test(line))  return `<li class="prose-li">${line.replace(/^- /, '')}</li>`
      if (/^\* (.+)/.test(line)) return `<li class="prose-li">${line.replace(/^\* /, '')}</li>`
      if (line.trim() === '')    return '<br />'
      return `<p class="prose-p">${line}</p>`
    })
    .join('')

  // Defense-in-depth: funnel generated HTML through the shared sanitizer
  // before it hits v-html. The shared allow-list is a strict superset of
  // the tags we actually emit here.
  return sanitize(html)
}

/**
 * Returns a CSS class based on how soon a due date is.
 */
function dueDateClass(iso: string): string {
  const now = Date.now()
  const due = new Date(iso).getTime()
  const diff = due - now
  if (diff < 0) return 'due-badge--overdue'
  if (diff < 3 * 24 * 60 * 60 * 1000) return 'due-badge--soon'
  return 'due-badge--ok'
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

// ─── Convert action items to WorkPackages ────────────────────────────────────

const showConvertModal = ref(false)
const convertingActions = ref(false)
const selectedActionIds = reactive(new Set<string>())

const pendingActions = computed(() =>
  (results.value?.actionItems ?? []).filter((a) => !a.isCompleted),
)

function openConvertModal(): void {
  selectedActionIds.clear()
  // Pre-select all pending actions by default — typical case is "convert everything".
  for (const a of pendingActions.value) selectedActionIds.add(a.id)
  showConvertModal.value = true
}

function toggleAction(id: string): void {
  if (selectedActionIds.has(id)) selectedActionIds.delete(id)
  else selectedActionIds.add(id)
}

async function confirmConvert(): Promise<void> {
  const ids = Array.from(selectedActionIds)
  if (ids.length === 0) return
  convertingActions.value = true
  try {
    const { data } = await api.post<{ created: number; skipped: number }>(
      `/pm/projects/${props.projectId}/meetings/${props.meetingId}/actions/convert`,
      { actionItemIds: ids },
    )
    toast.add({
      severity: 'success',
      detail: `${data.created} tâche(s) créée(s)${data.skipped ? ` (${data.skipped} ignorée[s])` : ''}.`,
      life: 4000,
    })
    showConvertModal.value = false
    selectedActionIds.clear()
    // Refresh ai-results so converted items are flagged as completed.
    await store.fetchAiResults(props.projectId, props.meetingId).catch(() => undefined)
  } catch (e: unknown) {
    toast.add({
      severity: 'error',
      detail: extractErrorMessage(e) ?? 'Échec de la conversion.',
      life: 4000,
    })
  } finally {
    convertingActions.value = false
  }
}
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 3rem 1rem;
  color: var(--nl-text-2);
  font-size: 0.875rem;
}

.ai-processing-spinner {
  font-size: 2rem;
  color: var(--nl-accent);
}

.ai-processing-text {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9375rem;
  color: var(--nl-text-2);
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

/* Tabs — underline style */
.ai-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--nl-border);
  margin-bottom: 1rem;
}

.ai-tab {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--nl-text-3);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.ai-tab:hover { color: var(--nl-text-1); }

.ai-tab--active {
  color: var(--nl-accent);
  border-bottom: 2px solid var(--nl-accent);
  font-weight: 600;
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

/* Summary prose */
.ai-summary-prose {
  font-size: 0.875rem;
  line-height: 1.7;
  color: var(--nl-text-1);
  margin: 0 0 0.75rem 0;
  background: var(--nl-surface-2);
  padding: 1rem;
  border-radius: var(--nl-radius);
  overflow-x: auto;
}

.ai-summary-prose :deep(.prose-h1) {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 1rem 0 0.5rem;
}

.ai-summary-prose :deep(.prose-h2) {
  font-size: 16px;
  font-weight: 600;
  color: var(--nl-text-1);
  margin: 0.875rem 0 0.4rem;
}

.ai-summary-prose :deep(.prose-p) {
  margin: 0 0 0.5rem;
  line-height: 1.7;
}

.ai-summary-prose :deep(.prose-li) {
  display: list-item;
  list-style-type: disc;
  margin-left: 1.25rem;
  margin-bottom: 0.25rem;
  line-height: 1.6;
}

.ai-meta {
  font-size: 0.75rem;
  color: var(--nl-text-3);
  margin: 0;
}

/* Action item cards */
.action-cards {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.action-card {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 12px 16px;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  background: var(--nl-surface);
  transition: box-shadow 0.15s;
}

.action-card:hover {
  box-shadow: var(--nl-shadow-md, var(--nl-shadow));
}

.action-card--done {
  opacity: 0.65;
}

.action-card-left {
  padding-top: 2px;
  flex-shrink: 0;
}

.action-checkbox {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 2px solid var(--nl-border);
  background: var(--nl-surface);
  font-size: 10px;
  color: transparent;
  transition: background 0.15s, border-color 0.15s;
}

.action-checkbox--checked {
  background: #16A34A;
  border-color: #16A34A;
  color: #fff;
}

.action-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  flex: 1;
  min-width: 0;
}

.action-desc {
  font-size: 0.875rem;
  color: var(--nl-text-1);
  line-height: 1.5;
}

.action-desc--done {
  text-decoration: line-through;
  color: var(--nl-text-3);
}

.action-card-meta {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.assignee-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--nl-text-2);
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: 99px;
  padding: 2px 8px 2px 4px;
}

.assignee-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--nl-accent);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
}

.due-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
  white-space: nowrap;
}

.due-badge--overdue { background: #FEF2F2; color: #DC2626; }
.due-badge--soon    { background: #FFF7ED; color: #D97706; }
.due-badge--ok      { background: #F0FDF4; color: #16A34A; }

/* Decisions two-column grid */
.decision-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}

@media (max-width: 600px) {
  .decision-grid { grid-template-columns: 1fr; }
}

.decision-item {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  background: var(--nl-surface);
}

.decision-category-badge {
  display: inline-flex;
  align-items: center;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  align-self: flex-start;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.decision-category-badge--decision {
  background: #EFF4FF;
  color: #0F62FE;
}

.decision-category-badge--risk {
  background: #FFF7ED;
  color: #D97706;
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

/* Action-toolbar (convert-to-WP) */
.action-toolbar {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  margin-bottom: 0.75rem;
  background: var(--nl-accent-light, #ecfdf5);
  border: 1px solid var(--nl-accent);
  border-radius: 6px;
  font-size: 0.8125rem;
}
.action-toolbar-hint { color: var(--nl-text-2); }
.action-converted-tag {
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-size: 0.6875rem;
  color: var(--nl-success, #059669);
  font-weight: 600;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--nl-accent-light, #ecfdf5);
}

/* Convert modal */
.convert-help {
  margin: 0 0 1rem 0;
  font-size: 0.8125rem; color: var(--nl-text-2);
  line-height: 1.4;
}
.convert-list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 0.4rem;
  max-height: 50vh; overflow-y: auto;
}
.convert-row {
  display: flex; align-items: flex-start; gap: 0.65rem;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  background: var(--nl-card-bg, #fff);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.convert-row:hover { border-color: var(--nl-accent); }
.convert-row--checked {
  background: var(--nl-accent-light, #ecfdf5);
  border-color: var(--nl-accent);
}
.convert-row input[type="checkbox"] {
  margin-top: 0.2rem; cursor: pointer;
}
.convert-row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.convert-row-desc {
  font-size: 0.875rem; color: var(--nl-text-1);
  line-height: 1.35;
}
.convert-row-meta { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.convert-row-chip {
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-size: 0.6875rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--nl-surface-2, #f3f4f6);
  color: var(--nl-text-3);
}
</style>
