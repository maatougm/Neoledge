<!--
  @file     ClientPortalView.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Public client portal — read-only project view + sign-off form.
            Standalone layout (no AppShell, no sidebar, no topbar).
  @robots   noindex (meta tag injected below)
-->
<template>
  <!-- robots: noindex -->
  <div class="portal-page">
    <!-- ── Top bar ─────────────────────────────────────────────────────────── -->
    <header class="portal-topbar">
      <span class="portal-topbar__brand">NeoLeadge</span>
      <span class="portal-topbar__label">Portail Client</span>
    </header>

    <!-- ── Loading skeleton ───────────────────────────────────────────────── -->
    <main v-if="state === 'loading'" class="portal-content">
      <div class="skeleton-card">
        <div class="skeleton skeleton--title" />
        <div class="skeleton skeleton--line" />
        <div class="skeleton skeleton--line skeleton--short" />
      </div>
      <div class="skeleton-card">
        <div class="skeleton skeleton--line" />
        <div class="skeleton skeleton--line" />
        <div class="skeleton skeleton--line skeleton--short" />
      </div>
    </main>

    <!-- ── Error / Expired ────────────────────────────────────────────────── -->
    <main v-else-if="state === 'error'" class="portal-content portal-content--centered">
      <div class="portal-error-card">
        <i class="pi pi-lock portal-error-card__icon" />
        <h2 class="portal-error-card__title">Lien invalide</h2>
        <p class="portal-error-card__text">{{ errorMessage }}</p>
      </div>
    </main>

    <!-- ── Loaded project view ────────────────────────────────────────────── -->
    <main v-else-if="state === 'loaded' && project" class="portal-content">

      <!-- Project header -->
      <div class="portal-project-header">
        <div class="portal-project-header__info">
          <h1 class="portal-project-header__name">{{ project.projectName }}</h1>
          <p class="portal-project-header__client">{{ project.clientName }}</p>
        </div>
        <NeoTag
          :value="STATUS_LABELS[project.status] ?? project.status"
          :severity="(STATUS_SEVERITY[project.status] ?? 'secondary') as TagSeverity"
        />
      </div>

      <!-- Phase stepper -->
      <div class="portal-stepper">
        <div
          v-for="(phase, index) in PHASES"
          :key="phase.id"
          class="portal-stepper__item"
        >
          <div
            :class="[
              'portal-stepper__dot',
              getPhaseState(phase.id, project.status),
            ]"
          >
            <i v-if="getPhaseState(phase.id, project.status) === 'done'" class="pi pi-check" />
            <span v-else>{{ index + 1 }}</span>
          </div>
          <span class="portal-stepper__label">{{ phase.label }}</span>
          <div v-if="index < PHASES.length - 1" class="portal-stepper__connector" />
        </div>
      </div>

      <!-- Dates -->
      <div class="portal-dates-row">
        <div class="portal-date-item">
          <span class="portal-date-item__label">Date de début</span>
          <span class="portal-date-item__value">{{ formatDate(project.startDate) }}</span>
        </div>
        <div class="portal-date-item">
          <span class="portal-date-item__label">Date de fin prévue</span>
          <span class="portal-date-item__value">{{ formatDate(project.endDate) }}</span>
        </div>
      </div>

      <!-- Field values -->
      <div v-if="project.fieldValues.length > 0" class="portal-section">
        <h2 class="portal-section__title">Informations du projet</h2>
        <div class="portal-fields-grid">
          <div
            v-for="fv in project.fieldValues"
            :key="fv.label"
            class="portal-field-item"
          >
            <span class="portal-field-item__label">{{ fv.label }}</span>
            <span class="portal-field-item__value">{{ fv.value ?? '—' }}</span>
          </div>
        </div>
      </div>

      <!-- Existing sign-offs -->
      <div class="portal-section">
        <h2 class="portal-section__title">Avis clients</h2>
        <div v-if="project.signoffs.length === 0" class="portal-empty">
          Aucun avis soumis pour le moment.
        </div>
        <div v-else class="portal-signoffs">
          <div
            v-for="signoff in project.signoffs"
            :key="signoff.id"
            class="portal-signoff-card"
          >
            <div class="portal-signoff-card__header">
              <span class="portal-signoff-card__name">{{ signoff.clientName }}</span>
              <NeoTag
                :value="signoff.isApproved ? 'Approuvé' : 'Refusé'"
                :severity="signoff.isApproved ? 'success' : 'danger'"
              />
              <span class="portal-signoff-card__date">{{ formatDate(signoff.signedAt) }}</span>
            </div>
            <p v-if="signoff.comment" class="portal-signoff-card__comment">
              {{ signoff.comment }}
            </p>
          </div>
        </div>
      </div>

      <!-- Sign-off form -->
      <div class="portal-section">
        <h2 class="portal-section__title">Soumettre votre avis</h2>

        <!-- Already signed off (stored in localStorage) -->
        <div v-if="alreadySigned" class="portal-already-signed">
          <i class="pi pi-check-circle" />
          Vous avez déjà soumis votre avis pour ce lien.
        </div>

        <!-- Success after submit -->
        <div v-else-if="submitSuccess" class="portal-submit-success">
          <i class="pi pi-check-circle" />
          Votre avis a bien été enregistré. Merci !
        </div>

        <!-- Form -->
        <form v-else class="portal-signoff-form" @submit.prevent="handleSubmit">
          <div class="portal-form-row">
            <NeoInputText
              v-model="form.clientName"
              label="Votre nom *"
              placeholder="Jean Dupont"
              :disabled="submitting"
            />
            <NeoInputText
              v-model="form.clientEmail"
              label="Email (optionnel)"
              placeholder="jean@exemple.com"
              :disabled="submitting"
            />
          </div>
          <div class="portal-form-full">
            <label class="portal-textarea-label">Commentaire (optionnel)</label>
            <textarea
              v-model="form.comment"
              class="portal-textarea"
              rows="4"
              placeholder="Vos remarques ou observations..."
              :disabled="submitting"
            />
          </div>
          <div v-if="formError" class="portal-form-error">{{ formError }}</div>
          <div class="portal-form-actions">
            <NeoButton
              label="Approuver"
              icon="pi pi-check"
              :loading="submitting && pendingDecision === true"
              :disabled="submitting"
              @click="submitWithDecision(true)"
              type="button"
            />
            <NeoButton
              label="Refuser"
              icon="pi pi-times"
              outlined
              severity="danger"
              :loading="submitting && pendingDecision === false"
              :disabled="submitting"
              @click="submitWithDecision(false)"
              type="button"
            />
          </div>
        </form>
      </div>
    </main>

    <!-- ── Footer ─────────────────────────────────────────────────────────── -->
    <footer class="portal-footer">
      Propulsé par <strong>NeoLeadge</strong>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { NeoButton, NeoTag, NeoInputText } from '@neolibrary/components'
import { useConfigStore } from '@/stores/configStore'

// ── Types ──────────────────────────────────────────────────────────────────

type TagSeverity = 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast'

type ViewState = 'loading' | 'loaded' | 'error'

interface PortalSignoff {
  id: string
  clientName: string
  isApproved: boolean
  comment: string | null
  signedAt: string | Date
}

interface PortalProject {
  projectName: string
  clientName: string
  status: string
  startDate: string | Date
  endDate: string | Date
  fieldValues: Array<{ label: string; value: string | null }>
  signoffs: PortalSignoff[]
}

// ── Constants ──────────────────────────────────────────────────────────────

const PHASES = [
  { id: 'Draft',                   label: 'Brouillon' },
  { id: 'InProgress',              label: 'En cours' },
  { id: 'SpecificationValidation', label: 'Validation Spec.' },
  { id: 'Realization',             label: 'Réalisation' },
  { id: 'DeploymentValidation',    label: 'Validation Dépl.' },
  { id: 'Completed',               label: 'Terminé' },
]

const PHASE_ORDER: Record<string, number> = {
  Draft: 0,
  InProgress: 1,
  SpecificationValidation: 2,
  Realization: 3,
  DeploymentValidation: 4,
  Completed: 5,
  Archived: 6,
}

const STATUS_LABELS: Record<string, string> = {
  Draft: 'Brouillon',
  InProgress: 'En cours',
  SpecificationValidation: 'Validation Spec.',
  Realization: 'Réalisation',
  DeploymentValidation: 'Validation Dépl.',
  Completed: 'Terminé',
  Archived: 'Archivé',
}

const STATUS_SEVERITY: Record<string, TagSeverity> = {
  Draft: 'secondary',
  InProgress: 'info',
  SpecificationValidation: 'warning',
  Realization: 'warning',
  DeploymentValidation: 'warning',
  Completed: 'success',
  Archived: 'contrast',
}

// ── Composables ───────────────────────────────────────────────────────────

const route = useRoute()
const configStore = useConfigStore()

// ── State ─────────────────────────────────────────────────────────────────

const state = ref<ViewState>('loading')
const project = ref<PortalProject | null>(null)
const errorMessage = ref('Ce lien a expiré ou n\'est plus valide.')
const alreadySigned = ref(false)
const submitSuccess = ref(false)
const submitting = ref(false)
const pendingDecision = ref<boolean | null>(null)
const formError = ref<string | null>(null)

const form = ref({
  clientName: '',
  clientEmail: '',
  comment: '',
})

// ── Helpers ───────────────────────────────────────────────────────────────

function getPhaseState(phaseId: string, currentStatus: string): 'done' | 'active' | 'pending' {
  const phaseIdx = PHASE_ORDER[phaseId] ?? -1
  const currentIdx = PHASE_ORDER[currentStatus] ?? -1
  if (phaseIdx < currentIdx) return 'done'
  if (phaseIdx === currentIdx) return 'active'
  return 'pending'
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(d))
}

function getSignedKey(token: string): string {
  return `portal_signed_${token}`
}

// ── Load ──────────────────────────────────────────────────────────────────

onMounted(async () => {
  const token = route.params.token as string

  // Check localStorage first
  if (localStorage.getItem(getSignedKey(token))) {
    alreadySigned.value = true
  }

  if (!configStore.apiUrl) {
    try {
      await configStore.fetchConfig()
    } catch {
      state.value = 'error'
      errorMessage.value = 'Impossible de charger la configuration.'
      return
    }
  }

  try {
    const { data } = await axios.get<PortalProject>(
      `${configStore.apiUrl}/portal/${token}`,
    )
    project.value = data
    state.value = 'loaded'
  } catch (err: unknown) {
    state.value = 'error'
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 403) {
      errorMessage.value = 'Ce lien a expiré ou a été révoqué.'
    } else if (status === 404) {
      errorMessage.value = 'Ce lien est invalide ou n\'existe pas.'
    } else {
      errorMessage.value = 'Une erreur est survenue. Veuillez réessayer plus tard.'
    }
  }
})

// ── Submit ────────────────────────────────────────────────────────────────

async function submitWithDecision(decision: boolean): Promise<void> {
  formError.value = null

  if (!form.value.clientName.trim()) {
    formError.value = 'Votre nom est requis.'
    return
  }

  submitting.value = true
  pendingDecision.value = decision

  const token = route.params.token as string

  try {
    await axios.post(`${configStore.apiUrl}/portal/${token}/signoff`, {
      clientName: form.value.clientName.trim(),
      clientEmail: form.value.clientEmail.trim() || undefined,
      comment: form.value.comment.trim() || undefined,
      isApproved: decision,
    })

    // Persist in localStorage so "already signed" message shows on revisit
    localStorage.setItem(getSignedKey(token), '1')
    submitSuccess.value = true

    // Append new signoff to the local list for immediate UI feedback
    if (project.value) {
      project.value = {
        ...project.value,
        signoffs: [
          {
            id: Date.now().toString(),
            clientName: form.value.clientName.trim(),
            isApproved: decision,
            comment: form.value.comment.trim() || null,
            signedAt: new Date().toISOString(),
          },
          ...project.value.signoffs,
        ],
      }
    }
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    formError.value = msg ?? 'Une erreur est survenue. Veuillez réessayer.'
  } finally {
    submitting.value = false
    pendingDecision.value = null
  }
}

async function handleSubmit(): Promise<void> {
  // Form submit is handled via the buttons directly
}
</script>

<style scoped>
/* ── Page layout ─────────────────────────────────────────────────────────── */
.portal-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--nl-bg, #f9fafb);
  font-family: var(--nl-font, system-ui, sans-serif);
}

/* ── Top bar ─────────────────────────────────────────────────────────────── */
.portal-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 2rem;
  background: var(--nl-surface, #ffffff);
  border-bottom: 1px solid var(--nl-border, #e5e7eb);
  position: sticky;
  top: 0;
  z-index: 10;
}

.portal-topbar__brand {
  font-size: 1.125rem;
  font-weight: 800;
  color: var(--nl-accent, #0d9488);
  letter-spacing: -0.3px;
}

.portal-topbar__label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--nl-text-3, #9ca3af);
  background: var(--nl-surface-2, #f3f4f6);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 20px;
  padding: 0.2rem 0.75rem;
}

/* ── Content ─────────────────────────────────────────────────────────────── */
.portal-content {
  flex: 1;
  width: 100%;
  max-width: 860px;
  margin: 2rem auto;
  padding: 0 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.portal-content--centered {
  align-items: center;
  justify-content: center;
}

/* ── Skeleton ────────────────────────────────────────────────────────────── */
.skeleton-card {
  background: var(--nl-surface, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 12px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.skeleton {
  background: linear-gradient(90deg, #f3f4f6 25%, #e9eaeb 50%, #f3f4f6 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 6px;
}

.skeleton--title { height: 1.5rem; width: 55%; }
.skeleton--line  { height: 1rem;   width: 100%; }
.skeleton--short { width: 40%; }

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Error card ──────────────────────────────────────────────────────────── */
.portal-error-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  text-align: center;
  background: var(--nl-surface, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 12px;
  padding: 3rem 2rem;
  max-width: 440px;
  width: 100%;
}

.portal-error-card__icon {
  font-size: 2.5rem;
  color: var(--nl-text-3, #9ca3af);
}

.portal-error-card__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--nl-text-1, #111827);
}

.portal-error-card__text {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--nl-text-3, #6b7280);
  line-height: 1.5;
}

/* ── Project header ──────────────────────────────────────────────────────── */
.portal-project-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  background: var(--nl-surface, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 12px;
  padding: 1.5rem;
}

.portal-project-header__name {
  margin: 0 0 0.25rem;
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--nl-text-1, #111827);
}

.portal-project-header__client {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--nl-text-3, #6b7280);
}

/* ── Phase stepper ───────────────────────────────────────────────────────── */
.portal-stepper {
  display: flex;
  align-items: flex-start;
  overflow-x: auto;
  padding: 1.25rem 1.5rem;
  background: var(--nl-surface, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 12px;
  gap: 0;
}

.portal-stepper__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 80px;
  position: relative;
}

.portal-stepper__dot {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  border: 2px solid var(--nl-border, #e5e7eb);
  background: var(--nl-surface-2, #f3f4f6);
  color: var(--nl-text-3, #9ca3af);
  z-index: 1;
  transition: all 0.2s;
}

.portal-stepper__dot.done {
  background: var(--nl-accent, #0d9488);
  border-color: var(--nl-accent, #0d9488);
  color: #fff;
}

.portal-stepper__dot.active {
  background: #fff;
  border-color: var(--nl-accent, #0d9488);
  color: var(--nl-accent, #0d9488);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nl-accent, #0d9488) 15%, transparent);
}

.portal-stepper__label {
  font-size: 0.7rem;
  color: var(--nl-text-3, #9ca3af);
  margin-top: 0.4rem;
  text-align: center;
  line-height: 1.3;
}

.portal-stepper__connector {
  position: absolute;
  top: 1rem;
  left: calc(50% + 1rem);
  right: calc(-50% + 1rem);
  height: 2px;
  background: var(--nl-border, #e5e7eb);
  z-index: 0;
}

/* ── Dates ───────────────────────────────────────────────────────────────── */
.portal-dates-row {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.portal-date-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  background: var(--nl-surface, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 10px;
  padding: 0.875rem 1.25rem;
  flex: 1;
  min-width: 160px;
}

.portal-date-item__label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--nl-text-3, #9ca3af);
}

.portal-date-item__value {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--nl-text-1, #111827);
}

/* ── Section ─────────────────────────────────────────────────────────────── */
.portal-section {
  background: var(--nl-surface, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 12px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.portal-section__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--nl-text-1, #111827);
}

/* ── Field values grid ───────────────────────────────────────────────────── */
.portal-fields-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1rem;
}

.portal-field-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.portal-field-item__label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--nl-text-3, #9ca3af);
}

.portal-field-item__value {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--nl-text-1, #111827);
}

/* ── Sign-offs ───────────────────────────────────────────────────────────── */
.portal-empty {
  font-size: 0.875rem;
  color: var(--nl-text-3, #9ca3af);
  font-style: italic;
}

.portal-signoffs {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.portal-signoff-card {
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  padding: 0.875rem 1rem;
  background: var(--nl-surface-2, #f9fafb);
}

.portal-signoff-card__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.portal-signoff-card__name {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--nl-text-1, #111827);
}

.portal-signoff-card__date {
  font-size: 0.8rem;
  color: var(--nl-text-3, #9ca3af);
  margin-left: auto;
}

.portal-signoff-card__comment {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  color: var(--nl-text-2, #374151);
  line-height: 1.5;
}

/* ── Sign-off form ───────────────────────────────────────────────────────── */
.portal-signoff-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.portal-form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.portal-form-full {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.portal-textarea-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--nl-text-2, #374151);
}

.portal-textarea {
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--nl-border, #d1d5db);
  border-radius: 6px;
  font-size: 0.9375rem;
  font-family: inherit;
  color: var(--nl-text-1, #111827);
  background: var(--nl-surface, #fff);
  resize: vertical;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.portal-textarea:focus {
  outline: none;
  border-color: var(--nl-accent, #0d9488);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--nl-accent, #0d9488) 20%, transparent);
}

.portal-textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.portal-form-error {
  font-size: 0.875rem;
  color: #dc2626;
  padding: 0.5rem 0.75rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
}

.portal-form-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* ── Already signed / Success ────────────────────────────────────────────── */
.portal-already-signed,
.portal-submit-success {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  font-size: 0.9375rem;
  font-weight: 500;
}

.portal-already-signed {
  background: #fefce8;
  border: 1px solid #fef08a;
  color: #713f12;
}

.portal-submit-success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #14532d;
}

/* ── Footer ──────────────────────────────────────────────────────────────── */
.portal-footer {
  text-align: center;
  padding: 1.5rem;
  font-size: 0.8125rem;
  color: var(--nl-text-3, #9ca3af);
  border-top: 1px solid var(--nl-border, #e5e7eb);
  background: var(--nl-surface, #fff);
  margin-top: auto;
}

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 600px) {
  .portal-form-row {
    grid-template-columns: 1fr;
  }

  .portal-project-header {
    flex-direction: column;
  }
}
</style>
