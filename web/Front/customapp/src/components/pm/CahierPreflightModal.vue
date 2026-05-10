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
            <div class="preflight-item__actions">
              <NeoButton
                label="Ajouter une réponse"
                icon="pi pi-pencil"
                size="small"
                outlined
                @click="openInlineAnswer(item)"
              />
              <NeoButton
                label="Programmer une réunion"
                icon="pi pi-calendar"
                size="small"
                outlined
                severity="secondary"
                @click="goToMeetings"
              />
            </div>
            <!-- Inline answer textarea -->
            <div v-if="answeringId === item.id" class="preflight-item__answer">
              <textarea
                v-model="answerDraft"
                rows="3"
                class="preflight-textarea"
                placeholder="Réponse à enregistrer dans le questionnaire…"
              />
              <div class="preflight-item__answer-actions">
                <NeoButton
                  label="Enregistrer"
                  icon="pi pi-check"
                  size="small"
                  :loading="savingAnswer"
                  :disabled="!answerDraft.trim() || savingAnswer"
                  @click="saveInlineAnswer(item)"
                />
                <NeoButton
                  label="Annuler"
                  size="small"
                  outlined
                  severity="secondary"
                  :disabled="savingAnswer"
                  @click="cancelInlineAnswer"
                />
              </div>
            </div>
          </li>
        </ul>
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
import api from '@/lib/api'
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

const answeringId = ref<string | null>(null)
const answerDraft = ref('')
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
      answeringId.value = null
      answerDraft.value = ''
      showAnswered.value = false
      return
    }
    await runPreflight()
  },
)

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
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    error.value = msg ?? 'Impossible d\'analyser la complétude du projet.'
  } finally {
    loading.value = false
  }
}

function openInlineAnswer(item: MissingFieldInfo): void {
  if (!item.relatedFieldId) {
    // No matching ProjectField — direct PM to fill the questionnaire manually.
    toast.add({
      severity: 'info',
      detail: 'Aucun champ correspondant dans le questionnaire — utilisez l\'onglet Questionnaire ou planifiez une réunion.',
      life: 5000,
    })
    return
  }
  answeringId.value = item.id
  answerDraft.value = ''
}

function cancelInlineAnswer(): void {
  answeringId.value = null
  answerDraft.value = ''
}

async function saveInlineAnswer(item: MissingFieldInfo): Promise<void> {
  if (!item.relatedFieldId || !answerDraft.value.trim()) return
  savingAnswer.value = true
  try {
    await api.patch(`/pm/projects/${props.projectId}/field-values`, {
      fieldValues: [
        { projectFieldId: item.relatedFieldId, value: answerDraft.value.trim() },
      ],
    })
    toast.add({ severity: 'success', detail: 'Réponse enregistrée.', life: 3000 })
    answeringId.value = null
    answerDraft.value = ''
    // Refresh preflight so the just-answered item drops off the list.
    await runPreflight()
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.add({ severity: 'error', detail: msg ?? 'Erreur lors de l\'enregistrement.', life: 5000 })
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
.preflight-error { background: #ffeaea; color: #c0392b; }
.preflight-empty { background: #eafaf1; color: var(--nl-success, #27ae60); }

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
.preflight-score--good { background: #eafaf1; border-color: #b9e6cb; }
.preflight-score--mid  { background: #fff7e6; border-color: #f3d9a4; }
.preflight-score--bad  { background: #ffeaea; border-color: #f5b7b1; }

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
.preflight-score--bad  .preflight-score__ring { border-color: #c0392b; }

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
.preflight-block__title--high { color: #c0392b; }
.preflight-block__title--medium { color: #b8860b; }

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
.preflight-item--high { border-left: 3px solid #c0392b; }
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
