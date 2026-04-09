<!--
  @file     LoginView.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Login page — split panel: dark brand left, light form right
-->
<template>
  <div class="login-page">
    <!-- LEFT: Brand panel -->
    <aside class="brand-panel" aria-hidden="true">
      <div class="brand-inner">
        <div class="brand-top">
          <div class="brand-mark">NL</div>
          <span class="brand-name">NeoLeadge</span>
        </div>

        <div class="brand-statement">
          <h2>Pilotez vos déploiements.<br />En toute clarté.</h2>
          <p>La plateforme de gestion de projets de déploiement pour les équipes Archimed.</p>
        </div>

        <ul class="brand-features">
          <li><span class="feat-check">✓</span>Gestion des projets et des équipes</li>
          <li><span class="feat-check">✓</span>Suivi des phases de validation</li>
          <li><span class="feat-check">✓</span>Tableaux de bord en temps réel</li>
          <li><span class="feat-check">✓</span>Gestion des droits par rôle</li>
        </ul>

        <!-- Abstract geometry -->
        <div class="geo geo--1" />
        <div class="geo geo--2" />
        <div class="geo geo--3" />
      </div>

      <p class="brand-footer">Archimed © 2026</p>
    </aside>

    <!-- RIGHT: Form panel -->
    <main class="form-panel">
      <div class="form-inner">
        <div v-if="!totpRequired" class="form-header">
          <h1 class="form-title">Connexion</h1>
          <p class="form-sub">Bienvenue. Connectez-vous à votre espace de travail.</p>
        </div>

        <form v-if="!totpRequired" class="form-fields" @submit.prevent="handleLogin" novalidate>
          <div class="field-group">
            <label for="login-email" class="field-label">Adresse e-mail</label>
            <NeoInputText
              id="login-email"
              v-model="email"
              placeholder="jean.dupont@archimed.fr"
              :disabled="loading"
              autocomplete="email"
            />
          </div>

          <div class="field-group">
            <label for="login-password" class="field-label">Mot de passe</label>
            <NeoPassword
              id="login-password"
              v-model="password"
              placeholder="••••••••"
              :disabled="loading"
              toggleMask
              :feedback="false"
              autocomplete="current-password"
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
            label="Se connecter"
            :loading="loading"
            :disabled="!email || !password"
            class="submit-btn"
          />
        </form>

        <!-- TOTP challenge panel (shown after step-1 success when 2FA required) -->
        <div v-if="totpRequired" class="totp-panel">
          <div class="totp-header">
            <i class="pi pi-shield totp-icon" aria-hidden="true" />
            <h2 class="totp-title">Vérification à deux facteurs</h2>
            <p class="totp-sub">Saisissez le code à 6 chiffres affiché dans votre application d'authentification.</p>
          </div>
          <form class="form-fields" @submit.prevent="handleTotpSubmit" novalidate>
            <div class="field-group">
              <label for="totp-code" class="field-label">Code d'authentification</label>
              <NeoInputText
                id="totp-code"
                ref="totpInputRef"
                v-model="totpCode"
                placeholder="123456"
                :disabled="loading"
                autocomplete="one-time-code"
                inputmode="numeric"
                maxlength="6"
              />
            </div>
            <NeoMessage
              v-if="totpError"
              severity="error"
              :text="totpError"
              :closable="true"
              @close="totpError = null"
            />
            <NeoButton
              type="submit"
              label="Vérifier"
              :loading="loading"
              :disabled="totpCode.length !== 6"
              class="submit-btn"
            />
            <button type="button" class="totp-back-btn" @click="cancelTotp">
              Retour à la connexion
            </button>
          </form>
        </div>

        <div v-if="!totpRequired" class="divider">
          <span>Accès rapide</span>
        </div>

        <div v-if="!totpRequired" class="quick-access">
          <button
            v-for="acc in quickAccounts"
            :key="acc.role"
            class="qa-btn"
            :disabled="loading"
            @click="fillCredentials(acc.email, acc.pwd)"
          >
            <span class="qa-avatar" :style="{ background: acc.color }">{{ acc.init }}</span>
            <span class="qa-info">
              <span class="qa-role">{{ acc.label }}</span>
              <span class="qa-email">{{ acc.email }}</span>
            </span>
          </button>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { NeoInputText, NeoPassword, NeoButton, NeoMessage } from '@neolibrary/components'
import { useApp } from '@/stores/useApp'

const router = useRouter()
const app    = useApp()

const email    = ref('')
const password = ref('')
const loading  = ref(false)
const errorMsg = ref<string | null>(null)

// TOTP challenge state
const totpRequired  = ref(false)
const totpTempToken = ref('')
const totpCode      = ref('')
const totpError     = ref<string | null>(null)
const totpInputRef  = ref<HTMLInputElement | null>(null)

const quickAccounts = [
  { role: 'admin', label: 'Administrateur',       email: 'admin@neoleadge.com',  pwd: 'Admin@123',  color: '#0D9488', init: 'A'  },
  { role: 'pm',    label: 'Chef de projet',        email: 'pm@neoleadge.com',     pwd: 'Pm@123',     color: '#3B82F6', init: 'CP' },
  { role: 'team',  label: 'Équipe de validation',  email: 'valid@neoleadge.com',  pwd: 'Valid@123',  color: '#8B5CF6', init: 'EV' },
]

const fillCredentials = (e: string, p: string) => {
  email.value    = e
  password.value = p
  errorMsg.value = null
}

const redirectAfterLogin = () => {
  if (app.mustChangePassword) {
    router.push({ name: 'force-change-password' })
    return
  }
  const role = app.userRole
  if (role === 'Admin')               router.push({ name: 'admin' })
  else if (role === 'ProjectManager') router.push({ name: 'pm' })
  else                                router.push({ name: 'team' })
}

const handleLogin = async () => {
  errorMsg.value = null
  loading.value  = true
  try {
    const result = await app.login(email.value.trim(), password.value)
    if (result.requiresTotp && result.tempToken) {
      totpTempToken.value = result.tempToken
      totpRequired.value  = true
      await nextTick()
      totpInputRef.value?.focus()
    } else {
      redirectAfterLogin()
    }
  } catch {
    errorMsg.value = 'Email ou mot de passe incorrect.'
  } finally {
    loading.value = false
  }
}

const handleTotpSubmit = async () => {
  totpError.value = null
  loading.value   = true
  try {
    await app.loginTotp(totpTempToken.value, totpCode.value)
    redirectAfterLogin()
  } catch {
    totpError.value = 'Code invalide. Vérifiez votre application d\'authentification.'
    totpCode.value  = ''
  } finally {
    loading.value = false
  }
}

const cancelTotp = () => {
  totpRequired.value  = false
  totpTempToken.value = ''
  totpCode.value      = ''
  totpError.value     = null
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  font-family: var(--nl-font);
}

/* ── Left: Brand panel ──────────────────────────────────────────────────────── */
.brand-panel {
  width: 460px;
  flex-shrink: 0;
  background: linear-gradient(-45deg, #020617, #0f172a, #0d9488, #042f2e);
  background-size: 400% 400%;
  animation: gradientMesh 18s ease infinite;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 3rem;
  position: relative;
  overflow: hidden;
  box-shadow: 10px 0 30px rgba(0,0,0,0.1);
}

@keyframes gradientMesh {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.brand-inner {
  display: flex;
  flex-direction: column;
  gap: 3rem;
  position: relative;
  z-index: 1;
}

.brand-top {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-mark {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(255,255,255,0.1);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255,255,255,0.2);
  color: #fff;
  font-size: 1rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.brand-name {
  font-size: 1.125rem;
  font-weight: 700;
  color: #F8FAFC;
  letter-spacing: -0.2px;
}

.brand-statement h2 {
  font-size: 2.125rem;
  font-weight: 800;
  line-height: 1.15;
  color: #F8FAFC;
  letter-spacing: -0.5px;
  margin-bottom: 1rem;
}

.brand-statement p {
  font-size: 0.9375rem;
  color: #94A3B8;
  line-height: 1.6;
}

.brand-features {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.brand-features li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9375rem;
  color: #CBD5E1;
  font-weight: 500;
}

.feat-check {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(13, 148, 136, 0.2);
  color: #2DD4BF;
  box-shadow: 0 0 10px rgba(13, 148, 136, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  flex-shrink: 0;
}

/* Abstract geometry */
.geo {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.geo--1 {
  width: 400px;
  height: 400px;
  bottom: -100px;
  right: -150px;
}

.geo--2 {
  width: 200px;
  height: 200px;
  top: 15%;
  right: -50px;
}

.geo--3 {
  width: 100px;
  height: 100px;
  border: 1px solid rgba(255,255,255,0.08);
  background: transparent;
  top: 35%;
  left: 20px;
}

.brand-footer {
  font-size: 0.8125rem;
  color: #64748B;
  position: relative;
  z-index: 1;
}

/* ── Right: Form panel ──────────────────────────────────────────────────────── */
.form-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  padding: 2.5rem;
}

.form-inner {
  width: 100%;
  max-width: 440px;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow-lg);
  padding: 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.form-header { display: flex; flex-direction: column; gap: 0.5rem; }

.form-title {
  font-size: 1.75rem;
  font-weight: 800;
  color: var(--nl-text-1);
  letter-spacing: -0.5px;
}

.form-sub {
  font-size: 0.9375rem;
  color: var(--nl-text-3);
}

.form-fields {
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
  margin-top: 0.5rem;
}

/* Divider */
.divider {
  display: flex;
  align-items: center;
  gap: 1rem;
  color: var(--nl-text-3);
  font-size: 0.8125rem;
  font-weight: 500;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--nl-border);
}

/* Quick access */
.quick-access {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.qa-btn {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 0.75rem 1rem;
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-family: var(--nl-font);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), 
              box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.2s ease, background 0.2s ease;
}

.qa-btn:hover:not(:disabled) {
  background: var(--nl-surface);
  border-color: var(--nl-accent);
  transform: translateY(-2px);
  box-shadow: var(--nl-shadow);
}

.qa-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.qa-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.qa-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.qa-role  { font-size: 0.875rem; font-weight: 600; color: var(--nl-text-1); }
.qa-email { font-size: 0.75rem;   color: var(--nl-text-3); }

/* TOTP challenge panel */
.totp-panel {
  border-top: 1px solid var(--nl-border);
  padding-top: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.totp-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.totp-icon {
  font-size: 1.5rem;
  color: var(--nl-accent);
}

.totp-title {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--nl-text-1);
}

.totp-sub {
  font-size: 0.875rem;
  color: var(--nl-text-3);
  line-height: 1.5;
}

.totp-back-btn {
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

.totp-back-btn:hover {
  color: var(--nl-text-1);
}

/* Mobile */
@media (max-width: 768px) {
  .login-page { flex-direction: column; }
  .brand-panel { width: 100%; min-height: 240px; padding: 2rem; }
  .form-inner { border: none; box-shadow: none; padding: 1.5rem 0; background: transparent; }
  .form-panel { padding: 1.5rem; align-items: flex-start; }
  .brand-statement h2 { font-size: 1.5rem; }
  .brand-features { display: none; }
}
</style>
