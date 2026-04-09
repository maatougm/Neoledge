<!--
  @file     TotpChallenge.vue
  @module   NeoLeadge — Deployment Manager
  @desc     TOTP 2FA challenge shown after password-based login when totpEnabled=true.
            Emits 'success' after successful verification (JWT stored in Pinia).
            Emits 'cancel' when user wants to go back.
-->
<template>
  <div class="totp-challenge">
    <div class="challenge-header">
      <i class="pi pi-shield challenge-icon" aria-hidden="true" />
      <h2 class="challenge-title">Vérification à deux facteurs</h2>
      <p class="challenge-sub">
        Saisissez le code à 6 chiffres affiché dans votre application d'authentification.
      </p>
    </div>

    <form class="challenge-form" @submit.prevent="handleSubmit" novalidate>
      <div class="field-group">
        <label for="totp-challenge-code" class="field-label">Code d'authentification</label>
        <NeoInputText
          id="totp-challenge-code"
          ref="inputRef"
          v-model="code"
          placeholder="123456"
          :disabled="loading"
          autocomplete="one-time-code"
          inputmode="numeric"
          maxlength="6"
        />
      </div>

      <NeoMessage
        v-if="errorMsg"
        severity="error"
        :text="errorMsg"
        :closable="true"
        @close="errorMsg = null"
      />

      <NeoButton
        type="submit"
        label="Vérifier le code"
        :loading="loading"
        :disabled="code.length !== 6"
        class="submit-btn"
      />

      <button type="button" class="back-btn" @click="emit('cancel')">
        Retour à la connexion
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoInputText, NeoButton, NeoMessage } from '@neolibrary/components'
import { useApp } from '@/stores/useApp'

const props = defineProps<{
  tempToken: string
}>()

const emit = defineEmits<{
  (e: 'success'): void
  (e: 'cancel'): void
}>()

const app    = useApp()
const code   = ref('')
const loading = ref(false)
const errorMsg = ref<string | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

onMounted(() => {
  inputRef.value?.focus()
})

const handleSubmit = async () => {
  errorMsg.value = null
  loading.value  = true
  try {
    await app.loginTotp(props.tempToken, code.value)
    emit('success')
  } catch {
    errorMsg.value = 'Code invalide. Vérifiez votre application d\'authentification.'
    code.value     = ''
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.totp-challenge {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.challenge-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.challenge-icon {
  font-size: 2rem;
  color: var(--nl-accent);
  margin-bottom: 0.25rem;
}

.challenge-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--nl-text-1);
}

.challenge-sub {
  font-size: 0.875rem;
  color: var(--nl-text-3);
  line-height: 1.5;
}

.challenge-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--nl-text-2);
}

.submit-btn {
  width: 100%;
}

.back-btn {
  background: none;
  border: none;
  color: var(--nl-text-3);
  font-size: 0.8125rem;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
  text-align: center;
  font-family: var(--nl-font);
}

.back-btn:hover {
  color: var(--nl-text-1);
}
</style>
