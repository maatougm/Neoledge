<!-- @file src/components/pm/CahierPreflightModal.vue
     Pre-generation gap analysis modal. Shows what's missing from the
     questionnaire / meetings / saved cahier so the PM can either fill the
     blanks, schedule another meeting, or proceed anyway with explicit
     acknowledgement. -->
<template>
  <AppModal :visible="visible" header="Vérification préalable du cahier" width="640px" @update:visible="onClose">
    <!-- Loading -->
    <div v-if="loading" class="preflight-loading">
      <i class="pi pi-spin pi-spinner" />
      <span>Analyse de la complétude des données projet…</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="preflight-error">
      <i class="pi pi-exclamation-triangle" />
      <span>{{ error }}</span>
    </div>

    <!-- Result -->
    <div v-else-if="result" class="preflight-body">
      <!-- Score header -->
      <div class="preflight-score" :class="`preflight-score--${scoreSeverity}`">
        <div class="preflight-score__ring">
          <span class="preflight-score__pct">{{ Math.round(result.readinessScore * 100) }}%</span>
          <span class="preflight-score__label">Couverture</span>
        </div>
        <div class="preflight-score__text">
          <strong>{{ scoreHeadline }}</strong>
          <p>{{ scoreSubtitle }}</p>
          <p v-if="result.source === 'heuristic'" class="preflight-score__hint">
            <i class="pi pi-info-circle" /> Analyse heuristique (IA indisponible).
          </p>
        </div>
      </div>

      <!-- Missing items — actionable list -->
      <section v-if="highSeverityItems.length > 0" class="preflight-block">
        <h4 class="preflight-block__title preflight-block__title--high">
          <i class="pi pi-exclamation-circle" />
          Informations critiques manquantes ({{ highSeverityItems.length }})
        </h4>
        <ul class="preflight-list">
          <li v-for="item in highSeverityItems" :key="item.id" class="preflight-item preflight-item--high">
            <div class="preflight-item__head">
              <NeoTag :value="sectionLabel(item.section)" severity="danger" />
              <span class="preflight-item__topic">{{ item.topic }}</span>
            </div>
            <p class="preflight-item__question">{{ item.suggestedQuestion }}</p>
            <div v-if="!isOpen(item.id)" class="preflight-item__actions">
              <NeoButton
                label="Ajouter une réponse"
                icon="pi pi-pencil"
                size="small"
                outlined
                :disabled="savingAnswer"
                @click="openInlineAnswer(item)"
              />
              <NeoButton
                label="Programmer une réunion"
                icon="pi pi-calendar"
                size="small"
                outlined
                severity="secondary"
                :disabled="savingAnswer"
                @click="goToMeetings"
              />
            </div>
            <!-- Inline answer textarea. Multiple items can be open at once;
                 the single footer button persists every non-empty draft. -->
            <div v-else class="preflight-item__answer">
              <textarea
                :value="draftFor(item.id)"
                rows="3"
                class="preflight-textarea"
                placeholder="Réponse à enregistrer dans le questionnaire…"
                :disabled="savingAnswer"
                @input="updateDraft(item.id, ($event.target as HTMLTextAreaElement).value)"
              />
              <div class="preflight-item__answer-actions">
                <NeoButton
                  label="Retirer cette réponse"
                  icon="pi pi-times"
                  size="small"
                  outlined
                  severity="secondary"
                  :disabled="savingAnswer"
                  @click="closeInlineAnswer(item.id)"
                />
              </div>
            </div>
          </li>
        </ul>
        <!-- Single batch-save action for every open textarea with a non-empty draft. -->
        <div v-if="hasAnyDraft" class="preflight-batch">
          <span class="preflight-batch__hint">
            {{ draftCount }} réponse(s) prête(s) à enregistrer.
          </span>
          <NeoButton
            label="Enregistrer toutes les réponses"
            icon="pi pi-check"
            :loading="savingAnswer"
            :disabled="savingAnswer || !hasAnyDraft"
            @click="saveAllAnswers"
          />
        </div>
      </section>

      <section v-if="mediumSeverityItems.length > 0" class="preflight-block">
        <h4 class="preflight-block__title preflight-block__title--medium">
          <i class="pi pi-info-circle" />
          Informations utiles à préciser ({{ mediumSeverityItems.length }})
        </h4>
        <ul class="preflight-list">
          <li v-for="item in mediumSeverityItems" :key="item.id" class="preflight-item preflight-item--medium">
            <div class="preflight-item__head">
              <NeoTag :value="sectionLabel(item.section)" severity="warn" />
              <span class="preflight-item__topic">{{ item.topic }}</span>
            </div>
            <p class="preflight-item__question">{{ item.suggestedQuestion }}</p>
          </li>
        </ul>
      </section>

      <section v-if="result.answeredFields.length > 0" class="preflight-block preflight-block--collapsible">
        <button class="preflight-block__toggle" type="button" @click="showAnswered = !showAnswered">
          <i :class="['pi', showAnswered ? 'pi-chevron-down' : 'pi-chevron-right']" />
          <span>Sections déjà couvertes ({{ result.answeredFields.length }})</span>
        </button>
        <ul v-if="showAnswered" class="preflight-list preflight-list--covered">
          <li v-for="(label, idx) in result.answeredFields" :key="`a-${idx}`" class="preflight-item preflight-item--covered">
            <i class="pi pi-check-circle" /> {{ label }}
          </li>
        </ul>
      </section>

      <div v-if="result.missingFields.length === 0" class="preflight-empty">
        <i class="pi pi-check-circle" />
        <span>Aucun manque détecté. Le cahier peut être généré.</span>
      </div>
    </div>

    <template #footer>
      <NeoButton label="Annuler" outlined severity="secondary" @click="onClose(false)" />
      <NeoButton
        v-if="result && !result.canGenerate"
        label="Forcer la génération"
        icon="pi pi-bolt"
        severity="warn"
        :disabled="loading"
        @click="onProceed(true)"
      />
      <NeoButton
        v-else
        label="Générer le cahier"
        icon="pi pi-sparkles"
        :loading="loading"
        :disabled="loading || !result"
        @click="onProceed(false)"
      />
    </template>
  </AppModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NeoButton, NeoTag, useNeoToast } from '@neolibrary/components'
import api, { extractErrorMessage } from '@/lib/api'
import AppModal from '@/components/common/AppModal.vue'

interface MissingFieldInfo {
  id: string
  section: string
  topic: string
  severity: 'high' | 'medium' | 'low'
  suggestedQuestion: string
  relatedFieldId?: string | null
}

interface PreflightResult {
  readinessScore: number
  missingFields: MissingFieldInfo[]
  answeredFields: string[]
  canGenerate: boolean
  computedAt: number
  source: 'ai' | 'heuristic'
}

const props = defineProps<{ visible: boolean; projectId: string }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'proceed', force: boolean): void
}>()

const toast = useNeoToast()
const router = useRouter()

const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<PreflightResult | null>(null)
const showAnswered = ref(false)

// Map<item.id, draft text>. An entry whose key is present means "textarea
// open"; the value is the draft text. The single batch button at the
// bottom persists every entry whose trimmed text is non-empty.
const drafts = ref<Map<string, string>>(new Map())
const savingAnswer = ref(false)

const highSeverityItems = computed(() => result.value?.missingFields.filter((g) => g.severity === 'high') ?? [])
const mediumSeverityItems = computed(() => result.value?.missingFields.filter((g) => g.severity === 'medium' || g.severity === 'low') ?? [])

const scoreSeverity = computed<'good' | 'mid' | 'bad'>(() => {
  const s = result.value?.readinessScore ?? 0
  if (s >= 0.8) return 'good'
  if (s >= 0.5) return 'mid'
  return 'bad'
})

const scoreHeadline = computed(() => {
  if (!result.value) return ''
  if (result.value.canGenerate) return 'Données suffisantes pour générer'
  return 'Informations critiques manquantes'
})

const scoreSubtitle = computed(() => {
  if (!result.value) return ''
  const high = highSeverityItems.value.length
  const med = mediumSeverityItems.value.length
  if (high === 0 && med === 0) return 'Toutes les sections clés sont couvertes.'
  if (high > 0)
    return `${high} information${high > 1 ? 's' : ''} critique${high > 1 ? 's' : ''} manquante${high > 1 ? 's' : ''}. Renseignez-les ou enregistrez une réunion avant de générer.`
  return `${med} information${med > 1 ? 's' : ''} utile${med > 1 ? 's' : ''} manquante${med > 1 ? 's' : ''}. Vous pouvez générer ou compléter d'abord.`
})

const SECTION_LABELS: Record<string, string> = {
  global: 'Général',
  questionnaire: 'Questionnaire',
  reunions: 'Réunions',
  objectifProjet: 'Objectif du projet',
  contexte: 'Contexte',
  perimetreInclus: 'Périmètre inclus',
  perimetreExclus: 'Périmètre exclu',
  exigencesFonctionnelles: 'Exigences fonctionnelles',
  architectureTechnique: 'Architecture technique',
  livrables: 'Livrables',
}
function sectionLabel(s: string): string {
  return SECTION_LABELS[s] ?? s
}

watch(
  () => props.visible,
  async (v) => {
    if (!v) {
      // Reset when closing.
      result.value = null
      error.value = null
      drafts.value = new Map()
      showAnswered.value = false
      return
    }
    await runPreflight()
  },
)

const hasAnyDraft = computed(() => {
  for (const v of drafts.value.values()) if (v.trim().length > 0) return true
  return false
})

const draftCount = computed(() => {
  let n = 0
  for (const v of drafts.value.values()) if (v.trim().length > 0) n += 1
  return n
})

function isOpen(itemId: string): boolean {
  return drafts.value.has(itemId)
}

function draftFor(itemId: string): string {
  return drafts.value.get(itemId) ?? ''
}

function updateDraft(itemId: string, value: string): void {
  const next = new Map(drafts.value)
  next.set(itemId, value)
  drafts.value = next
}

async function runPreflight(): Promise<void> {
  loading.value = true
  error.value = null
  result.value = null
  try {
    const { data } = await api.get<PreflightResult>(
      `/pm/projects/${props.projectId}/cahier-des-charges/preflight`,
    )
    result.value = data
  } catch (e: unknown) {
    error.value = extractErrorMessage(e) ?? 'Impossible d\'analyser la complétude du projet.'
  } finally {
    loading.value = false
  }
}

function openInlineAnswer(item: MissingFieldInfo): void {
  // Always open the textarea. When the AI-flagged item doesn't map onto an
  // existing ProjectField (`relatedFieldId === null`) we create a Custom
  // field on save so the answer is persisted into the questionnaire and
  // automatically flows into the next cahier generation.
  if (drafts.value.has(item.id)) return
  const next = new Map(drafts.value)
  next.set(item.id, '')
  drafts.value = next
}

function closeInlineAnswer(itemId: string): void {
  if (!drafts.value.has(itemId)) return
  const next = new Map(drafts.value)
  next.delete(itemId)
  drafts.value = next
}

async function saveAllAnswers(): Promise<void> {
  if (!result.value) return
  // Collect every non-empty draft alongside its source item — we need
  // `topic` / `suggestedQuestion` / `relatedFieldId` to create the right
  // ProjectField when no match exists.
  const itemsById = new Map(result.value.missingFields.map((m) => [m.id, m]))
  type Pending = { item: MissingFieldInfo; value: string }
  const pending: Pending[] = []
  for (const [itemId, raw] of drafts.value.entries()) {
    const value = raw.trim()
    if (!value) continue
    const item = itemsById.get(itemId)
    if (!item) continue
    pending.push({ item, value })
  }
  if (pending.length === 0) return

  savingAnswer.value = true
  try {
    // 1) Resolve (or create) every ProjectField we need. Items that already
    //    have a relatedFieldId reuse it; the rest get a Custom field created
    //    in parallel. Failures on individual creates surface as a single
    //    aggregated error toast rather than partial saves.
    const resolved = await Promise.all(
      pending.map(async ({ item, value }) => {
        let projectFieldId = item.relatedFieldId ?? null
        if (!projectFieldId) {
          const { data: createdField } = await api.post<{ id: string }>(
            `/pm/projects/${props.projectId}/fields`,
            {
              label: item.topic,
              fieldType: 'Text',
              isRequired: false,
              backlogHint: item.suggestedQuestion,
            },
          )
          projectFieldId = createdField.id
        }
        return { projectFieldId, value }
      }),
    )

    // 2) One batch PATCH writes every value in a single round-trip.
    await api.patch(`/pm/projects/${props.projectId}/field-values`, {
      fieldValues: resolved,
    })

    toast.add({
      severity: 'success',
      detail: `${pending.length} réponse(s) enregistrée(s).`,
      life: 3000,
    })
    drafts.value = new Map()
    // Refresh preflight so the just-answered items drop off the list.
    await runPreflight()
  } catch (e: unknown) {
    toast.add({
      severity: 'error',
      detail: extractErrorMessage(e) ?? 'Erreur lors de l\'enregistrement.',
      life: 5000,
    })
  } finally {
    savingAnswer.value = false
  }
}

function goToMeetings(): void {
  // Close the modal and route via vue-router so Pinia state survives.
  emit('update:visible', false)
  void router.push(`/app/pm/projects/${props.projectId}/meetings`)
}

function onClose(_v: boolean): void {
  emit('update:visible', false)
}

function onProceed(force: boolean): void {
  emit('proceed', force)
}
</script>

<style scoped>
.preflight-loading,
.preflight-error,
.preflight-empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px;
  border-radius: 8px;
}
.preflight-loading { background: var(--nl-surface-alt, #fafbfc); color: var(--nl-text-muted, #666); }
.preflight-error { background: var(--nl-danger-light); color: var(--nl-danger); }
.preflight-empty { background: var(--nl-success-light); color: var(--nl-success, #27ae60); }

.preflight-body { display: flex; flex-direction: column; gap: 18px; }

.preflight-score {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--nl-border, #e5e7eb);
  background: var(--nl-surface-alt, #fafbfc);
}
.preflight-score--good { background: var(--nl-success-light); border-color: #b9e6cb; }
.preflight-score--mid  { background: var(--nl-warning-light); border-color: #f3d9a4; }
.preflight-score--bad  { background: var(--nl-danger-light); border-color: #f5b7b1; }

.preflight-score__ring {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 72px; height: 72px;
  border-radius: 50%;
  background: var(--nl-surface, #fff);
  border: 3px solid var(--nl-border, #e5e7eb);
  flex-shrink: 0;
}
.preflight-score--good .preflight-score__ring { border-color: #27ae60; }
.preflight-score--mid  .preflight-score__ring { border-color: #f39c12; }
.preflight-score--bad  .preflight-score__ring { border-color: var(--nl-danger); }

.preflight-score__pct  { font-size: 1.05rem; font-weight: 700; line-height: 1; }
.preflight-score__label { font-size: 0.7rem; color: var(--nl-text-muted, #666); margin-top: 2px; }

.preflight-score__text strong { display: block; font-size: 0.95rem; margin-bottom: 4px; }
.preflight-score__text p { margin: 0; font-size: 0.85rem; color: var(--nl-text-muted, #555); }
.preflight-score__hint { display: flex; align-items: center; gap: 6px; margin-top: 4px !important; font-style: italic; }

.preflight-block { display: flex; flex-direction: column; gap: 8px; }
.preflight-block__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.92rem;
  font-weight: 600;
  margin: 0;
}
.preflight-block__title--high { color: var(--nl-danger); }
.preflight-block__title--medium { color: var(--nl-warning); }

.preflight-block__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.88rem;
  color: var(--nl-text-2, #333);
  padding: 4px 0;
  text-align: left;
}
.preflight-block__toggle:hover { color: var(--nl-primary, #1b4f72); }

.preflight-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.preflight-list--covered { gap: 4px; padding-left: 22px; }

.preflight-item {
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--nl-surface, #fff);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preflight-item--high { border-left: 3px solid var(--nl-danger); }
.preflight-item--medium { border-left: 3px solid #f39c12; }
.preflight-item--covered {
  border: none;
  padding: 2px 0;
  background: transparent;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--nl-success, #27ae60);
}

.preflight-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.preflight-item__topic { font-weight: 600; font-size: 0.9rem; }

.preflight-item__question {
  margin: 0;
  font-size: 0.85rem;
  color: var(--nl-text-muted, #555);
  line-height: 1.4;
}

.preflight-item__actions { display: flex; gap: 8px; flex-wrap: wrap; }

.preflight-item__answer { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.preflight-item__answer-actions { display: flex; gap: 8px; }

.preflight-batch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--nl-surface-alt, #fafbfc);
  border: 1px solid var(--nl-border, #e5e7eb);
}
.preflight-batch__hint { font-size: 0.82rem; color: var(--nl-text-muted, #555); }
.preflight-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--nl-border, #d0d0d0);
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.85rem;
  resize: vertical;
  box-sizing: border-box;
}
.preflight-textarea:focus {
  outline: none;
  border-color: var(--nl-primary, #1b4f72);
  box-shadow: 0 0 0 2px rgba(27, 79, 114, 0.15);
}
</style>
