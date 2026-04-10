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
      <div class="portal-topbar__left">
        <span class="portal-topbar__brand">NeoLeadge</span>
        <span v-if="project" class="portal-topbar__project-name">{{ project.projectName }}</span>
        <span v-if="project" class="portal-topbar__client-name">{{ project.clientName }}</span>
      </div>
      <span class="portal-topbar__badge">Portail Client</span>
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

      <!-- Phase stepper -->
      <div class="portal-stepper">
        <div
          v-for="(phase, index) in PHASES"
          :key="phase.id"
          class="portal-stepper__item"
        >
          <div class="portal-stepper__track">
            <div
              v-if="index > 0"
              :class="[
                'portal-stepper__line',
                getPhaseState(PHASES[index - 1].id, project.status) === 'done' ? 'portal-stepper__line--done' : '',
              ]"
            />
            <div
              :class="[
                'portal-stepper__dot',
                'portal-stepper__dot--' + getPhaseState(phase.id, project.status),
              ]"
            >
              <i v-if="getPhaseState(phase.id, project.status) === 'done'" class="pi pi-check" aria-hidden="true" />
              <span v-else>{{ index + 1 }}</span>
            </div>
            <div
              v-if="index < PHASES.length - 1"
              :class="[
                'portal-stepper__line',
                getPhaseState(phase.id, project.status) === 'done' ? 'portal-stepper__line--done' : '',
              ]"
            />
          </div>
          <span
            :class="[
              'portal-stepper__label',
              'portal-stepper__label--' + getPhaseState(phase.id, project.status),
            ]"
          >{{ phase.label }}</span>
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
              <span
                :class="[
                  'portal-signoff-badge',
                  signoff.isApproved ? 'portal-signoff-badge--approved' : 'portal-signoff-badge--rejected',
                ]"
              >
                {{ signoff.isApproved ? 'Approuvé' : 'Refusé' }}
              </span>
              <span class="portal-signoff-card__date">{{ formatDate(signoff.signedAt) }}</span>
            </div>
            <p v-if="signoff.comment" class="portal-signoff-card__comment">
              {{ signoff.comment }}
            </p>
          </div>
        </div>
      </div>

      <!-- Sign-off form card -->
      <div class="portal-signoff-form-card">
        <h2 class="portal-section__title">Soumettre votre avis</h2>

        <!-- Already signed off (stored in localStorage) -->
        <div v-if="alreadySigned" class="portal-already-signed">
          <i class="pi pi-check-circle" aria-hidden="true" />
          Vous avez déjà soumis votre avis pour ce lien.
        </div>

        <!-- Success after submit -->
        <div v-else-if="submitSuccess" class="portal-submit-success">
          <div class="portal-submit-success__checkmark" aria-hidden="true">
            <i class="pi pi-check" />
          </div>
          <p class="portal-submit-success__title">Merci pour votre retour !</p>
          <p class="portal-submit-success__text">Votre avis a bien été enregistré.</p>
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
            <button
              type="button"
              class="portal-btn portal-btn--approve"
              :disabled="submitting"
              @click="submitWithDecision(true)"
            >
              <span v-if="submitting && pendingDecision === true" class="portal-btn__spinner" aria-hidden="true" />
              <i v-else class="pi pi-check" aria-hidden="true" />
              Approuver
            </button>
            <button
              type="button"
              class="portal-btn portal-btn--reject"
              :disabled="submitting"
              @click="submitWithDecision(false)"
            >
              <span v-if="submitting && pendingDecision === false" class="portal-btn__spinner portal-btn__spinner--light" aria-hidden="true" />
              <i v-else class="pi pi-times" aria-hidden="true" />
              Refuser
            </button>
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
import { NeoInputText } from '@neolibrary/components'
import { useConfigStore } from '@/stores/configStore'

// ── Types ──────────────────────────────────────────────────────────────────

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
  background: var(--nl-bg, #F8FAFC);
  font-family: var(--nl-font, 'Inter', system-ui, sans-serif);
  font-size: 14px;
  color: var(--nl-text-1);
}

/* ── Top bar ─────────────────────────────────────────────────────────────── */
.portal-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: #ffffff;
  border-bottom: 1px solid var(--nl-border);
  position: sticky;
  top: 0;
  z-index: 10;
}

.portal-topbar__left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.portal-topbar__brand {
  font-size: 15px;
  font-weight: 800;
  color: var(--nl-accent, #0F62FE);
  letter-spacing: -0.3px;
}

.portal-topbar__project-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--nl-text-1);
  padding-left: 12px;
  border-left: 1px solid var(--nl-border);
}

.portal-topbar__client-name {
  font-size: 13px;
  color: var(--nl-text-3);
}

.portal-topbar__badge {
  font-size: 12px;
  font-weight: 500;
  color: var(--nl-text-3);
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: 20px;
  padding: 3px 12px;
}

/* ── Content ─────────────────────────────────────────────────────────────── */
.portal-content {
  flex: 1;
  width: 100%;
  max-width: 800px;
  margin: 32px auto;
  padding: 0 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.portal-content--centered {
  align-items: center;
  justify-content: center;
}

/* ── Skeleton ────────────────────────────────────────────────────────────── */
.skeleton-card {
  background: #ffffff;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg, 12px);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skeleton {
  background: linear-gradient(90deg, #F1F5F9 25%, #E9EEF4 50%, #F1F5F9 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 6px;
}

.skeleton--title { height: 20px; width: 50%; }
.skeleton--line  { height: 14px; width: 100%; }
.skeleton--short { width: 38%; }

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Error card ──────────────────────────────────────────────────────────── */
.portal-error-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  background: #ffffff;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg, 12px);
  padding: 48px 32px;
  max-width: 440px;
  width: 100%;
}

.portal-error-card__icon {
  font-size: 40px;
  color: var(--nl-text-3);
}

.portal-error-card__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--nl-text-1);
}

.portal-error-card__text {
  margin: 0;
  font-size: 14px;
  color: var(--nl-text-3);
  line-height: 1.5;
}

/* ── Phase stepper ───────────────────────────────────────────────────────── */
.portal-stepper {
  display: flex;
  align-items: flex-start;
  overflow-x: auto;
  padding: 20px 24px;
  background: #ffffff;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg, 12px);
  gap: 0;
}

.portal-stepper__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 80px;
}

.portal-stepper__track {
  display: flex;
  align-items: center;
  width: 100%;
}

.portal-stepper__line {
  flex: 1;
  height: 2px;
  background: var(--nl-border);
  transition: background 0.25s;
}

.portal-stepper__line--done {
  background: var(--nl-accent, #0F62FE);
}

.portal-stepper__dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  transition: all 0.2s;
  position: relative;
  z-index: 1;
}

.portal-stepper__dot--pending {
  background: var(--nl-surface-2);
  border: 2px solid var(--nl-border);
  color: var(--nl-text-3);
}

.portal-stepper__dot--done {
  background: var(--nl-accent, #0F62FE);
  border: 2px solid var(--nl-accent, #0F62FE);
  color: #fff;
}

.portal-stepper__dot--active {
  background: #ffffff;
  border: 2px solid var(--nl-accent, #0F62FE);
  color: var(--nl-accent, #0F62FE);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--nl-accent, #0F62FE) 15%, transparent);
}

.portal-stepper__label {
  font-size: 12px;
  color: var(--nl-text-3);
  margin-top: 8px;
  text-align: center;
  line-height: 1.3;
  max-width: 80px;
}

.portal-stepper__label--done {
  color: var(--nl-accent, #0F62FE);
  font-weight: 500;
}

.portal-stepper__label--active {
  color: var(--nl-text-1);
  font-weight: 600;
}

/* ── Section ─────────────────────────────────────────────────────────────── */
.portal-section {
  background: #ffffff;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg, 12px);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.portal-section__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--nl-text-1);
  letter-spacing: -0.01em;
}

/* ── Field values grid ───────────────────────────────────────────────────── */
.portal-fields-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.portal-field-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.portal-field-item__label {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--nl-text-3);
}

.portal-field-item__value {
  font-size: 14px;
  font-weight: 500;
  color: var(--nl-text-1);
  line-height: 1.4;
}

/* ── Dates ───────────────────────────────────────────────────────────────── */
.portal-dates-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.portal-date-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #ffffff;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg, 12px);
  padding: 16px 20px;
  flex: 1;
  min-width: 160px;
}

.portal-date-item__label {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--nl-text-3);
}

.portal-date-item__value {
  font-size: 15px;
  font-weight: 600;
  color: var(--nl-text-1);
}

/* ── Sign-offs ───────────────────────────────────────────────────────────── */
.portal-empty {
  font-size: 13px;
  color: var(--nl-text-3);
  font-style: italic;
}

.portal-signoffs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.portal-signoff-card {
  border: 1px solid var(--nl-border);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--nl-surface-2);
}

.portal-signoff-card__header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.portal-signoff-card__name {
  font-weight: 600;
  font-size: 14px;
  color: var(--nl-text-1);
}

.portal-signoff-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 500;
}

.portal-signoff-badge--approved {
  background: #F0FDF4;
  color: #16A34A;
}

.portal-signoff-badge--rejected {
  background: #FEF2F2;
  color: #DC2626;
}

.portal-signoff-card__date {
  font-size: 12px;
  color: var(--nl-text-3);
  margin-left: auto;
}

.portal-signoff-card__comment {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--nl-text-2);
  line-height: 1.5;
}

/* ── Sign-off form card ──────────────────────────────────────────────────── */
.portal-signoff-form-card {
  max-width: 480px;
  margin: 0 auto;
  width: 100%;
  padding: 32px;
  background: #ffffff;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg, 12px);
  box-shadow: var(--nl-shadow-md);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.portal-signoff-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.portal-form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.portal-form-full {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.portal-textarea-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--nl-text-2);
}

.portal-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius, 8px);
  font-size: 14px;
  font-family: inherit;
  color: var(--nl-text-1);
  background: var(--nl-surface);
  resize: vertical;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}

.portal-textarea:focus {
  outline: none;
  border-color: var(--nl-accent, #0F62FE);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nl-accent, #0F62FE) 15%, transparent);
}

.portal-textarea:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.portal-form-error {
  font-size: 13px;
  color: #DC2626;
  padding: 10px 12px;
  background: #FEF2F2;
  border: 1px solid #FECACA;
  border-radius: var(--nl-radius, 8px);
}

.portal-form-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}

/* ── Decision buttons ────────────────────────────────────────────────────── */
.portal-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 48px;
  border-radius: var(--nl-radius, 8px);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  border: none;
  outline: none;
}

.portal-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.portal-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.portal-btn--approve {
  background: #16A34A;
  color: #ffffff;
}

.portal-btn--approve:hover:not(:disabled) {
  opacity: 0.9;
}

.portal-btn--reject {
  background: transparent;
  color: var(--nl-danger, #DC2626);
  border: 1px solid var(--nl-danger, #DC2626);
}

.portal-btn--reject:hover:not(:disabled) {
  background: #FEF2F2;
}

/* ── Spinner ─────────────────────────────────────────────────────────────── */
.portal-btn__spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

.portal-btn__spinner--light {
  border-color: rgba(220, 38, 38, 0.3);
  border-top-color: var(--nl-danger, #DC2626);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Already signed / Success ────────────────────────────────────────────── */
.portal-already-signed {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--nl-radius, 8px);
  font-size: 14px;
  font-weight: 500;
  background: #FEFCE8;
  border: 1px solid #FEF08A;
  color: #713F12;
}

.portal-submit-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 16px;
  text-align: center;
  animation: fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.portal-submit-success__checkmark {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #F0FDF4;
  border: 2px solid #BBF7D0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #16A34A;
  font-size: 22px;
  animation: popIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes popIn {
  from { transform: scale(0.5); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

.portal-submit-success__title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--nl-text-1);
}

.portal-submit-success__text {
  margin: 0;
  font-size: 13px;
  color: var(--nl-text-3);
}

/* ── Footer ──────────────────────────────────────────────────────────────── */
.portal-footer {
  text-align: center;
  padding: 20px 24px;
  font-size: 12px;
  color: var(--nl-text-3);
  border-top: 1px solid var(--nl-border);
  background: #ffffff;
  margin-top: auto;
}

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 600px) {
  .portal-content {
    margin: 16px auto;
    padding: 0 16px;
  }

  .portal-form-row {
    grid-template-columns: 1fr;
  }

  .portal-topbar__project-name,
  .portal-topbar__client-name {
    display: none;
  }

  .portal-signoff-form-card {
    padding: 20px 16px;
  }
}
</style>
