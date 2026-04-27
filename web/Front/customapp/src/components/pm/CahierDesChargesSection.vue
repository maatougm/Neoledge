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
        <NeoTag v-if="lastGenerated" value="Généré" severity="success" />
        <NeoTag v-else-if="generating" value="En cours..." severity="info" />
      </div>
      <div class="cahier-header-right" @click.stop>
        <NeoButton
          label="Générer le cahier"
          icon="pi pi-sparkles"
          size="small"
          :loading="generating"
          :disabled="generating"
          @click="handleGenerate"
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
        <NeoButton label="Réessayer" icon="pi pi-refresh" size="small" @click="handleGenerate" />
      </div>

      <!-- Success state: download + feedback -->
      <div v-else-if="lastGenerated" class="cahier-result">
        <div class="cahier-success">
          <i class="pi pi-check-circle cahier-success-icon" />
          <div>
            <p class="cahier-success-text">Cahier des charges généré avec succès.</p>
            <p class="cahier-success-meta">{{ lastGenerated }}</p>
          </div>
        </div>

        <div class="cahier-actions">
          <NeoButton
            label="Télécharger (.docx)"
            icon="pi pi-download"
            @click="handleDownload"
            :loading="downloading"
          />
          <NeoButton
            label="Régénérer"
            icon="pi pi-refresh"
            outlined
            @click="handleGenerate"
            :disabled="generating"
          />
        </div>

        <!-- Feedback section -->
        <div class="cahier-feedback">
          <h3 class="cahier-feedback-title">
            <i class="pi pi-comment" /> Évaluation du document
          </h3>
          <p class="cahier-feedback-hint">
            Si le document ne correspond pas à vos attentes, décrivez les problèmes.
            L'IA tiendra compte de vos retours lors de la prochaine génération.
          </p>

          <div class="cahier-feedback-form">
            <label class="cahier-label">Section concernée (optionnel)</label>
            <NeoSelect
              v-model="feedbackSection"
              :options="sectionOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Toutes les sections"
              class="cahier-select"
            />

            <label class="cahier-label">Commentaire</label>
            <textarea
              v-model="feedbackComment"
              class="cahier-textarea"
              rows="3"
              placeholder="Décrivez ce qui ne va pas ou ce qu'il faut améliorer..."
            />

            <div class="cahier-feedback-buttons">
              <NeoButton
                label="Approuver"
                icon="pi pi-check"
                severity="success"
                size="small"
                :loading="submittingFeedback"
                :disabled="submittingFeedback"
                @click="submitFeedback('approved')"
              />
              <NeoButton
                label="Rejeter et améliorer"
                icon="pi pi-times"
                severity="danger"
                size="small"
                :loading="submittingFeedback"
                :disabled="!feedbackComment.trim() || submittingFeedback"
                @click="submitFeedback('rejected')"
              />
            </div>
          </div>

          <!-- Past feedback history -->
          <div v-if="pastFeedback.length > 0" class="cahier-feedback-history">
            <h4 class="cahier-feedback-history-title">Retours précédents (pris en compte par l'IA)</h4>
            <ul class="cahier-feedback-list">
              <li v-for="(fb, idx) in pastFeedback" :key="idx" class="cahier-feedback-item">
                {{ fb }}
              </li>
            </ul>
          </div>
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '@/lib/api'

const props = defineProps<{ projectId: string }>()

const expanded = ref(true)
const generating = ref(false)
const downloading = ref(false)
const error = ref<string | null>(null)
const lastGenerated = ref<string | null>(null)
const submittingFeedback = ref(false)

const feedbackComment = ref('')
const feedbackSection = ref<string | null>(null)
const pastFeedback = ref<string[]>([])

const sectionOptions = [
  { label: 'Toutes les sections', value: null },
  { label: 'Objectif du document', value: 'objectifDocument' },
  { label: 'Contexte', value: 'contexte' },
  { label: 'Objectif du projet', value: 'objectifProjet' },
  { label: 'Périmètre — Éléments inclus', value: 'perimetreInclus' },
  { label: 'Périmètre — Éléments exclus', value: 'perimetreExclus' },
  { label: 'Exigences fonctionnelles', value: 'exigencesFonctionnelles' },
  { label: 'Architecture technique', value: 'architectureTechnique' },
  { label: 'Livrables', value: 'livrables' },
  { label: 'Conclusion', value: 'conclusion' },
]

onMounted(async () => {
  await loadFeedback()
})

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
    const { data, headers } = await api.get(
      `/pm/projects/${props.projectId}/cahier-des-charges/generate`,
      { responseType: 'blob' },
    )

    // Extract filename from Content-Disposition
    const disposition = headers['content-disposition'] ?? ''
    const match = disposition.match(/filename="?([^"]+)"?/)
    const fileName = match?.[1]
      ? decodeURIComponent(match[1])
      : `Cahier-des-charges_${props.projectId}.docx`

    // Trigger browser download
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    lastGenerated.value = new Date().toLocaleString('fr-FR')
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    error.value = msg ?? 'Erreur lors de la génération du cahier des charges.'
  } finally {
    generating.value = false
  }
}

async function handleDownload() {
  downloading.value = true
  await handleGenerate()
  downloading.value = false
}

async function submitFeedback(status: 'approved' | 'rejected') {
  if (status === 'rejected' && !feedbackComment.value.trim()) return

  submittingFeedback.value = true
  try {
    await api.post(`/pm/projects/${props.projectId}/cahier-des-charges/feedback`, {
      status,
      comment: status === 'approved' ? (feedbackComment.value || 'Document approuvé') : feedbackComment.value,
      section: feedbackSection.value,
    })

    feedbackComment.value = ''
    feedbackSection.value = null
    await loadFeedback()

    // If rejected, auto-regenerate with the new feedback
    if (status === 'rejected') {
      await handleGenerate()
    }
  } catch {
    // Error toast handled by global interceptor
  } finally {
    submittingFeedback.value = false
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
.cahier-success-icon { font-size: 1.5rem; color: #27ae60; }
.cahier-success-text { font-weight: 600; margin: 0; }
.cahier-success-meta { font-size: 0.85rem; color: var(--nl-text-muted, #666); margin: 2px 0 0; }

.cahier-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
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
</style>
