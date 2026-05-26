<!--
  @file     ForgotPasswordView.vue
  @desc     Self-service forgot password — sends a reset link by email
-->
<template>
  <div class="fp-page">
    <div class="fp-card">
      <div class="fp-header">
        <div class="fp-logo" aria-label="Neo Project">NP</div>
        <h1 class="fp-title">Mot de passe oublié</h1>
        <p class="fp-subtitle">
          Saisissez votre adresse e-mail. Si un compte y est associé, vous recevrez un lien pour réinitialiser votre mot de passe.
        </p>
      </div>

      <template v-if="!sent">
        <form class="fp-form" novalidate @submit.prevent="handleSubmit">
          <div class="field">
            <NeoInputText
              v-model="email"
              label="Adresse e-mail"
              placeholder="jean.dupont@archimed.fr"
              type="email"
              :disabled="loading"
              autocomplete="email"
            />
          </div>

          <NeoMessage v-if="errorMsg" severity="error" :text="errorMsg" />

          <NeoButton
            type="submit"
            label="Envoyer le lien"
            icon="pi pi-send"
            :loading="loading"
            :disabled="!email.trim()"
            class="fp-submit"
          />
        </form>
      </template>

      <template v-else>
        <div class="fp-success">
          <i class="pi pi-check-circle fp-success__icon" />
          <p class="fp-success__text">
            Si l'adresse <strong>{{ email }}</strong> correspond à un compte actif, un e-mail de réinitialisation vous a été envoyé.
          </p>
          <p class="fp-success__note">Vérifiez également vos spams.</p>
        </div>
      </template>

      <RouterLink to="/login" class="fp-back">
        <i class="pi pi-arrow-left" /> Retour à la connexion
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NeoButton, NeoInputText, NeoMessage } from '@neolibrary/components'
import api from '@/lib/api'
import axios from 'axios'

const email = ref<string>('')
const loading = ref<boolean>(false)
const sent = ref<boolean>(false)
const errorMsg = ref<string | null>(null)

async function handleSubmit(): Promise<void> {
  errorMsg.value = null
  loading.value = true
  try {
    await api.post('/auth/forgot-password', { email: email.value.trim() })
    sent.value = true
  } catch (e: unknown) {
    if (axios.isAxiosError(e) && e.response?.status === 429) {
      errorMsg.value = 'Trop de tentatives. Veuillez réessayer dans une minute.'
    } else {
      errorMsg.value = 'Une erreur est survenue. Veuillez réessayer.'
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.fp-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nl-surface-1, #f3f4f6);
  padding: 1.5rem;
}

.fp-card {
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

.fp-header { text-align: center; }

.fp-logo {
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

.fp-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--nl-text-1, #111827);
  margin: 0 0 0.5rem;
}

.fp-subtitle {
  font-size: 0.875rem;
  color: var(--nl-text-3, #6b7280);
  margin: 0;
  line-height: 1.5;
}

.fp-form { display: flex; flex-direction: column; gap: 1rem; }

.fp-submit { width: 100%; }

.fp-success {
  text-align: center;
  padding: 1rem 0;
}

.fp-success__icon {
  font-size: 2.5rem;
  color: #0d9488;
  display: block;
  margin-bottom: 1rem;
}

.fp-success__text {
  font-size: 0.9375rem;
  color: var(--nl-text-1, #111827);
  line-height: 1.6;
  margin: 0 0 0.5rem;
}

.fp-success__note {
  font-size: 0.8125rem;
  color: var(--nl-text-3, #6b7280);
  margin: 0;
}

.fp-back {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  color: #0d9488;
  text-decoration: none;
  font-weight: 500;
}
.fp-back:hover { text-decoration: underline; }
</style>
