<template>
  <div class="ai-section">
    <div class="ai-header">
      <div class="ai-icon-wrap">
        <i class="pi pi-sparkles ai-icon" />
      </div>
      <div>
        <h3 class="ai-title">Analyse IA</h3>
        <p class="ai-sub">
          Généré à partir du questionnaire et des transcriptions de réunions (Z.AI / glm-4.5-air)
          <span v-if="savedAt" class="ai-saved">• Enregistré le {{ new Date(savedAt).toLocaleString('fr-FR') }}</span>
        </p>
      </div>
    </div>

    <!-- Error -->
    <NeoMessage v-if="errorMsg" severity="error" :text="errorMsg" :closable="true" @close="errorMsg = null" />

    <!-- Result -->
    <div v-if="result" class="ai-output">
      <section v-if="result.objectifDocument">
        <h4>Objectif du document</h4>
        <p>{{ result.objectifDocument }}</p>
      </section>
      <section v-if="result.contexte">
        <h4>Contexte</h4>
        <p>{{ result.contexte }}</p>
      </section>
      <section v-if="result.objectifProjet">
        <h4>Objectif du projet</h4>
        <p class="pre">{{ stringify(result.objectifProjet) }}</p>
      </section>
      <section v-if="result.perimetreInclus">
        <h4>Périmètre inclus</h4>
        <p class="pre">{{ stringify(result.perimetreInclus) }}</p>
      </section>
      <section v-if="result.perimetreExclus">
        <h4>Périmètre exclus</h4>
        <p class="pre">{{ stringify(result.perimetreExclus) }}</p>
      </section>
      <section v-if="Array.isArray(result.exigencesFonctionnelles) && result.exigencesFonctionnelles.length > 0">
        <h4>Exigences fonctionnelles</h4>
        <div v-for="(item, i) in result.exigencesFonctionnelles" :key="`ef-${i}`" class="ai-subsection">
          <h5>{{ item.title }}</h5>
          <p class="pre">{{ item.content }}</p>
        </div>
      </section>
      <section v-if="Array.isArray(result.architectureTechnique) && result.architectureTechnique.length > 0">
        <h4>Architecture technique</h4>
        <div v-for="(item, i) in result.architectureTechnique" :key="`at-${i}`" class="ai-subsection">
          <h5>{{ item.title }}</h5>
          <p class="pre">{{ item.content }}</p>
        </div>
      </section>
      <section v-if="result.livrables">
        <h4>Livrables</h4>
        <p class="pre">{{ stringify(result.livrables) }}</p>
      </section>
      <section v-if="result.conclusion">
        <h4>Conclusion</h4>
        <p>{{ result.conclusion }}</p>
      </section>

      <div class="ai-actions">
        <NeoButton
          label="Régénérer"
          icon="pi pi-sparkles"
          outlined
          size="small"
          :loading="generating"
          @click="handleGenerate"
        />
        <NeoButton
          label="Télécharger DOCX"
          icon="pi pi-file-word"
          severity="secondary"
          outlined
          size="small"
          :disabled="generating"
          @click="handleDownloadDocx"
        />
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!generating" class="ai-empty">
      <i class="pi pi-sparkles ai-empty-icon" />
      <p class="ai-empty-text">Aucune analyse disponible pour ce projet</p>
      <NeoButton
        label="Générer l'analyse"
        icon="pi pi-sparkles"
        :loading="generating"
        @click="handleGenerate"
      />
    </div>

    <!-- Loading state -->
    <div v-else class="ai-loading">
      <i class="pi pi-spin pi-spinner ai-empty-icon" />
      <p class="ai-empty-text">Analyse en cours… (30–60 secondes)</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NeoButton, NeoMessage, useNeoToast } from '@neolibrary/components'
import api from '@/lib/api'
import axios from 'axios'

interface Section { title: string; content: string }
interface CahierPreview {
  formData?: Record<string, unknown>
  aiContent?: {
    objectifDocument?: string
    contexte?: string
    objectifProjet?: string | unknown
    perimetreInclus?: string | unknown
    perimetreExclus?: string | unknown
    exigencesFonctionnelles?: Section[]
    architectureTechnique?: Section[]
    livrables?: string | unknown
    conclusion?: string
  }
}

const props = defineProps<{
  projectId?: string
  aiOutput?: string | null
}>()

const toast = useNeoToast()
const generating = ref<boolean>(false)
const result = ref<CahierPreview['aiContent'] | null>(null)
const errorMsg = ref<string | null>(null)
const savedAt = ref<string | null>(null)

// On mount, load any previously-saved cahier so the user sees the last result
// without waiting for the AI to regenerate.
import { onMounted } from 'vue'
onMounted(async () => {
  if (!props.projectId) return
  try {
    const { data } = await api.get<{ aiContent: CahierPreview['aiContent'] | null; savedAt: string | null }>(
      `/pm/projects/${props.projectId}/cahier-des-charges/saved`,
    )
    if (data?.aiContent) {
      result.value = data.aiContent
      savedAt.value = data.savedAt
    }
  } catch {
    // silent — empty state will be shown
  }
})

function stringify(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === 'string' ? `- ${x}` : typeof x === 'object' && x ? `- ${JSON.stringify(x)}` : String(x),
      )
      .join('\n')
  }
  return JSON.stringify(v, null, 2)
}

async function handleGenerate(): Promise<void> {
  if (!props.projectId) {
    errorMsg.value = 'Identifiant projet manquant.'
    return
  }
  errorMsg.value = null
  generating.value = true
  try {
    const { data } = await api.get<CahierPreview>(
      `/pm/projects/${props.projectId}/cahier-des-charges/preview`,
      { timeout: 270_000 },
    )
    // Defensive: a misconfigured cache (proxy / browser) could return an
    // empty 304-body even after we added Cache-Control: no-store. Treat the
    // missing payload as an explicit "AI returned nothing" error instead of
    // crashing on `data.aiContent` and showing a generic toast.
    if (!data || !data.aiContent) {
      errorMsg.value = "La génération a renvoyé une réponse vide. Réessayez dans un instant."
      return
    }
    result.value = data.aiContent
    // Persist so the Cahier + Validation tabs can read the same content
    try {
      await api.post(`/pm/projects/${props.projectId}/cahier-des-charges/save`, { aiContent: result.value })
      savedAt.value = new Date().toISOString()
    } catch {
      // non-fatal — preview still visible in-memory
    }
    toast.add({ severity: 'success', detail: 'Analyse générée et enregistrée.', life: 3000 })
  } catch (e: unknown) {
    const status = axios.isAxiosError(e) ? e.response?.status : undefined
    if (status === 404) {
      errorMsg.value = "Projet introuvable ou vous n'avez pas accès."
    } else if (status === 500) {
      errorMsg.value = "Le service IA est temporairement indisponible. Réessayez dans un instant."
    } else {
      errorMsg.value = 'Erreur lors de la génération.'
    }
  } finally {
    generating.value = false
  }
}

async function handleDownloadDocx(): Promise<void> {
  if (!props.projectId) return
  try {
    const response = await api.get<Blob>(
      `/pm/projects/${props.projectId}/cahier-des-charges/generate`,
      { responseType: 'blob', timeout: 270_000 },
    )
    const url = URL.createObjectURL(response.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `cahier-des-charges-${props.projectId.slice(0, 8)}.docx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.add({ severity: 'success', detail: 'Cahier des charges téléchargé.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: 'Erreur lors du téléchargement.', life: 4000 })
  }
}
</script>

<style scoped>
.ai-section { display: flex; flex-direction: column; gap: 1.25rem; }

.ai-header { display: flex; align-items: center; gap: 1rem; }

.ai-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--nl-accent), var(--nl-info, #6366f1));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ai-icon { font-size: 1.25rem; color: #fff; }

.ai-title { font-size: 1rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.ai-sub   { font-size: 0.82rem; color: var(--nl-text-3); margin: 0.15rem 0 0; }
.ai-saved { color: var(--nl-accent); font-weight: 500; margin-left: 0.3rem; }

.ai-output {
  background: var(--nl-surface-2, #f8fafc);
  border: 1px solid var(--nl-border);
  border-left: 4px solid var(--nl-accent);
  border-radius: var(--nl-radius);
  padding: 1.25rem 1.5rem;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--nl-text-2);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.ai-output section { display: flex; flex-direction: column; gap: 0.35rem; }
.ai-output h4 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--nl-text-1);
}
.ai-output h5 {
  margin: 0.3rem 0 0.15rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--nl-accent);
}
.ai-output p { margin: 0; }
.ai-output .pre { white-space: pre-wrap; }
.ai-subsection { margin-bottom: 0.6rem; }

.ai-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  padding-top: 0.6rem;
  border-top: 1px solid var(--nl-border);
}

.ai-empty, .ai-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 3rem;
  color: var(--nl-text-3);
  background: var(--nl-surface-2);
  border-radius: var(--nl-radius);
  border: 1px dashed var(--nl-border);
  text-align: center;
}
.ai-empty-icon { font-size: 2rem; color: var(--nl-accent); }
.ai-empty-text { margin: 0; font-size: 0.875rem; }
</style>
