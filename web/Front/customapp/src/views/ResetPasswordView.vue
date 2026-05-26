<!--
  @file     ResetPasswordView.vue
  @desc     Token-based password reset — reads ?token= from URL query
-->
<template>
  <div class="rp-page">
    <div class="rp-card">
      <div class="rp-header">
        <div class="rp-logo" aria-label="Neo Project">NP</div>
        <h1 class="rp-title">Nouveau mot de passe</h1>
        <p class="rp-subtitle">Choisissez un mot de passe sécurisé d'au moins 8 caractères.</p>
      </div>

      <!-- Invalid / missing token -->
      <template v-if="!token">
        <div class="rp-invalid">
          <i class="pi pi-exclamation-triangle rp-invalid__icon" />
          <p>Lien de réinitialisation invalide ou manquant.</p>
          <RouterLink to="/forgot-password" class="rp-link">Faire une nouvelle demande</RouterLink>
        </div>
      </template>

      <!-- Success -->
      <template v-else-if="done">
        <div class="rp-success">
          <i class="pi pi-check-circle rp-success__icon" />
          <p class="rp-success__text">Votre mot de passe a été réinitialisé avec succès.</p>
          <RouterLink to="/login" class="rp-btn">
            <i class="pi pi-sign-in" /> Se connecter
          </RouterLink>
        </div>
      </template>

      <!-- Form -->
      <template v-else>
        <form class="rp-form" novalidate @submit.prevent="handleSubmit">
          <div class="field">
            <NeoPassword
              v-model="newPassword"
              label="Nouveau mot de passe"
              placeholder="••••••••"
              :disabled="loading"
              toggleMask
              :feedback="false"
              autocomplete="new-password"
            />
          </div>

          <div class="field">
            <NeoPassword
              v-model="confirmPassword"
              label="Confirmer le mot de passe"
              placeholder="••••••••"
              :disabled="loading"
              toggleMask
              :feedback="false"
              autocomplete="new-password"
            />
          </div>

          <NeoMessage v-if="errorMsg" severity="error" :text="errorMsg" />

          <NeoButton
            type="submit"
            label="Réinitialiser le mot de passe"
            icon="pi pi-lock"
            :loading="loading"
            :disabled="!newPassword || !confirmPassword"
            class="rp-submit"
          />
        </form>
      </template>

      <RouterLink v-if="!done" to="/login" class="rp-back">
        <i class="pi pi-arrow-left" /> Retour à la connexion
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { NeoButton, NeoPassword, NeoMessage } from '@neolibrary/components'
import api from '@/lib/api'
import axios from 'axios'
import { applyAutofill } from '@/lib/autofillFix'

const route = useRoute()
const token = route.query.token as string | undefined

const newPassword = ref<string>('')
const confirmPassword = ref<string>('')
const loading = ref<boolean>(false)
const done = ref<boolean>(false)
const errorMsg = ref<string | null>(null)

onMounted(async () => {
  await nextTick()
  applyAutofill({ scope: 'form', password: 'new-password', passwordSecond: 'new-password' })
})

async function handleSubmit(): Promise<void> {
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
    await api.post('/auth/reset-password', { token, newPassword: newPassword.value })
    done.value = true
  } catch (e: unknown) {
    if (axios.isAxiosError(e) && e.response?.status === 401) {
      errorMsg.value = 'Lien expiré ou invalide. Veuillez refaire une demande de réinitialisation.'
    } else {
      errorMsg.value = 'Une erreur est survenue. Veuillez réessayer.'
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.rp-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nl-surface-1, #f3f4f6);
  padding: 1.5rem;
}

.rp-card {
  width: 100%;
  max-width: 420px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.09);
  padding: 2.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.rp-header { text-align: center; }

.rp-logo {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: #0d9488;
  color: #fff;
  font-size: 1.1rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.rp-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--nl-text-1, #111827);
  margin: 0 0 0.5rem;
}

.rp-subtitle {
  font-size: 0.875rem;
  color: var(--nl-text-3, #6b7280);
  margin: 0;
}

.rp-form { display: flex; flex-direction: column; gap: 1rem; }

.rp-submit { width: 100%; }

.rp-invalid, .rp-success {
  text-align: center;
  padding: 1rem 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.rp-invalid__icon {
  font-size: 2.5rem;
  color: #dc2626;
}

.rp-success__icon {
  font-size: 2.5rem;
  color: #0d9488;
}

.rp-success__text {
  font-size: 0.9375rem;
  color: var(--nl-text-1, #111827);
  margin: 0;
}

.rp-link, .rp-back {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  color: #0d9488;
  text-decoration: none;
  font-weight: 500;
}
.rp-link:hover, .rp-back:hover { text-decoration: underline; }

.rp-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.5rem;
  background: #0d9488;
  color: #fff;
  border-radius: 8px;
  font-weight: 600;
  text-decoration: none;
  font-size: 0.9rem;
}
.rp-btn:hover { background: #0f766e; }
</style>
