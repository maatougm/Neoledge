<!--
  @file     SecuritySection.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Security settings section for user profile — 2FA status + enable/disable workflow.
            Embedded in UserProfileView.vue in the settings panels area.
-->
<template>
  <section class="settings-panel" aria-labelledby="panel-2fa-title">
    <div class="panel-header">
      <i class="pi pi-shield panel-icon" aria-hidden="true" />
      <h2 id="panel-2fa-title" class="panel-title">Authentification à deux facteurs (2FA)</h2>
    </div>

    <div class="panel-body">

      <!-- Loading state -->
      <div v-if="loadingStatus" class="status-loading">
        <i class="pi pi-spin pi-spinner" aria-hidden="true" />
        Vérification du statut 2FA…
      </div>

      <!-- Error loading status -->
      <NeoMessage
        v-else-if="statusError"
        severity="error"
        :text="statusError"
        class="panel-msg"
      />

      <!-- 2FA enabled -->
      <template v-else-if="totpEnabled">
        <div class="status-row status-row--enabled">
          <i class="pi pi-check-circle status-icon status-icon--success" aria-hidden="true" />
          <div class="status-info">
            <p class="status-title">2FA activée</p>
            <p class="status-desc">Votre compte est protégé par l'authentification à deux facteurs.</p>
          </div>
        </div>

        <!-- Disable 2FA: ask for code -->
        <template v-if="!showDisableForm">
          <div class="panel-actions">
            <NeoButton
              label="Désactiver la 2FA"
              icon="pi pi-times-circle"
              severity="danger"
              outlined
              @click="showDisableForm = true"
            />
          </div>
        </template>

        <template v-else>
          <p class="disable-prompt">
            Saisissez votre code actuel pour confirmer la désactivation.
          </p>
          <form @submit.prevent="handleDisable" novalidate>
            <div class="field-group">
              <label for="totp-disable-code" class="field-label">Code d'authentification</label>
              <NeoInputText
                id="totp-disable-code"
                v-model="disableCode"
                placeholder="123456"
                :disabled="loadingAction"
                autocomplete="one-time-code"
                inputmode="numeric"
                maxlength="6"
              />
            </div>
            <NeoMessage
              v-if="actionError"
              severity="error"
              :text="actionError"
              :closable="true"
              @close="actionError = null"
              class="panel-msg"
            />
            <div class="panel-actions">
              <NeoButton
                type="submit"
                label="Confirmer la désactivation"
                icon="pi pi-shield"
                severity="danger"
                :loading="loadingAction"
                :disabled="disableCode.length !== 6"
              />
              <NeoButton
                label="Annuler"
                outlined
                severity="secondary"
                :disabled="loadingAction"
                @click="cancelDisable"
              />
            </div>
          </form>
        </template>
      </template>

      <!-- 2FA disabled -->
      <template v-else>
        <div class="status-row status-row--disabled">
          <i class="pi pi-times-circle status-icon status-icon--danger" aria-hidden="true" />
          <div class="status-info">
            <p class="status-title">2FA désactivée</p>
            <p class="status-desc">
              Activez l'authentification à deux facteurs pour renforcer la sécurité de votre compte.
            </p>
          </div>
        </div>

        <!-- Setup wizard -->
        <template v-if="!showSetup">
          <div class="panel-actions">
            <NeoButton
              label="Activer la 2FA"
              icon="pi pi-shield"
              @click="showSetup = true"
            />
          </div>
        </template>

        <template v-else>
          <TotpSetup
            @enabled="onTotpEnabled"
            @cancel="showSetup = false"
          />
        </template>
      </template>

    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoInputText, NeoButton, NeoMessage } from '@neolibrary/components'
import { useNeoToast } from '@neolibrary/components'
import api from '@/lib/api'
import TotpSetup from '@/components/auth/TotpSetup.vue'

const toast = useNeoToast()

const totpEnabled   = ref(false)
const loadingStatus = ref(true)
const statusError   = ref<string | null>(null)

const showSetup      = ref(false)
const showDisableForm = ref(false)
const disableCode    = ref('')
const loadingAction  = ref(false)
const actionError    = ref<string | null>(null)

onMounted(fetchStatus)

async function fetchStatus() {
  loadingStatus.value = true
  statusError.value   = null
  try {
    const res = await api.get('/auth/2fa/status')
    totpEnabled.value = res.data.totpEnabled ?? false
  } catch {
    statusError.value = 'Impossible de récupérer le statut 2FA. Veuillez rafraîchir la page.'
  } finally {
    loadingStatus.value = false
  }
}

const onTotpEnabled = () => {
  showSetup.value   = false
  totpEnabled.value = true
  toast.add({ severity: 'success', detail: '2FA activée avec succès.', life: 4000 })
}

const cancelDisable = () => {
  showDisableForm.value = false
  disableCode.value     = ''
  actionError.value     = null
}

const handleDisable = async () => {
  actionError.value  = null
  loadingAction.value = true
  try {
    await api.post('/auth/2fa/disable', { code: disableCode.value })
    totpEnabled.value     = false
    showDisableForm.value = false
    disableCode.value     = ''
    toast.add({ severity: 'success', detail: '2FA désactivée.', life: 4000 })
  } catch {
    actionError.value = 'Code invalide. Réessayez avec le code actuel de votre application.'
    disableCode.value = ''
  } finally {
    loadingAction.value = false
  }
}
</script>

<style scoped>
.settings-panel {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--nl-border);
  background: var(--nl-surface-2);
}

.panel-icon {
  font-size: 1.125rem;
  color: var(--nl-accent);
}

.panel-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--nl-text-1);
  margin: 0;
}

.panel-body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.status-loading {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--nl-text-3);
  font-size: 0.875rem;
}

.status-row {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem;
  border-radius: var(--nl-radius);
}

.status-row--enabled {
  background: color-mix(in srgb, var(--nl-success, #22c55e) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--nl-success, #22c55e) 20%, transparent);
}

.status-row--disabled {
  background: color-mix(in srgb, var(--nl-danger, #ef4444) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--nl-danger, #ef4444) 20%, transparent);
}

.status-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
  margin-top: 0.1rem;
}

.status-icon--success { color: var(--nl-success, #22c55e); }
.status-icon--danger  { color: var(--nl-danger, #ef4444); }

.status-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.status-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--nl-text-1);
  margin: 0;
}

.status-desc {
  font-size: 0.875rem;
  color: var(--nl-text-3);
  line-height: 1.5;
  margin: 0;
}

.disable-prompt {
  font-size: 0.875rem;
  color: var(--nl-text-2);
  margin: 0;
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

.panel-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.panel-msg {
  margin-top: 0.25rem;
}
</style>
