<!--
  @file     ForceChangePasswordView.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-27
  @desc     Forced password change on first login — full-page card, no navigation away
-->
<template>
  <div class="fcp-page">
    <div class="fcp-card">
      <div class="fcp-header">
        <div class="fcp-logo">NL</div>
        <h1 class="fcp-title">Définir votre mot de passe</h1>
        <p class="fcp-subtitle">
          Pour des raisons de sécurité, vous devez définir un nouveau mot de passe avant de continuer.
        </p>
      </div>

      <form class="fcp-form" @submit.prevent="handleSubmit">
        <div class="field">
          <NeoPassword
            v-model="newPassword"
            label="Nouveau mot de passe"
            placeholder="••••••••"
            :disabled="loading"
            toggleMask
            :feedback="true"
            autocomplete="new-password"
            class="w-full"
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
            class="w-full"
          />
        </div>

        <NeoMessage v-if="errorMsg" severity="error" :text="errorMsg" class="w-full" />

        <NeoButton
          type="submit"
          label="Définir le mot de passe"
          :loading="loading"
          :disabled="!newPassword || !confirmPassword"
          class="w-full submit-btn"
        />
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { NeoPassword, NeoButton, NeoMessage } from '@neolibrary/components'
import { useApp } from '@/stores/useApp'

const router = useRouter()
const app    = useApp()

const newPassword     = ref('')
const confirmPassword = ref('')
const errorMsg        = ref<string | null>(null)
const loading         = ref(false)

const handleSubmit = async () => {
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
    await axios.post(
      `${app.apiUrl}/auth/change-password`,
      { currentPassword: '', newPassword: newPassword.value },
      { headers: app.authHeader() },
    )
    app.mustChangePassword = false
    const role = app.userRole
    if (role === 'Admin') router.push({ name: 'admin' })
    else if (role === 'ProjectManager') router.push({ name: 'pm' })
    else router.push({ name: 'team' })
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
  background: #f1f5f9;
}

.fcp-card {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
  padding: 2.5rem 2rem;
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

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
  border-radius: 12px;
  background: #0d9488;
  color: #fff;
  font-size: 1.2rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.5px;
}

.fcp-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
}

.fcp-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: #64748b;
  line-height: 1.5;
}

.fcp-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.submit-btn {
  margin-top: 0.25rem;
}
</style>
