<!-- @file CopilotChecklistPanel.vue — unified live-meeting panel.
     Replaces the old (CopilotSuggestionsPanel + inline checklist) split.
     Each row is a checklist topic; missing/partial rows that carry an
     active suggestion show it inline with Ask / Ignore buttons. -->
<template>
  <section class="ccp">
    <!-- Header: progress + status + manual refresh -->
    <header class="ccp__head">
      <div class="ccp__head-left">
        <h3 class="ccp__title">
          <i class="pi pi-check-square" /> Checklist projet
        </h3>
        <span v-if="!enabled" class="ccp__chip ccp__chip--off">Copilote désactivé</span>
        <span v-else-if="!connected" class="ccp__chip ccp__chip--off">Connexion…</span>
        <span v-else class="ccp__chip ccp__chip--on">{{ coveredCount }}/{{ totalCount }}</span>
      </div>
      <div class="ccp__head-right">
        <NeoButton
          v-if="enabled"
          label="Rafraîchir"
          icon="pi pi-refresh"
          severity="secondary"
          outlined
          size="small"
          :loading="refreshing"
          @click="emit('refresh')"
        />
      </div>
    </header>

    <!-- Hint + ready banner -->
    <NeoMessage
      v-if="readyForCahier"
      severity="success"
      text="✓ Toutes les informations clés ont été collectées. Vous pouvez générer un cahier des charges optimal."
    />
    <NeoMessage
      v-else-if="hint"
      severity="info"
      :text="hint"
    />

    <!-- Empty state -->
    <div v-if="!enabled" class="ccp__empty">
      <i class="pi pi-info-circle" />
      <span>Le copilote IA est désactivé pour l'instant.</span>
    </div>
    <div v-else-if="checklist.length === 0" class="ccp__empty">
      <i class="pi pi-spin pi-cog" />
      <span>Préparation de la checklist…</span>
    </div>

    <!-- Checklist rows -->
    <ul v-else class="ccp__list">
      <li
        v-for="item in sortedItems"
        :key="item.id"
        class="ccp__row"
        :class="[
          `ccp__row--${item.status}`,
          item.userAction ? `ccp__row--${item.userAction}` : '',
        ]"
      >
        <span class="ccp__icon">
          <i v-if="item.status === 'covered'" class="pi pi-check-circle" />
          <i v-else-if="item.status === 'partial'" class="pi pi-exclamation-circle" />
          <i v-else class="pi pi-circle" />
        </span>

        <div class="ccp__body">
          <div class="ccp__row-top">
            <span class="ccp__topic">{{ item.topic }}</span>
            <span class="ccp__cat">{{ categoryLabel(item.category) }}</span>
          </div>
          <div class="ccp__question">{{ item.question }}</div>
          <div v-if="item.evidence" class="ccp__evidence">« {{ item.evidence }} »</div>

          <!-- Inline suggestion for missing/partial rows -->
          <div
            v-if="item.suggestion && item.status !== 'covered'"
            class="ccp__sugg"
            :class="`ccp__sugg--${item.suggestion.urgency}`"
          >
            <div class="ccp__sugg-head">
              <span class="ccp__sugg-urgency">{{ urgencyLabel(item.suggestion.urgency) }}</span>
              <span class="ccp__sugg-section">{{ sectionLabel(item.section) }}</span>
            </div>
            <p class="ccp__sugg-q">{{ item.suggestion.question }}</p>
            <p class="ccp__sugg-r">{{ item.suggestion.rationale }}</p>
            <div v-if="!item.userAction" class="ccp__sugg-actions">
              <NeoButton
                label="Demander"
                icon="pi pi-microphone"
                size="small"
                @click="$emit('ask', item.id)"
              />
              <NeoButton
                label="Ignorer"
                severity="secondary"
                outlined
                size="small"
                @click="$emit('dismiss', item.id)"
              />
            </div>
            <div v-else class="ccp__sugg-flag">
              <i v-if="item.userAction === 'asked'" class="pi pi-check" />
              <i v-else class="pi pi-times" />
              {{ item.userAction === 'asked' ? 'Posée' : 'Ignorée' }}
            </div>
          </div>
        </div>
      </li>
    </ul>

    <div v-if="lastSkipReason && enabled" class="ccp__skip">
      <i class="pi pi-info-circle" />
      <span>{{ skipReasonLabel(lastSkipReason) }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NeoButton, NeoMessage } from '@neolibrary/components'
import type {
  ChecklistItem,
  ChecklistCategory,
  ChecklistStatus,
  CahierSection,
  SuggestionUrgency,
  FireSkipReason,
} from '@/composables/useLiveCopilot'

const props = defineProps<{
  enabled: boolean
  connected: boolean
  refreshing: boolean
  checklist: ChecklistItem[]
  hint: string | null
  readyForCahier: boolean
  lastSkipReason: FireSkipReason | null
  coveredCount: number
  totalCount: number
}>()

const emit = defineEmits<{
  ask: [id: string]
  dismiss: [id: string]
  refresh: []
}>()

const sortedItems = computed<ChecklistItem[]>(() => {
  const order: Record<ChecklistStatus, number> = { missing: 0, partial: 1, covered: 2 }
  // Within the same status, items with active suggestions float to the top.
  return [...props.checklist].sort((a, b) => {
    const so = order[a.status] - order[b.status]
    if (so !== 0) return so
    const aHasS = a.suggestion && a.userAction === null ? 0 : 1
    const bHasS = b.suggestion && b.userAction === null ? 0 : 1
    return aHasS - bHasS
  })
})

const CATEGORY_LABELS: Record<ChecklistCategory, string> = {
  context: 'Contexte',
  users: 'Utilisateurs',
  features: 'Fonctionnalités',
  constraints: 'Contraintes',
  integrations: 'Intégrations',
  security: 'Sécurité',
  timeline: 'Échéances',
  other: 'Autre',
}
function categoryLabel(c: ChecklistCategory): string { return CATEGORY_LABELS[c] ?? c }

const SECTION_LABEL: Record<CahierSection, string> = {
  objectifDocument: 'Objectif doc.',
  contexte: 'Contexte',
  objectifProjet: 'Objectif projet',
  perimetreInclus: 'Périmètre inclus',
  perimetreExclus: 'Périmètre exclus',
  exigencesFonctionnelles: 'Fonctionnalités',
  architectureTechnique: 'Architecture',
  livrables: 'Livrables',
  conclusion: 'Conclusion',
  backlog_driver: 'Backlog',
}
function sectionLabel(s: CahierSection): string { return SECTION_LABEL[s] ?? s }

const URGENCY_LABEL: Record<SuggestionUrgency, string> = {
  low: 'À noter',
  medium: 'À poser',
  high: 'Urgent',
}
function urgencyLabel(u: SuggestionUrgency): string { return URGENCY_LABEL[u] }

const SKIP_REASON_LABEL: Record<FireSkipReason, string> = {
  cooldown: 'Le copilote écoute — analyse à venir dans quelques secondes.',
  cap_reached: 'Limite de la réunion atteinte.',
  budget: 'Budget IA quotidien atteint.',
  min_content: 'Pas assez de nouveau contenu pour analyser.',
  no_session: 'Session expirée — recommence l\'enregistrement.',
  provider: 'Le copilote a rencontré un souci — il réessaiera bientôt.',
}
function skipReasonLabel(reason: FireSkipReason): string { return SKIP_REASON_LABEL[reason] }
</script>

<style scoped>
.ccp {
  display: flex; flex-direction: column; gap: 0.75rem;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  padding: 1rem;
}

.ccp__head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.ccp__head-left { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.ccp__title { margin: 0; font-size: 0.9375rem; font-weight: 600; color: var(--nl-text-1); display: inline-flex; align-items: center; gap: 0.4rem; }
.ccp__chip {
  display: inline-flex; align-items: center;
  padding: 0.1rem 0.55rem; border-radius: 999px;
  font-size: 0.75rem; font-weight: 600;
}
.ccp__chip--off { background: var(--nl-surface-2, #f3f4f6); color: var(--nl-text-3); }
.ccp__chip--on  { background: var(--nl-accent-light, #ecfdf5); color: var(--nl-accent, #1e9e8f); }

.ccp__empty,
.ccp__skip {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.75rem; border-radius: 6px;
  background: var(--nl-surface-2, #fafafa);
  font-size: 0.8125rem; color: var(--nl-text-2);
}
.ccp__skip { background: var(--nl-warn-bg, #fef3c7); color: var(--nl-warn-fg, #92400e); }

.ccp__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; max-height: 70vh; overflow-y: auto; }

.ccp__row {
  display: flex; align-items: flex-start; gap: 0.6rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  background: var(--nl-surface, #fff);
  transition: border-color 0.15s, background 0.15s;
}
.ccp__row--missing { border-left: 3px solid var(--nl-danger, #dc2626); }
.ccp__row--partial { border-left: 3px solid var(--nl-warn, #d97706); }
.ccp__row--covered {
  border-left: 3px solid var(--nl-success, #059669);
  background: var(--nl-surface-2, #fafafa);
}
.ccp__row--asked    { background: rgba(5, 150, 105, 0.06); }
.ccp__row--dismissed { opacity: 0.6; }

.ccp__icon { font-size: 1rem; padding-top: 0.15rem; flex-shrink: 0; }
.ccp__row--missing .ccp__icon { color: var(--nl-danger, #dc2626); }
.ccp__row--partial .ccp__icon { color: var(--nl-warn, #d97706); }
.ccp__row--covered .ccp__icon { color: var(--nl-success, #059669); }

.ccp__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.ccp__row-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.ccp__topic { font-weight: 600; font-size: 0.875rem; color: var(--nl-text-1); }
.ccp__cat {
  font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--nl-text-3); font-weight: 600; flex-shrink: 0;
}
.ccp__question { font-size: 0.8125rem; color: var(--nl-text-2); line-height: 1.4; }
.ccp__evidence {
  font-size: 0.75rem; color: var(--nl-text-3); font-style: italic;
  padding: 0.3rem 0.5rem; border-left: 2px solid var(--nl-success, #059669);
  background: var(--nl-surface-2, #fafafa); border-radius: 4px;
  margin-top: 0.2rem;
}

/* Inline suggestion card */
.ccp__sugg {
  margin-top: 0.5rem; padding: 0.6rem 0.75rem;
  border-radius: 6px;
  background: var(--nl-surface-2, #fafafa);
  border: 1px solid var(--nl-border);
  display: flex; flex-direction: column; gap: 0.35rem;
  animation: ccp-slide-in 0.25s ease-out;
}
@keyframes ccp-slide-in {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ccp__sugg--high   { border-left: 3px solid var(--nl-danger, #dc2626); }
.ccp__sugg--medium { border-left: 3px solid var(--nl-warn, #d97706); }
.ccp__sugg--low    { border-left: 3px solid var(--nl-info, #2563eb); }

.ccp__sugg-head {
  display: flex; gap: 0.5rem;
  font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em;
}
.ccp__sugg-urgency { font-weight: 700; color: var(--nl-text-2); }
.ccp__sugg-section { color: var(--nl-text-3); }
.ccp__sugg-q { margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--nl-text-1); line-height: 1.4; }
.ccp__sugg-r { margin: 0; font-size: 0.75rem; color: var(--nl-text-3); line-height: 1.4; }
.ccp__sugg-actions { display: flex; gap: 0.4rem; margin-top: 0.2rem; }
.ccp__sugg-flag {
  font-size: 0.75rem; color: var(--nl-text-3); font-style: italic;
  display: inline-flex; align-items: center; gap: 0.3rem; margin-top: 0.2rem;
}
</style>
