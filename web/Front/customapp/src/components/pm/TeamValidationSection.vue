<template>
  <div class="validation-section">
    <!-- 3-column comparison: Questionnaire · Meetings · Cahier -->
    <ValidationComparisonPanel :project-id="projectId" />

    <div class="v-header">
      <h3 class="v-title">Validation des équipes</h3>
      <NeoButton
        label="Soumettre ma validation"
        icon="pi pi-send"
        :disabled="store.saving || alreadySubmitted"
        :title="alreadySubmitted ? 'Vous avez déjà soumis votre validation pour cette phase.' : undefined"
        @click="showForm = true"
      />
    </div>

    <!-- Already-submitted info banner -->
    <NeoMessage
      v-if="alreadySubmitted"
      severity="info"
      text="Vous avez déjà soumis votre validation pour cette phase."
    />

    <!-- Error banner with retry -->
    <NeoMessage
      v-if="submitError"
      severity="error"
      :text="submitError"
    />
    <div v-if="submitError" class="retry-row">
      <NeoButton
        label="Réessayer"
        icon="pi pi-refresh"
        severity="secondary"
        outlined
        size="small"
        :loading="store.saving"
        @click="retrySubmit"
      />
    </div>

    <!-- Submit form -->
    <div v-if="showForm" class="submit-form">
      <h4 class="form-title">Votre validation</h4>
      <div class="approve-row">
        <button
          :class="['approve-btn', { 'approve-btn--yes': decision === true }]"
          :disabled="store.saving"
          @click="pickDecision(true)"
        >
          <i class="pi pi-check" /> Approuvé
        </button>
        <button
          :class="['approve-btn', 'approve-btn--no-style', { 'approve-btn--no': decision === false }]"
          :disabled="store.saving"
          @click="pickDecision(false)"
        >
          <i class="pi pi-times" /> Refusé
        </button>
      </div>

      <!-- Approval path: simple comment -->
      <NeoInputText
        v-if="decision !== false"
        v-model="comment"
        label="Commentaire (optionnel)"
        placeholder="Ajouter un commentaire..."
        class="w-full"
      />

      <!-- Rejection path: cahier editor + AI feedback -->
      <div v-else class="reject-editor">
        <NeoMessage severity="info" :text="rejectHelp" />

        <div v-if="editorLoading" class="editor-loading">
          <i class="pi pi-spin pi-spinner" /> Chargement du cahier…
        </div>
        <div v-else-if="!hasCahier" class="editor-empty">
          <i class="pi pi-info-circle" />
          Aucun cahier des charges généré pour ce projet — le refus portera sur la conformité du questionnaire.
        </div>
        <template v-else>
          <h5 class="editor-section-title">
            <i class="pi pi-file-edit" /> Corrections manuelles du cahier
            <span class="editor-sub">Modifie ci-dessous les sections incorrectes. Tes corrections remplaceront le contenu actuel.</span>
          </h5>

          <div class="editor-field">
            <label>Objectif du document</label>
            <textarea v-model="editable.objectifDocument" rows="2" />
          </div>
          <div class="editor-field">
            <label>Contexte</label>
            <textarea v-model="editable.contexte" rows="4" />
          </div>
          <div class="editor-field">
            <label>Objectif du projet</label>
            <textarea v-model="editable.objectifProjet" rows="4" />
          </div>
          <div class="editor-field">
            <label>Périmètre inclus</label>
            <textarea v-model="editable.perimetreInclus" rows="5" />
          </div>
          <div class="editor-field">
            <label>Périmètre exclus</label>
            <textarea v-model="editable.perimetreExclus" rows="3" />
          </div>

          <div v-for="(ef, i) in editable.exigencesFonctionnelles" :key="`ef-${i}`" class="editor-field editor-field--module">
            <label>Exigence #{{ i + 1 }} — {{ ef.title }}</label>
            <input v-model="ef.title" class="editor-input-title" placeholder="Nom du module" />
            <textarea v-model="ef.content" rows="4" />
          </div>
          <div v-for="(at, i) in editable.architectureTechnique" :key="`at-${i}`" class="editor-field editor-field--module">
            <label>Architecture #{{ i + 1 }} — {{ at.title }}</label>
            <input v-model="at.title" class="editor-input-title" placeholder="Composant" />
            <textarea v-model="at.content" rows="3" />
          </div>

          <div class="editor-field">
            <label>Livrables</label>
            <textarea v-model="editable.livrables" rows="3" />
          </div>
          <div class="editor-field">
            <label>Conclusion</label>
            <textarea v-model="editable.conclusion" rows="3" />
          </div>
        </template>

        <h5 class="editor-section-title">
          <i class="pi pi-sparkles" /> Commentaire pour l'IA
          <span class="editor-sub">Explique ce que l'IA a raté pour qu'elle ne répète pas l'erreur à la prochaine génération.</span>
        </h5>
        <textarea
          v-model="aiFeedback"
          rows="3"
          placeholder="Ex : la section ‘Architecture technique’ ne doit pas proposer de frameworks frontend autres que Neoform/PrimeVue."
          class="editor-field editor-field--feedback"
        />
      </div>

      <div class="form-actions">
        <NeoButton severity="secondary" label="Annuler" outlined :disabled="store.saving" @click="cancelForm" />
        <NeoButton
          :label="decision === false ? 'Enregistrer les corrections + refuser' : 'Confirmer'"
          :icon="decision === false ? 'pi pi-save' : 'pi pi-check'"
          :loading="store.saving || savingEdits"
          :disabled="decision === null || store.saving"
          @click="handleSubmit"
        />
      </div>
    </div>

    <!-- Validation list -->
    <div v-if="validations.length === 0 && !showForm" class="empty-state">
      <i class="pi pi-shield" />
      <p>Aucune validation soumise pour ce projet.</p>
    </div>

    <div v-else class="validation-list">
      <div v-for="v in validations" :key="v.id" class="v-row">
        <div :class="['v-badge', v.isApproved ? 'v-badge--yes' : 'v-badge--no']">
          <i :class="v.isApproved ? 'pi pi-check' : 'pi pi-times'" />
        </div>
        <div class="v-body">
          <div class="v-top">
            <span class="v-name">{{ v.validatedByName }}</span>
            <NeoTag :value="ROLE_LABELS[v.validatedByRole] ?? v.validatedByRole" severity="secondary" />
            <NeoTag :value="v.isApproved ? 'Approuvé' : 'Refusé'" :severity="v.isApproved ? 'success' : 'danger'" />
            <span class="v-phase">Phase : {{ STATUS_LABELS[v.phase] ?? v.phase }}</span>
            <span class="v-date">{{ formatDate(v.validatedAt) }}</span>
          </div>
          <p v-if="v.comment" class="v-comment">{{ v.comment }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NeoButton, NeoTag, NeoInputText, NeoMessage, useNeoToast } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import { useAuthStore } from '@/stores/authStore'
import ValidationComparisonPanel from './ValidationComparisonPanel.vue'
import { PROJECT_STATUS_LABELS } from '@/types/project.types'
import type { ProjectValidation } from '@/types/pm.types'

const props = defineProps<{ projectId: string; validations: ProjectValidation[] }>()

const store    = usePmStore()
const auth     = useAuthStore()
const toast    = useNeoToast()

// Disable the submit button when the current user has already submitted a validation.
const alreadySubmitted = computed(() =>
  props.validations.some((v) => (v as any).validatedByUserId === auth.userId || v.validatedByRole === auth.userRole)
)

const STATUS_LABELS = PROJECT_STATUS_LABELS
const ROLE_LABELS: Record<string, string> = {
  Admin: 'Admin',
  ProjectManager: 'Chef de projet',
  SpecificationTeam: 'Équipe spéc.',
  Member: 'Membre',
}

const showForm = ref(false)
const decision = ref<boolean | null>(null)
const comment  = ref('')
const submitError = ref<string | null>(null)

// Rejection editor state
interface Section { title: string; content: string }
interface EditableCahier {
  objectifDocument: string
  contexte: string
  objectifProjet: string
  perimetreInclus: string
  perimetreExclus: string
  exigencesFonctionnelles: Section[]
  architectureTechnique: Section[]
  livrables: string
  conclusion: string
}
const editorLoading = ref(false)
const savingEdits = ref(false)
const hasCahier = ref(false)
const aiFeedback = ref('')
const editable = ref<EditableCahier>(emptyCahier())
const rejectHelp = "En cas de refus, corrige manuellement les sections ci-dessous (tes modifications seront enregistrées) et laisse un commentaire à l'IA pour qu'elle s'améliore."

function emptyCahier(): EditableCahier {
  return {
    objectifDocument: '',
    contexte: '',
    objectifProjet: '',
    perimetreInclus: '',
    perimetreExclus: '',
    exigencesFonctionnelles: [],
    architectureTechnique: [],
    livrables: '',
    conclusion: '',
  }
}

function toText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? `- ${x}` : JSON.stringify(x))).join('\n')
  return JSON.stringify(v)
}

async function loadCahierForEdit(): Promise<void> {
  editorLoading.value = true
  hasCahier.value = false
  editable.value = emptyCahier()
  try {
    const { default: api } = await import('@/lib/api')
    const { data } = await api.get<{ aiContent: Partial<EditableCahier> | null }>(
      `/pm/projects/${props.projectId}/cahier-des-charges/saved`,
      { suppressErrorToast: true } as never,
    )
    if (data?.aiContent) {
      const c = data.aiContent
      editable.value = {
        objectifDocument: toText(c.objectifDocument),
        contexte: toText(c.contexte),
        objectifProjet: toText(c.objectifProjet),
        perimetreInclus: toText(c.perimetreInclus),
        perimetreExclus: toText(c.perimetreExclus),
        exigencesFonctionnelles: Array.isArray(c.exigencesFonctionnelles)
          ? c.exigencesFonctionnelles.map((x) => ({ title: x.title ?? '', content: toText(x.content) }))
          : [],
        architectureTechnique: Array.isArray(c.architectureTechnique)
          ? c.architectureTechnique.map((x) => ({ title: x.title ?? '', content: toText(x.content) }))
          : [],
        livrables: toText(c.livrables),
        conclusion: toText(c.conclusion),
      }
      hasCahier.value = true
    }
  } catch {
    hasCahier.value = false
  } finally {
    editorLoading.value = false
  }
}

async function pickDecision(d: boolean): Promise<void> {
  decision.value = d
  submitError.value = null
  if (d === false && !hasCahier.value && !editorLoading.value) {
    await loadCahierForEdit()
  }
}

// Store last submission for retry
const lastPayload = ref<{ isApproved: boolean; comment: string | null } | null>(null)

const cancelForm = (): void => {
  showForm.value = false
  decision.value = null
  comment.value = ''
  submitError.value = null
  aiFeedback.value = ''
  editable.value = emptyCahier()
  hasCahier.value = false
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })

const performSubmit = async (payload: { isApproved: boolean; comment: string | null }): Promise<void> => {
  submitError.value = null
  lastPayload.value = payload

  const ok = await store.submitValidation(props.projectId, payload)
  if (ok) {
    toast.add({ severity: 'success', detail: 'Validation soumise avec succès.', life: 3000 })
    showForm.value = false
    decision.value = null
    comment.value = ''
    lastPayload.value = null
  } else {
    const raw = store.error ?? ''
    // "déjà soumis" is a normal business rule, not a transient error — show info, no retry.
    if (raw.toLowerCase().includes('déjà') || raw.toLowerCase().includes('already')) {
      showForm.value = false
      decision.value = null
      comment.value = ''
      toast.add({ severity: 'info', detail: 'Vous avez déjà soumis votre validation pour cette phase.', life: 5000 })
    } else {
      submitError.value = raw || 'Une erreur est survenue lors de la soumission.'
      toast.add({ severity: 'error', detail: submitError.value, life: 5000 })
    }
  }
}

const handleSubmit = async (): Promise<void> => {
  if (decision.value === null) return

  // Rejection path — save manual edits + AI feedback before submitting validation
  if (decision.value === false) {
    const fb = aiFeedback.value.trim()
    if (!fb) {
      toast.add({ severity: 'warn', detail: "Merci d'ajouter un commentaire pour l'IA.", life: 4000 })
      return
    }
    savingEdits.value = true
    try {
      const { default: api } = await import('@/lib/api')
      // 1. Save the edited cahier content (only if one existed to start with)
      if (hasCahier.value) {
        try {
          await api.post(`/pm/projects/${props.projectId}/cahier-des-charges/save`, {
            aiContent: editable.value,
          })
        } catch { /* non-fatal */ }
      }
      // 2. Save the AI feedback (learns for next regeneration)
      try {
        await api.post(`/pm/projects/${props.projectId}/cahier-des-charges/feedback`, {
          status: 'rejected',
          comment: fb,
        })
      } catch { /* non-fatal */ }
    } finally {
      savingEdits.value = false
    }
    await performSubmit({
      isApproved: false,
      comment: fb,
    })
    return
  }

  // Approval path
  await performSubmit({
    isApproved: decision.value,
    comment: comment.value.trim() || null,
  })
}

const retrySubmit = async (): Promise<void> => {
  if (lastPayload.value) {
    await performSubmit(lastPayload.value)
  }
}
</script>

<style scoped>
.validation-section { display: flex; flex-direction: column; gap: 1.25rem; }

/* Rejection editor */
.reject-editor {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  margin-top: 0.5rem;
  padding: 0.9rem 1rem;
  background: var(--nl-surface-2, #f8fafc);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
}
.editor-loading, .editor-empty {
  text-align: center;
  padding: 1.5rem;
  color: var(--nl-text-3);
  font-size: 0.875rem;
}
.editor-section-title {
  font-size: 0.875rem;
  font-weight: 700;
  margin: 0.5rem 0 0.3rem;
  color: var(--nl-text-1);
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.editor-section-title .editor-sub {
  flex-basis: 100%;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--nl-text-3);
  margin-top: 0.15rem;
}
.editor-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.editor-field > label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--nl-text-1);
}
.editor-field textarea,
.editor-field--feedback,
.editor-input-title {
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  font-family: inherit;
  font-size: 0.82rem;
  line-height: 1.5;
  resize: vertical;
  background: #fff;
}
.editor-field textarea:focus,
.editor-field--feedback:focus,
.editor-input-title:focus {
  outline: none;
  border-color: var(--nl-accent);
  box-shadow: 0 0 0 2px var(--nl-accent-light, rgba(13,148,136,0.15));
}
.editor-field--module {
  border-left: 3px solid var(--nl-accent);
  padding-left: 0.75rem;
}
.editor-input-title {
  font-weight: 600;
}

.v-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; }
.v-title { font-size: 1rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }

.retry-row {
  display: flex;
  justify-content: flex-end;
}

.submit-form {
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.form-title { font-size: 0.9rem; font-weight: 600; color: var(--nl-text-2); margin: 0; }

.approve-row { display: flex; gap: 0.75rem; }

.approve-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1.25rem;
  border-radius: 8px;
  border: 2px solid var(--nl-border);
  background: var(--nl-surface);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--nl-text-3);
  cursor: pointer;
  transition: all 0.15s;
}
.approve-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.approve-btn--yes { border-color: var(--nl-success, #10b981); background: var(--nl-success-bg, #ecfdf5); color: var(--nl-success, #059669); }
.approve-btn--no  { border-color: var(--nl-danger); background: var(--nl-danger-bg, #fef2f2); color: var(--nl-danger); }

.form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem;
  color: var(--nl-text-3);
  background: var(--nl-surface-2);
  border-radius: var(--nl-radius);
  border: 1px dashed var(--nl-border);
}
.empty-state i { font-size: 2rem; }
.empty-state p { margin: 0; font-size: 0.875rem; }

.validation-list { display: flex; flex-direction: column; gap: 0.75rem; }

.v-row {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 0.875rem 1rem;
}

.v-badge {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  flex-shrink: 0;
}
.v-badge--yes { background: var(--nl-success-bg, #ecfdf5); color: var(--nl-success, #059669); }
.v-badge--no  { background: var(--nl-danger-bg, #fef2f2); color: var(--nl-danger); }

.v-body { flex: 1; display: flex; flex-direction: column; gap: 0.3rem; }
.v-top { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.v-name { font-size: 0.875rem; font-weight: 600; color: var(--nl-text-1); }
.v-phase { font-size: 0.78rem; color: var(--nl-text-3); }
.v-date { font-size: 0.78rem; color: var(--nl-text-3); margin-left: auto; }
.v-comment { margin: 0; font-size: 0.82rem; color: var(--nl-text-3); font-style: italic; }
</style>
