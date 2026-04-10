<!--
  @file     PortalTokenManager.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Admin component to manage shareable client portal links for a project.
            Shows existing tokens with access stats and allows generating new ones.
-->
<template>
  <div class="ptm">
    <!-- Header -->
    <div class="ptm__header">
      <div class="ptm__header-text">
        <h3 class="ptm__title">Liens portail client</h3>
        <p class="ptm__sub">Partagez un lien sécurisé avec votre client pour qu'il puisse consulter et valider le projet.</p>
      </div>
      <NeoButton
        label="Générer un lien"
        icon="pi pi-link"
        :outlined="showForm"
        @click="showForm = !showForm"
      />
    </div>

    <!-- Generate form -->
    <Transition name="ptm-slide">
      <div v-if="showForm" class="ptm__generate-form">
        <NeoInputText
          v-model="newLabel"
          label="Libellé (optionnel)"
          placeholder="Ex : Validation phase 1"
          class="ptm__form-label-input"
        />
        <NeoSelect
          v-model="newExpiryDays"
          label="Durée de validité"
          :options="expiryOptions"
          optionLabel="label"
          optionValue="value"
          class="ptm__form-expiry"
        />
        <NeoButton
          label="Créer le lien"
          icon="pi pi-check"
          :loading="generating"
          @click="handleGenerate"
        />
      </div>
    </Transition>

    <!-- Generated URL display -->
    <div v-if="generatedUrl" class="ptm__generated-url">
      <span class="ptm__generated-label">Lien généré :</span>
      <code class="ptm__generated-code">{{ generatedUrl }}</code>
      <NeoButton
        :icon="copied ? 'pi pi-check' : 'pi pi-copy'"
        :label="copied ? 'Copié !' : 'Copier'"
        outlined
        size="small"
        @click="copyUrl"
      />
    </div>

    <!-- Error -->
    <div v-if="error" class="ptm__error">
      <i class="pi pi-exclamation-circle ptm__error-icon" />
      {{ error }}
    </div>

    <!-- Loading skeleton -->
    <template v-if="loading">
      <div v-for="n in 3" :key="n" class="ptm__skeleton" />
    </template>

    <!-- Empty state -->
    <div v-else-if="tokens.length === 0" class="ptm__empty">
      <i class="pi pi-link ptm__empty-icon" />
      <span>Aucun lien généré pour ce projet.</span>
    </div>

    <!-- Token table -->
    <div v-else class="ptm__table-wrap">
      <PortalTokenTable
        :tokens="tokens"
        :revoking-id="revokingId"
        @copy="copyTokenUrl"
        @revoke="handleRevoke"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoButton, NeoInputText, NeoSelect, useNeoToast } from '@neolibrary/components'
import api from '@/lib/api'
import PortalTokenTable from './PortalTokenTable.vue'
import type { TokenSummary } from './PortalTokenTable.vue'

// ── Props ──────────────────────────────────────────────────────────────────

const props = defineProps<{ projectId: string }>()

// ── Composables ────────────────────────────────────────────────────────────

const toast = useNeoToast()

// ── State ──────────────────────────────────────────────────────────────────

const tokens = ref<TokenSummary[]>([])
const loading = ref(false)
const generating = ref(false)
const revokingId = ref<string | null>(null)
const error = ref<string | null>(null)

const showForm = ref(false)
const newLabel = ref('')
const newExpiryDays = ref<number>(30)
const generatedUrl = ref<string | null>(null)
const copied = ref(false)

const expiryOptions = [
  { label: '7 jours',  value: 7  },
  { label: '30 jours', value: 30 },
  { label: '90 jours', value: 90 },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function buildFullUrl(token: string): string {
  return `${window.location.origin}/portal/${token}`
}

// ── Actions ────────────────────────────────────────────────────────────────

async function fetchTokens(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const { data } = await api.get<TokenSummary[]>(
      `/admin/projects/${props.projectId}/portal-tokens`,
    )
    tokens.value = [...data]
  } catch {
    error.value = 'Impossible de charger les liens.'
  } finally {
    loading.value = false
  }
}

async function handleGenerate(): Promise<void> {
  generating.value = true
  error.value = null
  generatedUrl.value = null
  try {
    const { data } = await api.post<{ id: string; token: string; url: string; expiresAt: string }>(
      `/admin/projects/${props.projectId}/portal-tokens`,
      {
        label: newLabel.value.trim() || undefined,
        expiresInDays: newExpiryDays.value,
      },
    )
    generatedUrl.value = buildFullUrl(data.token)
    newLabel.value = ''
    showForm.value = false
    await fetchTokens()
    toast.add({ severity: 'success', detail: 'Lien portail généré.', life: 3000 })
  } catch {
    error.value = 'Impossible de générer le lien.'
    toast.add({ severity: 'error', detail: 'Erreur lors de la génération du lien.', life: 4000 })
  } finally {
    generating.value = false
  }
}

async function handleRevoke(tokenId: string): Promise<void> {
  revokingId.value = tokenId
  try {
    await api.delete(`/admin/portal-tokens/${tokenId}`)
    tokens.value = tokens.value.map((t) =>
      t.id === tokenId ? { ...t, isRevoked: true } : t,
    )
    toast.add({ severity: 'info', detail: 'Lien révoqué.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: 'Erreur lors de la révocation.', life: 4000 })
  } finally {
    revokingId.value = null
  }
}

async function copyTokenUrl(t: TokenSummary): Promise<void> {
  try {
    await navigator.clipboard.writeText(buildFullUrl(t.token))
    toast.add({ severity: 'success', detail: 'Lien copié dans le presse-papiers.', life: 2000 })
  } catch {
    toast.add({ severity: 'error', detail: 'Impossible de copier le lien.', life: 3000 })
  }
}

async function copyUrl(): Promise<void> {
  if (!generatedUrl.value) return
  try {
    await navigator.clipboard.writeText(generatedUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    toast.add({ severity: 'error', detail: 'Impossible de copier le lien.', life: 3000 })
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(fetchTokens)
</script>

<style scoped>
.ptm {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
}

/* ── Header ─────────────────────────────────────────────────────────────────── */
.ptm__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.ptm__header-text { flex: 1; }

.ptm__title {
  margin: 0 0 0.25rem;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--nl-text-2);
}

.ptm__sub {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--nl-text-3);
  max-width: 480px;
  line-height: 1.4;
}

/* ── Generate form ──────────────────────────────────────────────────────────── */
.ptm__generate-form {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 1rem;
  background: var(--nl-surface-2);
  border: 1px dashed var(--nl-border-strong);
  border-radius: var(--nl-radius);
}

.ptm__form-label-input { flex: 2; min-width: 180px; }
.ptm__form-expiry      { flex: 1; min-width: 150px; }

/* ── Slide transition ──────────────────────────────────────────────────────── */
.ptm-slide-enter-active,
.ptm-slide-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.ptm-slide-enter-from,
.ptm-slide-leave-to { opacity: 0; max-height: 0; }
.ptm-slide-enter-to,
.ptm-slide-leave-from { opacity: 1; max-height: 200px; }

/* ── Generated URL ─────────────────────────────────────────────────────────── */
.ptm__generated-url {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--nl-success-light);
  border: 1px solid rgba(22, 163, 74, 0.3);
  border-radius: var(--nl-radius);
  flex-wrap: wrap;
}

.ptm__generated-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--nl-success);
  white-space: nowrap;
}

.ptm__generated-code {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 0.8125rem;
  color: var(--nl-success);
  background: var(--nl-surface-2);
  padding: 4px 8px;
  border-radius: var(--nl-radius-sm);
  word-break: break-all;
  flex: 1;
}

/* ── Error ─────────────────────────────────────────────────────────────────── */
.ptm__error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--nl-danger);
  padding: 0.5rem 0.75rem;
  background: var(--nl-danger-light);
  border: 1px solid rgba(220, 38, 38, 0.2);
  border-radius: var(--nl-radius-sm);
}

.ptm__error-icon { font-size: 0.875rem; }

/* ── Skeleton ──────────────────────────────────────────────────────────────── */
.ptm__skeleton {
  height: 48px;
  border-radius: var(--nl-radius);
  background: linear-gradient(90deg, var(--nl-surface-2) 25%, var(--nl-border) 50%, var(--nl-surface-2) 75%);
  background-size: 200% 100%;
  animation: ptm-shimmer 1.4s infinite;
}

@keyframes ptm-shimmer {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}

/* ── Empty state ────────────────────────────────────────────────────────────── */
.ptm__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  font-size: 0.875rem;
  color: var(--nl-text-3);
  text-align: center;
}

.ptm__empty-icon { font-size: 1.5rem; color: var(--nl-border-strong); }

/* ── Table wrapper ─────────────────────────────────────────────────────────── */
.ptm__table-wrap { overflow-x: auto; }
</style>
