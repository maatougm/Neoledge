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
          <span>
            Génération du cahier des charges en cours
            <NeoTag
              v-if="streamPartial"
              :value="`${streamedGroups.size}/3 sections`"
              :severity="streamedGroups.size === 3 ? 'success' : 'info'"
              class="cahier-stream-progress"
            />
          </span>
          <p class="cahier-processing-detail">
            <template v-if="streamPartial">
              L'IA émet les sections au fur et à mesure. Les sections déjà reçues sont visibles ci-dessous.
            </template>
            <template v-else>
              L'IA analyse les données du formulaire et les transcriptions de réunions
              pour produire un document détaillé.
            </template>
          </p>
        </div>
      </div>

      <!-- Streaming partial preview — render whatever sections have arrived.
           Each group's keys become visible as soon as its LLM call lands.
           `streamedGroups` controls the "à venir" skeleton placeholder. -->
      <div v-if="generating && streamPartial" class="cahier-stream-preview cahier-doc">
        <template v-if="streamedGroups.has('intro')">
          <CahierDocSection title="1.1 Objectif du document" :markdown="streamPartial.objectifDocument" />
          <CahierDocSection title="1.2 Contexte" :markdown="streamPartial.contexte" />
          <CahierDocSection title="2.1 Objectif du projet" :markdown="streamPartial.objectifProjet" />
        </template>
        <p v-else class="cahier-doc-pending"><i class="pi pi-spin pi-spinner" /> Introduction et objectifs…</p>

        <template v-if="streamedGroups.has('scope')">
          <CahierDocSection title="2.2.1 Périmètre — Éléments inclus" :markdown="streamPartial.perimetreInclus" />
          <CahierDocSection title="2.2.2 Périmètre — Éléments exclus" :markdown="streamPartial.perimetreExclus" />
          <h3 class="cahier-doc-h">2.3 Exigences fonctionnelles</h3>
          <div v-if="streamPartial.exigencesFonctionnelles?.length">
            <CahierDocSection
              v-for="(s, i) in streamPartial.exigencesFonctionnelles"
              :key="`stream-ef-${i}`"
              :title="s.title"
              :markdown="s.content"
              level="sub"
            />
          </div>
          <p v-else class="cahier-doc-empty">À définir</p>
        </template>
        <p v-else class="cahier-doc-pending"><i class="pi pi-spin pi-spinner" /> Périmètre et exigences fonctionnelles…</p>

        <template v-if="streamedGroups.has('delivery')">
          <h3 class="cahier-doc-h">2.4 Architecture technique</h3>
          <div v-if="streamPartial.architectureTechnique?.length">
            <CahierDocSection
              v-for="(s, i) in streamPartial.architectureTechnique"
              :key="`stream-at-${i}`"
              :title="s.title"
              :markdown="s.content"
              level="sub"
            />
          </div>
          <p v-else class="cahier-doc-empty">À définir</p>
          <CahierDocSection title="2.5 Livrables" :markdown="streamPartial.livrables" />
          <CahierDocSection title="3. Conclusion" :markdown="streamPartial.conclusion" />
        </template>
        <p v-else class="cahier-doc-pending"><i class="pi pi-spin pi-spinner" /> Architecture, livrables et conclusion…</p>
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

        <!-- Approval banner: read-only confirmation, visible to the PM (and everyone).
             Validation actions themselves live in CahierReviewActions and only render
             for the SpecificationTeam reviewers / Admin. -->
        <div v-if="cahierStatus?.status === 'approved' && cahierStatus.lastFeedback" class="cahier-approve-banner">
          <div class="cahier-approve-banner__header">
            <i class="pi pi-check-circle" />
            <strong>Cahier approuvé par {{ cahierStatus.lastFeedback.userName ?? 'l\'équipe de validation' }}</strong>
            <span class="cahier-approve-banner__date">{{ formatRelative(cahierStatus.lastFeedback.createdAt) }}</span>
          </div>
          <p
            v-if="cahierStatus.lastFeedback.comment && cahierStatus.lastFeedback.comment !== 'Approuvé.'"
            class="cahier-approve-banner__comment"
          >
            {{ cahierStatus.lastFeedback.comment }}
          </p>
        </div>

        <div class="cahier-actions">
          <NeoButton
            v-if="!editMode && canManageCahier"
            label="Télécharger (.docx)"
            icon="pi pi-download"
            :loading="downloading"
            @click="handleDownload"
          />
          <NeoButton
            v-if="!editMode && canManageCahier"
            label="Modifier"
            icon="pi pi-pencil"
            outlined
            @click="enterEditMode"
          />
          <NeoButton
            v-if="!editMode && canManageCahier"
            label="Régénérer"
            icon="pi pi-refresh"
            outlined
            :disabled="generating"
            @click="confirmRegenerate"
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
import { streamCahierPreview } from '@/lib/cahier-stream'
import CahierDocSection from './CahierDocSection.vue'
import CahierReviewActions from './CahierReviewActions.vue'
import CahierPreflightModal from './CahierPreflightModal.vue'
import { formatRelative } from '@/lib/formatDate'
import { useAuthStore } from '@/stores/authStore'

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
const auth = useAuthStore()

// Only the PM/Admin generate, download, edit or regenerate the cahier. The
// SpecificationTeam (and anyone else) is review-only — they read the saved
// cahier and approve/reject via CahierReviewActions. Hiding these also avoids
// dead buttons: the underlying generate/content endpoints are PM/Admin-gated.
const canManageCahier = computed<boolean>(
  () => auth.userRole === 'ProjectManager' || auth.userRole === 'Admin',
)

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

// Phase 3 — live streaming state. `streamPartial` is the partial CahierAiResult
// that fills in as sections arrive; `streamedGroups` tracks which of the 3
// groups have landed for the progress badge.
const streamPartial = ref<CahierAiResult | null>(null)
const streamedGroups = ref<Set<'intro' | 'scope' | 'delivery'>>(new Set())

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

/**
 * Walk a saved cahier payload and return every distinct INFO_MANQUANTE topic
 * the AI inserted. The cahier shape mixes free-text strings and array sections
 * (exigencesFonctionnelles, architectureTechnique) — both can carry markers.
 */
function collectMissingMarkers(content: CahierAiResult | null | undefined): string[] {
  if (!content || typeof content !== 'object') return []
  const re = /INFO_MANQUANTE:\s*([^\n\]]+)/g
  const topics = new Set<string>()
  const scan = (txt: unknown): void => {
    if (typeof txt !== 'string') return
    for (const match of txt.matchAll(re)) {
      const t = match[1].trim().replace(/[\]\)\.;,]+$/, '').slice(0, 200)
      if (t) topics.add(t)
    }
  }
  for (const value of Object.values(content)) {
    if (typeof value === 'string') {
      scan(value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          scan((item as { title?: unknown }).title)
          scan((item as { content?: unknown }).content)
        }
      }
    }
  }
  return [...topics]
}

async function handleGenerate() {
  generating.value = true
  error.value = null
  // Reset streaming UI state for this run.
  streamedGroups.value = new Set()
  streamPartial.value = null

  let finalContent: CahierAiResult | null = null

  try {
    // Phase 3 — consume the SSE preview-stream endpoint. Sections render
    // progressively as the LLM emits them. After `complete`, persist once.
    await streamCahierPreview(props.projectId, {
      onEvent: (event) => {
        if (event.type === 'started') {
          // Initialise an empty skeleton so the UI can render section
          // placeholders before any LLM call lands.
          streamPartial.value = {
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
        } else if (event.type === 'section' && streamPartial.value) {
          // Merge this group's keys into the live partial.
          streamPartial.value = { ...streamPartial.value, ...event.partial } as CahierAiResult
          streamedGroups.value = new Set(streamedGroups.value).add(event.group)
        } else if (event.type === 'group_error') {
          toast.add({
            severity: 'warn',
            detail: `Une section (${event.group}) n'a pas pu être générée — le cahier sera partiel.`,
            life: 6000,
          })
        } else if (event.type === 'complete') {
          finalContent = event.aiContent
        } else if (event.type === 'error') {
          throw new Error(event.message)
        }
      },
    })

    if (!finalContent) {
      throw new Error('La génération s\'est terminée sans contenu final.')
    }

    // Persist the final content. The server's groundedness pass already ran
    // on each section as it arrived.
    await api.post(`/pm/projects/${props.projectId}/cahier-des-charges/save`, {
      aiContent: finalContent,
    })

    savedContent.value = finalContent
    savedAt.value = new Date().toISOString()
    await loadStatus()

    const missing = collectMissingMarkers(finalContent)
    if (missing.length > 0) {
      toast.add({
        severity: 'warn',
        detail: `${missing.length} information(s) manquante(s) détectée(s). Renseignez-les pour régénérer un cahier complet.`,
        life: 6000,
      })
      preflightVisible.value = true
    }
  } catch (e: unknown) {
    const resp = (e as { response?: { data?: { message?: string; missingFields?: string[] } } })?.response?.data
    const missing = resp?.missingFields
    if (Array.isArray(missing) && missing.length > 0) {
      error.value = `Champs IA obligatoires non renseignés : ${missing.join(', ')}. Remplissez le questionnaire avant de générer.`
    } else if (resp?.message) {
      error.value = resp.message
    } else if (e instanceof Error) {
      error.value = e.message
    } else {
      error.value = 'Erreur lors de la génération du cahier des charges.'
    }
  } finally {
    generating.value = false
    streamPartial.value = null
    streamedGroups.value = new Set()
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
.cahier-stream-progress { margin-left: 8px; }

/* Streaming partial preview — sections appear as the LLM emits them */
.cahier-stream-preview {
  margin-top: 16px;
  padding: 16px 20px;
  border: 1px dashed var(--nl-border, #e0e0e0);
  border-radius: 6px;
  background: var(--nl-surface-alt, #fafbfc);
}
.cahier-doc-pending {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--nl-text-muted, #666);
  font-size: 0.92rem;
  font-style: italic;
  margin: 8px 0;
}

/* Error */
.cahier-error { display: flex; flex-direction: column; gap: 12px; }
.cahier-error-msg {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--nl-danger-light);
  border-radius: 6px;
  color: var(--nl-danger);
}

/* Success */
.cahier-success {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--nl-success-light);
  border-radius: 6px;
  margin-bottom: 16px;
}
.cahier-success-icon { font-size: 1.5rem; color: var(--nl-success, #27ae60); }

/* Read-only validation banners (status + reviewer + comment) — shown to the PM too. */
.cahier-reject-banner,
.cahier-approve-banner {
  border-radius: 8px;
  padding: 0.875rem 1rem;
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.cahier-reject-banner {
  background: var(--nl-danger-light, rgba(220, 38, 38, 0.08));
  border: 1px solid color-mix(in srgb, var(--nl-danger, #dc2626) 35%, transparent);
}
.cahier-approve-banner {
  background: var(--nl-success-light, rgba(39, 174, 96, 0.1));
  border: 1px solid color-mix(in srgb, var(--nl-success, #27ae60) 35%, transparent);
}
.cahier-reject-banner__header,
.cahier-approve-banner__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--nl-text-1, #111827);
}
.cahier-reject-banner__header i { color: var(--nl-danger, #dc2626); font-size: 1.05rem; }
.cahier-approve-banner__header i { color: var(--nl-success, #27ae60); font-size: 1.05rem; }
.cahier-reject-banner__date,
.cahier-approve-banner__date {
  margin-left: auto;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--nl-text-3, #9ca3af);
}
.cahier-reject-banner__section { margin: 0; font-size: 0.8125rem; color: var(--nl-text-2, #374151); }
.cahier-reject-banner__comment,
.cahier-approve-banner__comment {
  margin: 0;
  font-size: 0.875rem;
  color: var(--nl-text-2, #374151);
  white-space: pre-wrap;
}
.cahier-reject-banner__hint { margin: 0; font-size: 0.75rem; color: var(--nl-text-3, #9ca3af); }
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
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--nl-accent) 15%, transparent);
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
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nl-accent) 15%, transparent);
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
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nl-accent) 15%, transparent);
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
