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
      <div>
        <h3 class="ptm__title">Liens portail client</h3>
        <p class="ptm__sub">Partagez un lien sécurisé avec votre client pour qu'il puisse consulter et valider le projet.</p>
      </div>
      <NeoButton
        label="Générer un lien"
        icon="pi pi-link"
        @click="showForm = !showForm"
        :outlined="showForm"
      />
    </div>

    <!-- Generate form -->
    <Transition name="slide-down">
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
      <span class="ptm__generated-url__label">Lien généré :</span>
      <code class="ptm__generated-url__code">{{ generatedUrl }}</code>
      <NeoButton
        :label="copied ? 'Copié !' : 'Copier'"
        :icon="copied ? 'pi pi-check' : 'pi pi-copy'"
        outlined
        size="small"
        @click="copyUrl"
      />
    </div>

    <!-- Error -->
    <div v-if="error" class="ptm__error">{{ error }}</div>

    <!-- Loading state -->
    <div v-if="loading" class="ptm__loading">
      <i class="pi pi-spin pi-spinner" /> Chargement…
    </div>

    <!-- Token list -->
    <div v-else-if="tokens.length === 0" class="ptm__empty">
      Aucun lien généré pour ce projet.
    </div>

    <div v-else class="ptm__list">
      <div
        v-for="t in tokens"
        :key="t.id"
        :class="['ptm__token-row', { 'ptm__token-row--revoked': t.isRevoked, 'ptm__token-row--expired': isExpired(t) }]"
      >
        <div class="ptm__token-info">
          <div class="ptm__token-label">
            {{ t.label || '(sans libellé)' }}
            <NeoTag
              v-if="t.isRevoked"
              value="Révoqué"
              severity="danger"
            />
            <NeoTag
              v-else-if="isExpired(t)"
              value="Expiré"
              severity="secondary"
            />
            <NeoTag
              v-else
              value="Actif"
              severity="success"
            />
          </div>
          <div class="ptm__token-meta">
            <span>Expire le {{ formatDate(t.expiresAt) }}</span>
            <span class="ptm__token-meta__sep">·</span>
            <span>{{ t.accessCount }} accès</span>
            <span v-if="t.signoffCount > 0" class="ptm__token-meta__sep">·</span>
            <span v-if="t.signoffCount > 0">{{ t.signoffCount }} avis</span>
          </div>
        </div>

        <div class="ptm__token-actions">
          <NeoButton
            v-if="!t.isRevoked && !isExpired(t)"
            icon="pi pi-copy"
            outlined
            size="small"
            title="Copier le lien"
            @click="copyTokenUrl(t)"
          />
          <NeoButton
            v-if="!t.isRevoked"
            icon="pi pi-ban"
            outlined
            severity="danger"
            size="small"
            title="Révoquer ce lien"
            :loading="revokingId === t.id"
            @click="handleRevoke(t.id)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoButton, NeoTag, NeoInputText, NeoSelect, useNeoToast } from '@neolibrary/components'
import api from '@/lib/api'
import { useConfigStore } from '@/stores/configStore'

// ── Types ──────────────────────────────────────────────────────────────────

interface TokenSummary {
  id: string
  token: string
  label: string | null
  url: string
  expiresAt: string
  isRevoked: boolean
  accessCount: number
  lastAccessedAt: string | null
  createdAt: string
  signoffCount: number
}

// ── Props ──────────────────────────────────────────────────────────────────

const props = defineProps<{ projectId: string }>()

// ── Store / composables ────────────────────────────────────────────────────

const toast = useNeoToast()
const configStore = useConfigStore()

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
  { label: '7 jours', value: 7 },
  { label: '30 jours', value: 30 },
  { label: '90 jours', value: 90 },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(d: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(d))
}

function isExpired(t: TokenSummary): boolean {
  return !t.isRevoked && new Date(t.expiresAt) < new Date()
}

function buildFullUrl(token: string): string {
  const base = window.location.origin
  return `${base}/portal/${token}`
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

/* Header */
.ptm__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.ptm__title {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  font-weight: 700;
  color: var(--nl-text-1);
}

.ptm__sub {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--nl-text-3);
  max-width: 480px;
  line-height: 1.4;
}

/* Generate form */
.ptm__generate-form {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 1rem;
  background: var(--nl-surface-2, #f9fafb);
  border: 1px dashed var(--nl-border, #e5e7eb);
  border-radius: 8px;
}

.ptm__form-label-input { flex: 2; min-width: 180px; }
.ptm__form-expiry      { flex: 1; min-width: 150px; }

/* Slide-down transition */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  max-height: 0;
}
.slide-down-enter-to,
.slide-down-leave-from {
  opacity: 1;
  max-height: 200px;
}

/* Generated URL */
.ptm__generated-url {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  flex-wrap: wrap;
}

.ptm__generated-url__label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #14532d;
  white-space: nowrap;
}

.ptm__generated-url__code {
  font-family: 'Courier New', monospace;
  font-size: 0.8125rem;
  color: #065f46;
  background: #d1fae5;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  word-break: break-all;
  flex: 1;
}

/* Error */
.ptm__error {
  font-size: 0.875rem;
  color: #dc2626;
  padding: 0.5rem 0.75rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
}

/* Loading */
.ptm__loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--nl-text-3);
  padding: 1rem 0;
}

/* Empty */
.ptm__empty {
  font-size: 0.875rem;
  color: var(--nl-text-3);
  font-style: italic;
  padding: 0.5rem 0;
}

/* Token list */
.ptm__list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ptm__token-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  background: var(--nl-surface, #fff);
  gap: 1rem;
  flex-wrap: wrap;
}

.ptm__token-row--revoked {
  opacity: 0.55;
  background: var(--nl-surface-2, #f9fafb);
}

.ptm__token-row--expired {
  opacity: 0.65;
}

.ptm__token-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.ptm__token-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--nl-text-1);
  flex-wrap: wrap;
}

.ptm__token-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--nl-text-3);
}

.ptm__token-meta__sep { opacity: 0.4; }

.ptm__token-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
