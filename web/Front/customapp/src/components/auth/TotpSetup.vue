<!--
  @file     TotpSetup.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Two-step 2FA setup wizard:
              Step 1 — Calls /auth/2fa/setup, displays QR code + manual secret
              Step 2 — User enters 6-digit code to confirm, calls /auth/2fa/enable
            Emits 'enabled' on success, 'cancel' on abort.
-->
<template>
  <div class="totp-setup">

    <!-- ── Step 1: QR code display ──────────────────────────────────────────── -->
    <template v-if="step === 1">
      <div class="setup-header">
        <i class="pi pi-qrcode setup-icon" aria-hidden="true" />
        <h3 class="setup-title">Configurer l'authentification à deux facteurs</h3>
        <p class="setup-sub">
          Scannez le QR code ci-dessous avec votre application (Google Authenticator, Authy, etc.)
          ou saisissez le code manuellement.
        </p>
      </div>

      <div v-if="loadingSetup" class="setup-loading">
        <i class="pi pi-spin pi-spinner" aria-hidden="true" />
        Génération du code…
      </div>

      <template v-else-if="qrCode">
        <div class="qr-wrapper" aria-label="QR code d'authentification">
          <img :src="qrCode" alt="QR code 2FA" class="qr-image" />
        </div>

        <div class="secret-box">
          <p class="secret-label">Code manuel :</p>
          <code class="secret-value">{{ secret }}</code>
        </div>

        <NeoMessage
          severity="info"
          text="Une fois le QR code scanné, cliquez sur Continuer pour confirmer la configuration."
          class="info-msg"
        />

        <div class="setup-actions">
          <NeoButton
            label="Continuer"
            icon="pi pi-arrow-right"
            @click="step = 2"
          />
          <NeoButton
            label="Annuler"
            outlined
            severity="secondary"
            @click="emit('cancel')"
          />
        </div>
      </template>

      <NeoMessage
        v-if="setupError"
        severity="error"
        :text="setupError"
        class="info-msg"
      />
    </template>

    <!-- ── Step 2: Confirmation code ─────────────────────────────────────────── -->
    <template v-else>
      <div class="setup-header">
        <i class="pi pi-check-circle setup-icon" aria-hidden="true" />
        <h3 class="setup-title">Confirmer la configuration</h3>
        <p class="setup-sub">
          Saisissez le code à 6 chiffres affiché dans votre application pour finaliser l'activation.
        </p>
      </div>

      <form @submit.prevent="handleEnable" novalidate>
        <div class="field-group">
          <label for="totp-confirm-code" class="field-label">Code d'authentification</label>
          <NeoInputText
            id="totp-confirm-code"
            ref="confirmInputRef"
            v-model="confirmCode"
            placeholder="123456"
            :disabled="loading"
            autocomplete="one-time-code"
            inputmode="numeric"
            maxlength="6"
          />
        </div>

        <NeoMessage
          v-if="confirmError"
          severity="error"
          :text="confirmError"
          :closable="true"
          @close="confirmError = null"
          class="info-msg"
        />

        <div class="setup-actions">
          <NeoButton
            type="submit"
            label="Activer la 2FA"
            icon="pi pi-shield"
            :loading="loading"
            :disabled="confirmCode.length !== 6"
          />
          <NeoButton
            label="Retour"
            outlined
            severity="secondary"
            :disabled="loading"
            @click="step = 1"
          />
        </div>
      </form>
    </template>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue'
import axios from 'axios'
import { NeoInputText, NeoButton, NeoMessage } from '@neolibrary/components'
import { useApp } from '@/stores/useApp'

const emit = defineEmits<{
  (e: 'enabled'): void
  (e: 'cancel'): void
}>()

const app = useApp()

const step          = ref<1 | 2>(1)
const qrCode        = ref<string>('')
const secret        = ref<string>('')
const loadingSetup  = ref(true)
const setupError    = ref<string | null>(null)
const confirmCode   = ref('')
const confirmError  = ref<string | null>(null)
const loading       = ref(false)
const confirmInputRef = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  try {
    const res = await axios.post(
      app.apiUrl + '/auth/2fa/setup',
      {},
      { headers: app.authHeader() },
    )
    qrCode.value = res.data.qrCode
    secret.value = res.data.secret
  } catch {
    setupError.value = 'Impossible de générer la configuration 2FA. Veuillez réessayer.'
  } finally {
    loadingSetup.value = false
  }
})

watch(step, async (newStep) => {
  if (newStep === 2) {
    await nextTick()
    confirmInputRef.value?.focus()
  }
})

const handleEnable = async () => {
  confirmError.value = null
  loading.value      = true
  try {
    await axios.post(
      app.apiUrl + '/auth/2fa/enable',
      { code: confirmCode.value },
      { headers: app.authHeader() },
    )
    emit('enabled')
  } catch {
    confirmError.value = 'Code invalide. Réessayez avec le code actuel de votre application.'
    confirmCode.value  = ''
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.totp-setup {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.setup-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.setup-icon {
  font-size: 1.75rem;
  color: var(--nl-accent);
  margin-bottom: 0.25rem;
}

.setup-title {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
}

.setup-sub {
  font-size: 0.875rem;
  color: var(--nl-text-3);
  line-height: 1.5;
  margin: 0;
}

.setup-loading {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--nl-text-3);
  font-size: 0.875rem;
}

.qr-wrapper {
  display: flex;
  justify-content: center;
  padding: 1rem;
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
}

.qr-image {
  width: 180px;
  height: 180px;
  display: block;
}

.secret-box {
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.secret-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--nl-text-3);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.secret-value {
  font-family: monospace;
  font-size: 0.9rem;
  color: var(--nl-text-1);
  word-break: break-all;
  letter-spacing: 0.1em;
}

.info-msg {
  margin-top: 0.25rem;
}

.setup-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.field-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--nl-text-2);
}
</style>
