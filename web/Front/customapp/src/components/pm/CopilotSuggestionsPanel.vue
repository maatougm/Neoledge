<!-- @file CopilotSuggestionsPanel.vue — sidebar pane in the live meeting
     view. Shows AI-suggested questions the PM can either ask or dismiss. -->
<template>
  <section class="csp">
    <header class="csp__head">
      <h3 class="csp__title">Suggestions IA</h3>
      <span v-if="!enabled" class="csp__off">Désactivé</span>
      <span v-else-if="!connected" class="csp__off">Connexion…</span>
      <span v-else class="csp__on">{{ pendingCards.length }} suggestion(s)</span>
    </header>

    <p class="csp__hint">
      Le copilote écoute la réunion et te propose des questions à poser pour ne rien
      oublier dans le cahier des charges et le backlog.
    </p>

    <div v-if="!enabled" class="csp__disabled">
      <i class="pi pi-info-circle" />
      <span>Le copilote IA est désactivé pour l'instant.</span>
    </div>

    <div v-else-if="pendingCards.length === 0" class="csp__empty">
      <i class="pi pi-check-circle" />
      <span>Aucune suggestion pour le moment — la réunion est sur les bons rails.</span>
    </div>

    <ul v-else class="csp__list">
      <li
        v-for="card in pendingCards"
        :key="card.id"
        class="csp__card"
        :class="`csp__card--${card.urgency}`"
      >
        <div class="csp__card-head">
          <span class="csp__urgency">{{ urgencyLabel(card.urgency) }}</span>
          <span class="csp__section">{{ sectionLabel(card.section) }}</span>
        </div>
        <p class="csp__question">{{ card.question }}</p>
        <p class="csp__rationale">{{ card.rationale }}</p>
        <div class="csp__card-actions">
          <NeoButton
            label="Demander"
            icon="pi pi-microphone"
            size="small"
            @click="onAsk(card.id)"
          />
          <NeoButton
            label="Ignorer"
            severity="secondary"
            outlined
            size="small"
            @click="onDismiss(card.id)"
          />
        </div>
      </li>
    </ul>

    <div v-if="lastSkipReason" class="csp__skip">
      <i class="pi pi-info-circle" />
      <span>{{ skipReasonLabel(lastSkipReason) }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { NeoButton } from '@neolibrary/components'
import type {
  SuggestionCard,
  SuggestionUrgency,
  CahierSection,
  FireSkipReason,
} from '@/composables/useLiveCopilot'

const props = defineProps<{
  enabled: boolean
  connected: boolean
  pendingCards: SuggestionCard[]
  lastSkipReason: FireSkipReason | null
}>()

const emit = defineEmits<{
  ask: [id: string]
  dismiss: [id: string]
}>()

function onAsk(id: string): void { emit('ask', id) }
function onDismiss(id: string): void { emit('dismiss', id) }

const URGENCY_LABEL: Record<SuggestionUrgency, string> = {
  low: 'À noter',
  medium: 'À poser',
  high: 'Urgent',
}
function urgencyLabel(u: SuggestionUrgency): string { return URGENCY_LABEL[u] }

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
  backlog_driver: 'Question pour le backlog',
}
function sectionLabel(s: CahierSection): string { return SECTION_LABEL[s] ?? s }

const SKIP_REASON_LABEL: Record<FireSkipReason, string> = {
  cooldown: 'Le copilote vient de parler — il attend la suite.',
  cap_reached: 'Limite de suggestions atteinte pour cette réunion.',
  budget: 'Budget IA quotidien atteint.',
  min_content: 'Pas assez de nouveau contenu pour analyser.',
  no_session: 'Session expirée — recommence l\'enregistrement.',
  provider: 'Le copilote a rencontré un souci — il réessaiera bientôt.',
}
function skipReasonLabel(reason: FireSkipReason): string { return SKIP_REASON_LABEL[reason] }
</script>

<style scoped>
.csp {
  display: flex;
  flex-direction: column;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  padding: 1rem;
  gap: 0.75rem;
}
.csp__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.csp__title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--nl-text-1);
}
.csp__off {
  font-size: 0.75rem;
  color: var(--nl-text-3);
}
.csp__on {
  font-size: 0.75rem;
  color: var(--nl-accent);
  font-weight: 600;
}
.csp__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--nl-text-3);
}
.csp__disabled,
.csp__empty,
.csp__skip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 6px;
  background: var(--nl-surface-2, #fafafa);
  font-size: 0.8125rem;
  color: var(--nl-text-2);
}
.csp__skip {
  background: var(--nl-warn-bg, #fef3c7);
  color: var(--nl-warn-fg, #92400e);
}
.csp__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 60vh;
  overflow-y: auto;
}
.csp__card {
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  padding: 0.75rem;
  background: var(--nl-surface, #fff);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  animation: csp-slide-in 0.25s ease-out;
}
@keyframes csp-slide-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
.csp__card--high { border-left: 3px solid var(--nl-danger, #dc2626); }
.csp__card--medium { border-left: 3px solid var(--nl-warn, #d97706); }
.csp__card--low { border-left: 3px solid var(--nl-info, #2563eb); }

.csp__card-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.csp__urgency {
  font-weight: 700;
  color: var(--nl-text-2);
}
.csp__section {
  color: var(--nl-text-3);
}
.csp__question {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--nl-text-1);
  line-height: 1.4;
}
.csp__rationale {
  margin: 0;
  font-size: 0.75rem;
  color: var(--nl-text-3);
  line-height: 1.4;
}
.csp__card-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
</style>
