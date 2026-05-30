<!--
  @file     MagicLoginView.vue
  @desc     Passwordless sign-in — reads ?token= from the URL and POSTs it to
            /auth/magic-login. On success stores the JWT and redirects; if the
            account has 2FA it shows a TOTP challenge. POST-verify (not GET) so
            an email-scanner prefetch cannot silently consume the single-use link.
-->
<template>
  <div class="ml-page">
    <div class="ml-card">
      <div class="ml-header">
        <span class="ml-logo"><NeoMark /></span>
        <h1 class="ml-title">Connexion</h1>
      </div>

      <!-- Verifying -->
      <template v-if="state === 'verifying'">
        <div class="ml-status">
          <i class="pi pi-spin pi-spinner ml-status__spinner" />
          <p class="ml-status__text">Vérification de votre lien de connexion…</p>
        </div>
      </template>

      <!-- TOTP challenge (account has 2FA) -->
      <template v-else-if="state === 'totp'">
        <p class="ml-subtitle">
          Saisissez le code à 6 chiffres affiché dans votre application d'authentification.
        </p>
        <form class="ml-form" novalidate @submit.prevent="handleTotp">
          <NeoInputText
            id="ml-totp-code"
            v-model="totpCode"
            label="Code d'authentification"
            placeholder="123456"
            :disabled="loading"
            autocomplete="one-time-code"
            inputmode="numeric"
            maxlength="6"
            class="w-full"
          />
          <NeoMessage v-if="totpError" severity="error" :text="totpError" />
          <NeoButton
            type="submit"
            label="Vérifier"
            icon="pi pi-check"
            :loading="loading"
            :disabled="totpCode.length !== 6"
            class="ml-submit"
          />
        </form>
      </template>

      <!-- Invalid / expired -->
      <template v-else>
        <div class="ml-status">
          <i class="pi pi-exclamation-triangle ml-status__error-icon" />
          <p class="ml-status__text">{{ errorMsg }}</p>
          <RouterLink to="/login" class="ml-btn">
            <i class="pi pi-sign-in" /> Retour à la connexion
          </RouterLink>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NeoButton, NeoInputText, NeoMessage } from '@neolibrary/components'
import { useAuthStore } from '@/stores/authStore'
import NeoMark from '@/components/common/NeoMark.vue'

type State = 'verifying' | 'totp' | 'error'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const token = route.query.token as string | undefined

const state = ref<State>('verifying')
const loading = ref(false)
const errorMsg = ref<string>('Lien de connexion invalide ou expiré.')

// TOTP step (when the account has 2FA enabled)
const tempToken = ref('')
const totpCode = ref('')
const totpError = ref<string | null>(null)

function redirectAfterLogin(): void {
  // Use replace (not push) so the token-bearing URL is not retained in history.
  // /app has a role-based redirect child — let the router decide the landing.
  router.replace({ name: 'app-home' })
}

async function verify(): Promise<void> {
  if (!token) {
    state.value = 'error'
    errorMsg.value = 'Lien de connexion invalide ou manquant.'
    return
  }
  // Strip the single-use token from the address bar + current history entry as
  // early as possible so it can't leak via history, referrer, or a shared URL.
  try {
    window.history.replaceState({}, '', '/magic-login')
  } catch {
    // Non-browser / older environments — best-effort scrub.
  }
  try {
    const result = await authStore.magicLogin(token)
    if (result.requiresTotp && result.tempToken) {
      tempToken.value = result.tempToken
      state.value = 'totp'
    } else {
      redirectAfterLogin()
    }
  } catch {
    state.value = 'error'
    errorMsg.value = 'Lien de connexion invalide ou expiré. Veuillez en demander un nouveau.'
  }
}

async function handleTotp(): Promise<void> {
  totpError.value = null
  loading.value = true
  try {
    await authStore.loginTotp(tempToken.value, totpCode.value)
    redirectAfterLogin()
  } catch {
    totpError.value = "Code invalide. Vérifiez votre application d'authentification."
    totpCode.value = ''
  } finally {
    loading.value = false
  }
}

onMounted(verify)
</script>

<style scoped>
.ml-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nl-surface-1, #f3f4f6);
  padding: 1.5rem;
}

.ml-card {
  width: 100%;
  max-width: 420px;
  background: var(--nl-surface);
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.09);
  padding: 2.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.ml-header { text-align: center; }

.ml-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  margin-bottom: 1rem;
  padding: 10px;
  box-sizing: border-box;
  background: #0a0a0b;
  color: var(--nl-accent);
}

.ml-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--nl-text-1, #111827);
  margin: 0;
}

.ml-subtitle {
  font-size: 0.875rem;
  color: var(--nl-text-3, #6b7280);
  margin: 0;
  text-align: center;
}

.ml-form { display: flex; flex-direction: column; gap: 1rem; }
.ml-submit { width: 100%; }

.ml-status {
  text-align: center;
  padding: 1rem 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.ml-status__spinner { font-size: 2rem; color: var(--nl-accent); }
.ml-status__error-icon { font-size: 2.5rem; color: #dc2626; }

.ml-status__text {
  font-size: 0.9375rem;
  color: var(--nl-text-1, #111827);
  margin: 0;
}

.ml-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.5rem;
  background: var(--nl-accent);
  color: var(--nl-on-accent);
  border-radius: 8px;
  font-weight: 600;
  text-decoration: none;
  font-size: 0.9rem;
}
.ml-btn:hover { background: var(--nl-accent-hover); }
</style>
