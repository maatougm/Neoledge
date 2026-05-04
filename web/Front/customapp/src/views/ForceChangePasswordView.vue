<!--
  @file     ForceChangePasswordView.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Forced password change on first login — redesigned with strength indicator
-->
<template>
  <div class="fcp-page">
    <div class="fcp-card">

      <!-- Header -->
      <div class="fcp-header">
        <div class="fcp-logo" aria-label="NeoLeadge">NL</div>
        <h1 class="fcp-title">Définir votre mot de passe</h1>
        <p class="fcp-subtitle">
          Pour des raisons de sécurité, vous devez définir un nouveau mot de passe avant de continuer.
        </p>
      </div>

      <!-- Form -->
      <form class="fcp-form" novalidate @submit.prevent="handleSubmit">

        <div class="field">
          <NeoPassword
            v-model="newPassword"
            label="Nouveau mot de passe"
            placeholder="••••••••"
            :disabled="loading"
            toggleMask
            :feedback="false"
            autocomplete="new-password"
            class="w-full"
          />

          <!-- Strength bar -->
          <div class="strength-bar" aria-label="Force du mot de passe" role="progressbar" :aria-valuenow="strengthScore" aria-valuemin="0" aria-valuemax="4">
            <div
              v-for="i in 4"
              :key="i"
              :class="['strength-bar__segment', i <= strengthScore ? `strength-bar__segment--${strengthColor}` : '']"
            />
          </div>
          <span v-if="newPassword" class="strength-label" :class="`strength-label--${strengthColor}`">
            {{ strengthLabel }}
          </span>
        </div>

        <!-- Requirements checklist -->
        <ul v-if="newPassword" class="requirements" aria-label="Exigences du mot de passe">
          <li
            v-for="req in requirements"
            :key="req.key"
            :class="['requirements__item', req.met ? 'requirements__item--met' : '']"
          >
            <i
              :class="['pi', req.met ? 'pi-check-circle' : 'pi-circle', 'requirements__icon']"
              aria-hidden="true"
            />
            {{ req.label }}
          </li>
        </ul>

        <div class="field">
          <NeoPassword
            v-model="confirmPassword"
            label="Confirmer le mot de passe"
            placeholder="••••••••"
            :disabled="loading"
            toggleMask
            :feedback="false"
            autocomplete="new-password"
            class="w-full"
          />
        </div>

        <NeoMessage v-if="errorMsg" severity="error" :text="errorMsg" class="w-full" />

        <NeoButton
          type="submit"
          label="Définir le mot de passe"
          icon="pi pi-lock"
          :loading="loading"
          :disabled="!newPassword || !confirmPassword"
          class="w-full submit-btn"
        />
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { NeoPassword, NeoButton, NeoMessage } from '@neolibrary/components'
import { useAuthStore } from '@/stores/authStore'
import api from '@/lib/api'

const router    = useRouter()
const authStore = useAuthStore()

const newPassword     = ref('')
const confirmPassword = ref('')
const errorMsg        = ref<string | null>(null)
const loading         = ref(false)

// ── Password requirements ──────────────────────────────────────────────────────
interface Requirement {
  key:   string
  label: string
  met:   boolean
}

const requirements = computed<Requirement[]>(() => [
  { key: 'length',    label: 'Au moins 8 caractères',  met: newPassword.value.length >= 8 },
  { key: 'uppercase', label: 'Une lettre majuscule',   met: /[A-Z]/.test(newPassword.value) },
  { key: 'number',    label: 'Un chiffre',             met: /[0-9]/.test(newPassword.value) },
])

const strengthScore = computed<number>(() =>
  requirements.value.filter(r => r.met).length,
)

const strengthColor = computed<string>(() => {
  if (strengthScore.value <= 1) return 'weak'
  if (strengthScore.value === 2) return 'fair'
  return 'strong'
})

const strengthLabel = computed<string>(() => {
  if (strengthScore.value <= 1) return 'Faible'
  if (strengthScore.value === 2) return 'Correct'
  return 'Fort'
})

// ── Submit ─────────────────────────────────────────────────────────────────────
const handleSubmit = async (): Promise<void> => {
  errorMsg.value = null

  if (newPassword.value.length < 8) {
    errorMsg.value = 'Le mot de passe doit contenir au moins 8 caractères.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMsg.value = 'Les mots de passe ne correspondent pas.'
    return
  }

  loading.value = true
  try {
    await api.post('/auth/change-password', { currentPassword: '', newPassword: newPassword.value })
    authStore.mustChangePassword = false
    router.push({ name: 'app-home' })
  } catch {
    errorMsg.value = 'Erreur lors de la mise à jour du mot de passe. Veuillez réessayer.'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.fcp-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nl-bg);
  font-family: var(--nl-font);
  padding: 2rem;
}

.fcp-card {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow-lg);
  padding: 2.5rem 2rem;
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  animation: fadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Header ─────────────────────────────────────────────────────────────────── */
.fcp-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
}

.fcp-logo {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: var(--nl-accent);
  color: #fff;
  font-size: 1.15rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.fcp-title {
  margin: 0.25rem 0 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--nl-text-1);
}

.fcp-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--nl-text-3);
  line-height: 1.5;
}

/* ── Form ────────────────────────────────────────────────────────────────────── */
.fcp-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* ── Strength bar ────────────────────────────────────────────────────────────── */
.strength-bar {
  display: flex;
  gap: 4px;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
}

.strength-bar__segment {
  flex: 1;
  background: var(--nl-border);
  border-radius: 2px;
  transition: background 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.strength-bar__segment--weak   { background: var(--nl-danger); }
.strength-bar__segment--fair   { background: var(--nl-warning); }
.strength-bar__segment--strong { background: var(--nl-success); }

.strength-label {
  font-size: 0.75rem;
  font-weight: 600;
}

.strength-label--weak   { color: var(--nl-danger); }
.strength-label--fair   { color: var(--nl-warning); }
.strength-label--strong { color: var(--nl-success); }

/* ── Requirements checklist ─────────────────────────────────────────────────── */
.requirements {
  list-style: none;
  margin: 0;
  padding: 0.875rem 1rem;
  background: color-mix(in srgb, var(--nl-accent) 5%, var(--nl-surface));
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.requirements__item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--nl-text-3);
  transition: color 0.2s;
}

.requirements__item--met {
  color: var(--nl-success);
}

.requirements__icon {
  font-size: 0.8rem;
  flex-shrink: 0;
  transition: color 0.2s;
}

.requirements__item--met .requirements__icon {
  color: var(--nl-success);
}

.submit-btn {
  margin-top: 0.25rem;
}
</style>
