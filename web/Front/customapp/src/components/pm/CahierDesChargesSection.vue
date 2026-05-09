<!-- @file src/components/pm/CahierDesChargesSection.vue
     Cahier des charges generator panel: generate, preview, download, and provide feedback.
     Feedback is stored and fed into the AI prompt on subsequent generations. -->
<template>
  <div class="cahier-section">
    <!-- Header -->
    <div class="cahier-header" @click="expanded = !expanded">
      <div class="cahier-header-left">
        <i class="pi pi-file-word cahier-icon" />
        <span class="cahier-title">Cahier des charges</span>
        <NeoTag v-if="savedContent" value="Enregistré" severity="success" />
        <NeoTag v-else-if="generating" value="En cours..." severity="info" />
      </div>
      <div class="cahier-header-right" @click.stop>
        <NeoButton
          :label="savedContent ? 'Régénérer' : 'Générer le cahier'"
          icon="pi pi-sparkles"
          size="small"
          :loading="generating"
          :disabled="generating"
          @click="openPreflight"
        />
        <i :class="['pi', expanded ? 'pi-chevron-up' : 'pi-chevron-down', 'chevron']" />
      </div>
    </div>

    <!-- Body -->
    <div v-if="expanded" class="cahier-body">
      <!-- Generating state -->
      <div v-if="generating" class="cahier-processing">
        <i class="pi pi-spin pi-spinner cahier-spinner" />
        <div class="cahier-processing-text">
          <span>Génération du cahier des charges en cours...</span>
          <p class="cahier-processing-detail">
            L'IA analyse les données du formulaire et les transcriptions de réunions
            pour produire un document détaillé.
          </p>
        </div>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="cahier-error">
        <div class="cahier-error-msg">
          <i class="pi pi-exclamation-triangle" />
          <span>{{ error }}</span>
        </div>
        <NeoButton label="Réessayer" icon="pi pi-refresh" size="small" @click="openPreflight" />
      </div>

      <!-- Success state: inline preview + download + feedback -->
      <div v-else-if="savedContent" class="cahier-result">
        <div class="cahier-success">
          <i class="pi pi-check-circle cahier-success-icon" />
          <div class="cahier-success-info">
            <p class="cahier-success-text">
              Cahier des charges enregistré.
              <NeoTag v-if="statusBadge" :value="statusBadge.label" :severity="statusBadge.severity" class="cahier-status-tag" />
            </p>
            <p class="cahier-success-meta">
              Dernière sauvegarde : {{ savedAtLabel }} — visible par l'équipe de validation.
            </p>
          </div>
        </div>

        <!-- Rejection banner: prominent red box with reviewer feedback -->
        <div v-if="cahierStatus?.status === 'rejected' && cahierStatus.lastFeedback" class="cahier-reject-banner">
          <div class="cahier-reject-banner__header">
            <i class="pi pi-exclamation-circle" />
            <strong>Cahier rejeté par {{ cahierStatus.lastFeedback.userName ?? 'l\'équipe de validation' }}</strong>
            <span class="cahier-reject-banner__date">{{ formatRelative(cahierStatus.lastFeedback.createdAt) }}</span>
          </div>
          <p class="cahier-reject-banner__section">
            Section concernée : <strong>{{ sectionLabel(cahierStatus.lastFeedback.section) }}</strong>
          </p>
          <p class="cahier-reject-banner__comment">{{ cahierStatus.lastFeedback.comment }}</p>
          <p class="cahier-reject-banner__hint">
            Cliquez sur « Régénérer » pour produire une nouvelle version qui prend en compte ces remarques.
          </p>
        </div>

        <div class="cahier-actions">
          <NeoButton
            v-if="!editMode"
            label="Télécharger (.docx)"
            icon="pi pi-download"
            @click="handleDownload"
            :loading="downloading"
          />
          <NeoButton
            v-if="!editMode"
            label="Modifier"
            icon="pi pi-pencil"
            outlined
            @click="enterEditMode"
          />
          <NeoButton
            v-if="!editMode"
            label="Régénérer"
            icon="pi pi-refresh"
            outlined
            @click="confirmRegenerate"
            :disabled="generating"
          />
          <NeoButton
            v-if="editMode"
            label="Enregistrer les modifications"
            icon="pi pi-check"
            :loading="savingEdit"
            @click="saveEdits"
          />
          <NeoButton
            v-if="editMode"
            label="Annuler"
            icon="pi pi-times"
            outlined
            severity="secondary"
            :disabled="savingEdit"
            @click="cancelEdits"
          />
        </div>

        <!-- View mode -->
        <div v-if="!editMode" class="cahier-doc">
          <CahierReviewActions :project-id="projectId" :status="cahierStatus?.status" @reviewed="onReviewed" />
          <CahierDocSection title="1.1 Objectif du document" :markdown="savedContent.objectifDocument" />
          <CahierDocSection title="1.2 Contexte" :markdown="savedContent.contexte" />
          <CahierDocSection title="2.1 Objectif du projet" :markdown="savedContent.objectifProjet" />
          <CahierDocSection title="2.2.1 Périmètre — Éléments inclus" :markdown="savedContent.perimetreInclus" />
          <CahierDocSection title="2.2.2 Périmètre — Éléments exclus" :markdown="savedContent.perimetreExclus" />

          <h3 class="cahier-doc-h">2.3 Exigences fonctionnelles</h3>
          <div v-if="savedContent.exigencesFonctionnelles?.length">
            <CahierDocSection
              v-for="(s, i) in savedContent.exigencesFonctionnelles"
              :key="`ef-${i}`"
              :title="s.title"
              :markdown="s.content"
              level="sub"
            />
          </div>
          <p v-else class="cahier-doc-empty">À définir</p>

          <h3 class="cahier-doc-h">2.4 Architecture technique</h3>
          <div v-if="savedContent.architectureTechnique?.length">
            <CahierDocSection
              v-for="(s, i) in savedContent.architectureTechnique"
              :key="`at-${i}`"
              :title="s.title"
              :markdown="s.content"
              level="sub"
            />
          </div>
          <p v-else class="cahier-doc-empty">À définir</p>

          <CahierDocSection title="2.5 Livrables" :markdown="savedContent.livrables" />
          <CahierDocSection title="3. Conclusion" :markdown="savedContent.conclusion" />
        </div>

        <!-- Edit mode — same section structure, fields are editable textareas -->
        <div v-else-if="editingContent" class="cahier-doc cahier-doc--edit">
          <p class="cahier-edit-hint">
            <i class="pi pi-info-circle" />
            Vous modifiez le cahier. Les remarques de validation déjà enregistrées sont préservées.
          </p>

          <div class="cahier-edit-block">
            <h3 class="cahier-doc-h">1.1 Objectif du document</h3>
            <textarea v-model="editingContent.objectifDocument" class="cahier-edit-textarea" rows="3" />
          </div>
          <div class="cahier-edit-block">
            <h3 class="cahier-doc-h">1.2 Contexte</h3>
            <textarea v-model="editingContent.contexte" class="cahier-edit-textarea" rows="6" />
          </div>
          <div class="cahier-edit-block">
            <h3 class="cahier-doc-h">2.1 Objectif du projet</h3>
            <textarea v-model="editingContent.objectifProjet" class="cahier-edit-textarea" rows="5" />
          </div>
          <div class="cahier-edit-block">
            <h3 class="cahier-doc-h">2.2.1 Périmètre — Éléments inclus</h3>
            <textarea v-model="editingContent.perimetreInclus" class="cahier-edit-textarea" rows="5" />
          </div>
          <div class="cahier-edit-block">
            <h3 class="cahier-doc-h">2.2.2 Périmètre — Éléments exclus</h3>
            <textarea v-model="editingContent.perimetreExclus" class="cahier-edit-textarea" rows="4" />
          </div>

          <div class="cahier-edit-block">
            <div class="cahier-edit-block__head">
              <h3 class="cahier-doc-h">2.3 Exigences fonctionnelles</h3>
              <NeoButton
                label="Ajouter une section"
                icon="pi pi-plus"
                size="small"
                outlined
                @click="editingContent.exigencesFonctionnelles.push({ title: '', content: '' })"
              />
            </div>
            <div
              v-for="(s, i) in editingContent.exigencesFonctionnelles"
              :key="`ef-edit-${i}`"
              class="cahier-edit-row"
            >
              <input
                v-model="s.title"
                class="cahier-edit-input"
                placeholder="Titre de la section"
              />
              <textarea v-model="s.content" class="cahier-edit-textarea" rows="4" />
              <button
                type="button"
                class="cahier-edit-row__remove"
                aria-label="Supprimer la section"
                @click="editingContent.exigencesFonctionnelles.splice(i, 1)"
              ><i class="pi pi-trash" /></button>
            </div>
          </div>

          <div class="cahier-edit-block">
            <div class="cahier-edit-block__head">
              <h3 class="cahier-doc-h">2.4 Architecture technique</h3>
              <NeoButton
                label="Ajouter une section"
                icon="pi pi-plus"
                size="small"
                outlined
                @click="editingContent.architectureTechnique.push({ title: '', content: '' })"
              />
            </div>
            <div
              v-for="(s, i) in editingContent.architectureTechnique"
              :key="`at-edit-${i}`"
              class="cahier-edit-row"
            >
              <input
                v-model="s.title"
                class="cahier-edit-input"
                placeholder="Titre de la section"
              />
              <textarea v-model="s.content" class="cahier-edit-textarea" rows="4" />
              <button
                type="button"
                class="cahier-edit-row__remove"
                aria-label="Supprimer la section"
                @click="editingContent.architectureTechnique.splice(i, 1)"
              ><i class="pi pi-trash" /></button>
            </div>
          </div>

          <div class="cahier-edit-block">
            <h3 class="cahier-doc-h">2.5 Livrables</h3>
            <textarea v-model="editingContent.livrables" class="cahier-edit-textarea" rows="5" />
          </div>
          <div class="cahier-edit-block">
            <h3 class="cahier-doc-h">3. Conclusion</h3>
            <textarea v-model="editingContent.conclusion" class="cahier-edit-textarea" rows="4" />
          </div>
        </div>

        <!-- Past feedback history (read-only — approve/reject moved to CahierReviewActions for spec team) -->
        <div v-if="pastFeedback.length > 0" class="cahier-feedback-history">
          <h4 class="cahier-feedback-history-title">Retours précédents (pris en compte par l'IA)</h4>
          <ul class="cahier-feedback-list">
            <li v-for="(fb, idx) in pastFeedback" :key="idx" class="cahier-feedback-item">
              {{ fb }}
            </li>
          </ul>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="cahier-empty">
        <div class="cahier-empty-icon"><i class="pi pi-file-word" /></div>
        <p>Cliquez sur « Générer le cahier » pour créer un cahier des charges détaillé</p>
        <p class="cahier-empty-detail">
          L'IA utilisera les données du formulaire projet et les transcriptions de réunions
          pour produire un document Word professionnel.
        </p>
      </div>
    </div>

    <CahierPreflightModal
      v-model:visible="preflightVisible"
      :project-id="projectId"
      @proceed="onPreflightProceed"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NeoButton, NeoTag, useNeoToast, useNeoConfirm } from '@neolibrary/components'
import api from '@/lib/api'
import CahierDocSection from './CahierDocSection.vue'
import CahierReviewActions from './CahierReviewActions.vue'
import CahierPreflightModal from './CahierPreflightModal.vue'
import { formatRelative } from '@/lib/formatDate'

interface CahierSection {
  title: string
  content: string
}

interface CahierAiResult {
  objectifDocument: string
  contexte: string
  objectifProjet: string
  perimetreInclus: string
  perimetreExclus: string
  exigencesFonctionnelles: CahierSection[]
  architectureTechnique: CahierSection[]
  livrables: string
  conclusion: string
}

interface CahierStatus {
  cahierSavedAt: string | null
  status: 'none' | 'pending' | 'approved' | 'rejected'
  approverCount: number
  rejectionCount: number
  lastFeedback: {
    status: string
    comment: string
    section: string | null
    createdAt: string
    userName: string | null
  } | null
}

const props = defineProps<{ projectId: string }>()
const toast = useNeoToast()
const confirm = useNeoConfirm()

function confirmRegenerate(): void {
  // Re-generation overwrites the saved cahier. If it has been approved, this
  // resets the validation queue — make the user explicitly opt-in.
  const status = cahierStatus.value?.status
  const message = status === 'approved'
    ? 'Le cahier actuel est APPROUVÉ. Régénérer le remplacera et l\'équipe de validation devra l\'examiner à nouveau. Continuer ?'
    : 'Régénérer remplacera la version actuelle. L\'équipe de validation sera notifiée à nouveau. Continuer ?'
  confirm.require({
    message,
    header: 'Régénérer le cahier des charges',
    acceptLabel: 'Régénérer',
    rejectLabel: 'Annuler',
    accept: () => { openPreflight() },
  })
}

const preflightVisible = ref(false)

function openPreflight(): void {
  preflightVisible.value = true
}

function onPreflightProceed(_force: boolean): void {
  preflightVisible.value = false
  void handleGenerate()
}

const expanded = ref(true)
const generating = ref(false)
const downloading = ref(false)
const error = ref<string | null>(null)
const savedContent = ref<CahierAiResult | null>(null)
const savedAt = ref<string | null>(null)
const pastFeedback = ref<string[]>([])
const cahierStatus = ref<CahierStatus | null>(null)

// ─── Manual edit mode ─────────────────────────────────────────────────────────
const editMode = ref(false)
const savingEdit = ref(false)
const editingContent = ref<CahierAiResult | null>(null)

function enterEditMode(): void {
  if (!savedContent.value) return
  // Deep copy so cancel restores cleanly even if the user touched array entries.
  editingContent.value = JSON.parse(JSON.stringify(savedContent.value)) as CahierAiResult
  if (!Array.isArray(editingContent.value.exigencesFonctionnelles)) {
    editingContent.value.exigencesFonctionnelles = []
  }
  if (!Array.isArray(editingContent.value.architectureTechnique)) {
    editingContent.value.architectureTechnique = []
  }
  editMode.value = true
}

function cancelEdits(): void {
  editingContent.value = null
  editMode.value = false
}

async function saveEdits(): Promise<void> {
  if (!editingContent.value) return
  savingEdit.value = true
  try {
    await api.patch(
      `/pm/projects/${props.projectId}/cahier-des-charges/content`,
      { aiContent: editingContent.value },
    )
    savedContent.value = editingContent.value
    editingContent.value = null
    editMode.value = false
    toast.add({ severity: 'success', detail: 'Cahier mis à jour.', life: 3000 })
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.add({
      severity: 'error',
      detail: msg ?? 'Erreur lors de l\'enregistrement.',
      life: 5000,
    })
  } finally {
    savingEdit.value = false
  }
}

const SECTION_LABELS: Record<string, string> = {
  contexte: 'Contexte',
  objectifProjet: 'Objectif du projet',
  perimetreInclus: 'Périmètre inclus',
  perimetreExclus: 'Périmètre exclu',
  exigencesFonctionnelles: 'Exigences fonctionnelles',
  architectureTechnique: 'Architecture technique',
  livrables: 'Livrables',
  conclusion: 'Conclusion',
}
function sectionLabel(s: string | null | undefined): string {
  return s ? (SECTION_LABELS[s] ?? s) : 'Général'
}

const statusBadge = computed<{ label: string; severity: 'info' | 'success' | 'danger' } | null>(() => {
  if (!cahierStatus.value) return null
  switch (cahierStatus.value.status) {
    case 'pending':  return { label: 'En attente de validation', severity: 'info' }
    case 'approved': return { label: 'Approuvé',                  severity: 'success' }
    case 'rejected': return { label: 'Rejeté — à régénérer',      severity: 'danger' }
    default: return null
  }
})

const savedAtLabel = computed(() => {
  if (!savedAt.value) return ''
  try {
    return new Date(savedAt.value).toLocaleString('fr-FR')
  } catch {
    return savedAt.value
  }
})

onMounted(async () => {
  await Promise.all([loadSaved(), loadFeedback(), loadStatus()])
})

async function onReviewed(): Promise<void> {
  await Promise.all([loadSaved(), loadFeedback(), loadStatus()])
}

async function loadStatus(): Promise<void> {
  try {
    const { data } = await api.get<CahierStatus>(`/pm/projects/${props.projectId}/cahier-des-charges/status`)
    cahierStatus.value = data
  } catch {
    cahierStatus.value = null
  }
}

async function loadSaved() {
  try {
    const { data } = await api.get<{ aiContent: CahierAiResult | null; savedAt: string | null }>(
      `/pm/projects/${props.projectId}/cahier-des-charges/saved`,
    )
    if (data.aiContent) {
      savedContent.value = data.aiContent
      savedAt.value = data.savedAt
    }
  } catch {
    // No saved cahier yet — empty state will render.
  }
}

async function loadFeedback() {
  try {
    const { data } = await api.get(`/pm/projects/${props.projectId}/cahier-des-charges/feedback`)
    pastFeedback.value = data.feedback ?? []
  } catch {
    // Silent — feedback history is not critical
  }
}

async function handleGenerate() {
  generating.value = true
  error.value = null

  try {
    // 1. Generate via /preview → JSON (no file download)
    const { data } = await api.get<{
      formData: unknown
      aiContent: CahierAiResult
      transcriptCount: number
      generatedAt: string
    }>(`/pm/projects/${props.projectId}/cahier-des-charges/preview`)

    // 2. Persist to Project.aiOutput so the Cahier tab keeps showing it next time,
    //    and so SpecificationTeam reviewers get notified on the backend.
    await api.post(`/pm/projects/${props.projectId}/cahier-des-charges/save`, {
      aiContent: data.aiContent,
    })

    savedContent.value = data.aiContent
    savedAt.value = new Date().toISOString()
    await loadStatus()
  } catch (e: unknown) {
    const resp = (e as { response?: { data?: { message?: string; missingFields?: string[] } } })?.response?.data
    const missing = resp?.missingFields
    if (Array.isArray(missing) && missing.length > 0) {
      error.value = `Champs IA obligatoires non renseignés : ${missing.join(', ')}. Remplissez le questionnaire avant de générer.`
    } else {
      error.value = resp?.message ?? 'Erreur lors de la génération du cahier des charges.'
    }
  } finally {
    generating.value = false
  }
}

async function handleDownload() {
  downloading.value = true
  try {
    const { data, headers } = await api.get(
      `/pm/projects/${props.projectId}/cahier-des-charges/generate`,
      { responseType: 'blob' },
    )
    const disposition = headers['content-disposition'] ?? ''
    const match = disposition.match(/filename="?([^"]+)"?/)
    const fileName = match?.[1]
      ? decodeURIComponent(match[1])
      : `Cahier-des-charges_${props.projectId}.docx`

    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (e: unknown) {
    // Toast download failures rather than hijacking the page-level `error.value`,
    // which is reserved for generation failures and would hide the saved cahier preview.
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      ?? (e instanceof Error ? e.message : 'Erreur lors du téléchargement du cahier.')
    toast.add({ severity: 'error', detail: msg, life: 5000 })
  } finally {
    downloading.value = false
  }
}

</script>

<style scoped>
.cahier-section {
  border: 1px solid var(--nl-border, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--nl-surface, #fff);
}

.cahier-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  background: var(--nl-surface-alt, #fafbfc);
  border-bottom: 1px solid var(--nl-border, #e0e0e0);
}
.cahier-header:hover { background: var(--nl-surface-hover, #f0f2f4); }

.cahier-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cahier-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cahier-icon { font-size: 1.25rem; color: var(--nl-primary, #1b4f72); }
.cahier-title { font-weight: 600; font-size: 1rem; }
.chevron { color: var(--nl-text-muted, #888); font-size: 0.85rem; }

.cahier-body { padding: 20px; }

/* Processing */
.cahier-processing {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 24px;
  background: var(--nl-surface-alt, #fafbfc);
  border-radius: 6px;
}
.cahier-spinner { font-size: 1.5rem; color: var(--nl-primary, #2e86c1); }
.cahier-processing-text span { font-weight: 600; }
.cahier-processing-detail { margin-top: 4px; color: var(--nl-text-muted, #666); font-size: 0.9rem; }

/* Error */
.cahier-error { display: flex; flex-direction: column; gap: 12px; }
.cahier-error-msg {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #ffeaea;
  border-radius: 6px;
  color: #c0392b;
}

/* Success */
.cahier-success {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #eafaf1;
  border-radius: 6px;
  margin-bottom: 16px;
}
.cahier-success-icon { font-size: 1.5rem; color: var(--nl-success, #27ae60); }
.cahier-success-text { font-weight: 600; margin: 0; }
.cahier-success-meta { font-size: 0.85rem; color: var(--nl-text-muted, #666); margin: 2px 0 0; }

.cahier-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
}

/* Inline cahier document preview (rendered from saved AI JSON) */
.cahier-doc {
  border: 1px solid var(--nl-border, #e0e0e0);
  border-radius: 6px;
  padding: 16px 20px;
  background: var(--nl-surface-alt, #fafbfc);
  margin-bottom: 24px;
}

.cahier-doc-h {
  font-size: 1rem;
  font-weight: 700;
  color: var(--nl-text-1, #111);
  margin: 16px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--nl-border, #e0e0e0);
}

.cahier-doc-empty {
  font-style: italic;
  color: var(--nl-text-muted, #888);
  margin: 0 0 12px 12px;
}

/* Feedback */
.cahier-feedback {
  border-top: 1px solid var(--nl-border, #e0e0e0);
  padding-top: 16px;
}
.cahier-feedback-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 4px;
}
.cahier-feedback-hint {
  font-size: 0.85rem;
  color: var(--nl-text-muted, #666);
  margin: 0 0 12px;
}

.cahier-feedback-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cahier-label { font-weight: 500; font-size: 0.9rem; }
.cahier-select { width: 100%; max-width: 320px; }
.cahier-textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--nl-border, #d0d0d0);
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.9rem;
  resize: vertical;
}
.cahier-textarea:focus {
  outline: none;
  border-color: var(--nl-primary, #2e86c1);
  box-shadow: 0 0 0 2px rgba(46, 134, 193, 0.15);
}

.cahier-feedback-buttons {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

/* Feedback history */
.cahier-feedback-history {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--nl-border, #e0e0e0);
}
.cahier-feedback-history-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--nl-text-muted, #666);
  margin: 0 0 8px;
}
.cahier-feedback-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cahier-feedback-item {
  padding: 8px 12px;
  background: var(--nl-surface-alt, #fafbfc);
  border-radius: 4px;
  font-size: 0.85rem;
  border-left: 3px solid #e74c3c;
}

/* Empty state */
.cahier-empty {
  text-align: center;
  padding: 32px 20px;
  color: var(--nl-text-muted, #666);
}
.cahier-empty-icon { font-size: 2.5rem; margin-bottom: 12px; color: var(--nl-primary, #1b4f72); opacity: 0.4; }
.cahier-empty-detail { font-size: 0.85rem; margin-top: 6px; }

/* ── Edit mode ─────────────────────────────────────────────────────────── */
.cahier-doc--edit { padding-bottom: 8px; }
.cahier-edit-hint {
  display: flex; align-items: center; gap: 8px;
  background: var(--nl-accent-light, #eff6ff);
  color: var(--nl-accent, #1d4ed8);
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 0.8125rem;
  margin: 0 0 16px;
}
.cahier-edit-block { margin-bottom: 18px; }
.cahier-edit-block__head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.cahier-edit-block .cahier-doc-h { margin: 0 0 6px; }
.cahier-edit-textarea {
  width: 100%; box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--nl-border, #d1d5db);
  border-radius: 6px;
  background: var(--nl-surface, #fff);
  color: var(--nl-text-1, #111827);
  font-family: inherit;
  font-size: 0.875rem;
  line-height: 1.5;
  resize: vertical;
}
.cahier-edit-textarea:focus {
  outline: none;
  border-color: var(--nl-accent, #1d4ed8);
  box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.12);
}
.cahier-edit-input {
  width: 100%; box-sizing: border-box;
  padding: 8px 12px;
  margin-bottom: 6px;
  border: 1px solid var(--nl-border, #d1d5db);
  border-radius: 6px;
  background: var(--nl-surface, #fff);
  color: var(--nl-text-1, #111827);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
}
.cahier-edit-input:focus {
  outline: none;
  border-color: var(--nl-accent, #1d4ed8);
  box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.12);
}
.cahier-edit-row {
  position: relative;
  background: var(--nl-surface-2, #f9fafb);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  padding: 10px 12px 10px 12px;
  margin-bottom: 10px;
}
.cahier-edit-row__remove {
  position: absolute; top: 8px; right: 8px;
  width: 28px; height: 28px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--nl-text-3, #6b7280);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.cahier-edit-row__remove:hover {
  background: rgba(239, 68, 68, 0.1);
  color: var(--nl-danger, #dc2626);
}
</style>
