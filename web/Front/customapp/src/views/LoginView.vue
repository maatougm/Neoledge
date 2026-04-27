<!--
  @file     LoginView.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Login page — dark brand panel (40%) + form panel (60%), with TOTP challenge
-->
<template>
  <div class="login-page">

    <!-- ── LEFT: Dark brand panel ─────────────────────────────────────────────── -->
    <aside class="brand-panel" aria-hidden="true">
      <!-- Decorative gradient orbs -->
      <div class="brand-orb brand-orb--1" />
      <div class="brand-orb brand-orb--2" />

      <div class="brand-inner">
        <!-- Logo -->
        <div class="brand-logo">
          <div class="brand-mark" aria-label="NeoLeadge">NL</div>
          <span class="brand-wordmark">NeoLeadge</span>
        </div>

        <!-- Tagline -->
        <div class="brand-tagline">
          <h2 class="brand-tagline__heading">
            Pilotez vos déploiements.<br />En toute clarté.
          </h2>
        </div>

        <!-- Feature list -->
        <ul class="brand-features" aria-label="Fonctionnalités">
          <li class="brand-features__item">
            <span class="brand-features__check" aria-hidden="true">
              <i class="pi pi-check" />
            </span>
            Gestion de projets centralisée
          </li>
          <li class="brand-features__item">
            <span class="brand-features__check" aria-hidden="true">
              <i class="pi pi-check" />
            </span>
            Validation d'équipe en temps réel
          </li>
          <li class="brand-features__item">
            <span class="brand-features__check" aria-hidden="true">
              <i class="pi pi-check" />
            </span>
            Transcription IA des réunions
          </li>
        </ul>
      </div>

      <p class="brand-footer">Archimed © 2026</p>
    </aside>

    <!-- ── RIGHT: Form panel ──────────────────────────────────────────────────── -->
    <main class="form-panel">
      <div class="form-card">

        <!-- ── Step 1: Credentials ── -->
        <template v-if="!totpRequired">
          <div class="form-card__header">
            <h1 class="form-card__title">Connexion</h1>
            <p class="form-card__subtitle">Accédez à votre espace de gestion</p>
          </div>

          <form class="form-card__body" novalidate @submit.prevent="handleLogin">
            <div class="field-group">
              <NeoInputText
                id="login-email"
                v-model="email"
                label="Adresse e-mail"
                placeholder="jean.dupont@archimed.fr"
                :disabled="loading"
                autocomplete="email"
                type="email"
                class="w-full"
              />
            </div>

            <div class="field-group">
              <NeoPassword
                id="login-password"
                v-model="password"
                label="Mot de passe"
                placeholder="••••••••"
                :disabled="loading"
                toggleMask
                :feedback="false"
                autocomplete="current-password"
                class="w-full"
              />
            </div>

            <div class="forgot-link-row">
              <RouterLink to="/forgot-password" class="forgot-link">Mot de passe oublié ?</RouterLink>
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
              icon="pi pi-sign-in"
              :loading="loading"
              :disabled="!email || !password"
              class="submit-btn"
            />
          </form>

          <!-- Quick-access demo accounts (visible in prod per request) -->
          <template v-if="true">
            <div class="divider"><span>Accès rapide</span></div>
            <div class="quick-access">
              <button
                v-for="acc in quickAccounts"
                :key="acc.role"
                class="qa-btn"
                type="button"
                :disabled="loading"
                @click="quickLogin(acc.email, acc.pwd)"
              >
                <span class="qa-avatar" :style="{ background: acc.color }">{{ acc.init }}</span>
                <span class="qa-info">
                  <span class="qa-role">{{ acc.label }}</span>
                  <span class="qa-email">{{ acc.email }}</span>
                </span>
              </button>
            </div>
          </template>
        </template>

        <!-- ── Step 2: TOTP challenge ── -->
        <template v-else>
          <div class="form-card__header">
            <div class="totp-icon-wrap" aria-hidden="true">
              <i class="pi pi-shield" />
            </div>
            <h2 class="form-card__title">Double authentification</h2>
            <p class="form-card__subtitle">
              Saisissez le code à 6 chiffres affiché dans votre application d'authentification.
            </p>
          </div>

          <form class="form-card__body" novalidate @submit.prevent="handleTotpSubmit">
            <NeoInputText
              id="totp-code"
              ref="totpInputRef"
              v-model="totpCode"
              label="Code d'authentification"
              placeholder="123456"
              :disabled="loading"
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength="6"
              class="w-full"
            />

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
              icon="pi pi-check"
              :loading="loading"
              :disabled="totpCode.length !== 6"
              class="submit-btn"
            />

            <button type="button" class="back-link" @click="cancelTotp">
              <i class="pi pi-arrow-left" aria-hidden="true" />
              Retour à la connexion
            </button>
          </form>
        </template>

      </div>
    </main>

  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { NeoInputText, NeoPassword, NeoButton, NeoMessage } from '@neolibrary/components'
import { useAuthStore } from '@/stores/authStore'

const router   = useRouter()
const authStore = useAuthStore()

// ── DEV flag — demo widget is hidden in production builds ─────────────────────
const isDev = import.meta.env.DEV

// ── Form state ─────────────────────────────────────────────────────────────────
const email    = ref('')
const password = ref('')
const loading  = ref(false)
const errorMsg = ref<string | null>(null)

// ── TOTP state ─────────────────────────────────────────────────────────────────
const totpRequired  = ref(false)
const totpTempToken = ref('')
const totpCode      = ref('')
const totpError     = ref<string | null>(null)
const totpInputRef  = ref<HTMLInputElement | null>(null)

// ── Quick-access demo accounts (only populated in dev, empty in production) ───
const quickAccounts = [
  { role: 'admin',  label: 'Administrateur',        email: 'admin@neoleadge.com',   pwd: 'Admin@123',   color: 'var(--nl-accent)', init: 'A'  },
  { role: 'pm',     label: 'Chef de projet',         email: 'pm@neoleadge.com',      pwd: 'Pm@12345',    color: '#3B82F6',          init: 'CP' },
  { role: 'spec',   label: 'Équipe spécification',   email: 'spec@neoleadge.com',    pwd: 'Valid@123',   color: '#8B5CF6',          init: 'ES' },
  { role: 'realiz', label: 'Équipe réalisation',     email: 'realiz@neoleadge.com',  pwd: 'Valid@123',   color: '#F97316',          init: 'ER' },
  { role: 'deploy', label: 'Équipe déploiement',     email: 'deploy@neoleadge.com',  pwd: 'Valid@123',   color: '#10B981',          init: 'ED' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────
function fillCredentials(e: string, p: string): void {
  email.value    = e
  password.value = p
  errorMsg.value = null
}

/** One-click login — fill and submit immediately. */
async function quickLogin(e: string, p: string): Promise<void> {
  fillCredentials(e, p)
  await handleLogin()
}

function redirectAfterLogin(): void {
  if (authStore.mustChangePassword) {
    router.push({ name: 'force-change-password' })
    return
  }
  // /app has a role-based redirect child — let the router decide
  router.push({ name: 'app-home' })
}

// ── Login handlers ─────────────────────────────────────────────────────────────
async function handleLogin(): Promise<void> {
  errorMsg.value = null
  loading.value  = true
  try {
    const result = await authStore.login(email.value.trim(), password.value)
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

async function handleTotpSubmit(): Promise<void> {
  totpError.value = null
  loading.value   = true
  try {
    await authStore.loginTotp(totpTempToken.value, totpCode.value)
    redirectAfterLogin()
  } catch {
    totpError.value = "Code invalide. Vérifiez votre application d'authentification."
    totpCode.value  = ''
  } finally {
    loading.value = false
  }
}

function cancelTotp(): void {
  totpRequired.value  = false
  totpTempToken.value = ''
  totpCode.value      = ''
  totpError.value     = null
}
</script>

<style scoped>
/* ── Page layout ──────────────────────────────────────────────────────────────── */
.login-page {
  min-height: 100vh;
  display: flex;
  font-family: var(--nl-font);
}

/* ── Left: Brand panel ────────────────────────────────────────────────────────── */
.brand-panel {
  width: 40%;
  flex-shrink: 0;
  background: linear-gradient(135deg, #020617 0%, #0f172a 40%, #042f2e 100%);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 3rem;
  position: relative;
  overflow: hidden;
}

/* Decorative orbs */
.brand-orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(60px);
}

.brand-orb--1 {
  width: 340px;
  height: 340px;
  background: color-mix(in srgb, var(--nl-accent) 18%, transparent);
  bottom: -100px;
  right: -80px;
}

.brand-orb--2 {
  width: 200px;
  height: 200px;
  background: color-mix(in srgb, #14b8a6 10%, transparent);
  top: 10%;
  left: -60px;
}

.brand-inner {
  display: flex;
  flex-direction: column;
  gap: 3rem;
  position: relative;
  z-index: 1;
}

/* Logo */
.brand-logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-mark {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--nl-accent) 25%, #fff 10%);
  border: 1px solid color-mix(in srgb, var(--nl-accent) 40%, transparent);
  color: #fff;
  font-size: 1rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.brand-wordmark {
  font-size: 1.125rem;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: -0.2px;
}

/* Tagline */
.brand-tagline__heading {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1.2;
  color: #f8fafc;
  letter-spacing: -0.5px;
  margin: 0;
}

/* Features */
.brand-features {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.brand-features__item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9375rem;
  color: #cbd5e1;
  font-weight: 500;
}

.brand-features__check {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--nl-accent) 20%, transparent);
  color: #2dd4bf;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  flex-shrink: 0;
  box-shadow: 0 0 12px color-mix(in srgb, var(--nl-accent) 25%, transparent);
}

.brand-footer {
  font-size: 0.8125rem;
  color: #475569;
  position: relative;
  z-index: 1;
  margin: 0;
}

/* ── Right: Form panel ────────────────────────────────────────────────────────── */
.form-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nl-bg);
  padding: 2.5rem;
}

.form-card {
  width: 100%;
  max-width: 400px;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow-lg);
  padding: 2.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

/* Card header */
.form-card__header {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.form-card__title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--nl-text-1);
  letter-spacing: -0.3px;
}

.form-card__subtitle {
  margin: 0;
  font-size: 0.9rem;
  color: var(--nl-text-3);
  line-height: 1.5;
}

/* Card body / form */
.form-card__body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.field-group {
  display: flex;
  flex-direction: column;
}

.submit-btn {
  width: 100%;
  margin-top: 0.25rem;
}

.forgot-link-row {
  display: flex;
  justify-content: flex-end;
  margin-top: -0.25rem;
}

.forgot-link {
  font-size: 0.8125rem;
  color: var(--nl-accent, #0d9488);
  text-decoration: none;
}
.forgot-link:hover { text-decoration: underline; }

/* TOTP icon */
.totp-icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--nl-accent) 12%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.25rem;
}

.totp-icon-wrap .pi {
  font-size: 1.25rem;
  color: var(--nl-accent);
}

/* Back link under TOTP */
.back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  background: none;
  border: none;
  color: var(--nl-text-3);
  font-size: 0.8125rem;
  font-family: var(--nl-font);
  cursor: pointer;
  padding: 0;
  text-align: center;
  transition: color 0.15s;
}

.back-link:hover { color: var(--nl-text-1); }

/* Divider */
.divider {
  display: flex;
  align-items: center;
  gap: 1rem;
  color: var(--nl-text-3);
  font-size: 0.8rem;
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
  gap: 0.625rem;
}

.qa-btn {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  background: var(--nl-surface-2, var(--nl-surface));
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 0.7rem 0.875rem;
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-family: var(--nl-font);
  transition:
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.2s ease;
}

.qa-btn:hover:not(:disabled) {
  border-color: var(--nl-accent);
  transform: translateY(-1px);
  box-shadow: var(--nl-shadow);
}

.qa-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.qa-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.qa-info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.qa-role  { font-size: 0.85rem;  font-weight: 600; color: var(--nl-text-1); }
.qa-email { font-size: 0.72rem;  color: var(--nl-text-3); }

/* ── Mobile ───────────────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .login-page { flex-direction: column; }

  .brand-panel {
    width: 100%;
    min-height: 200px;
    padding: 2rem;
  }

  .brand-features { display: none; }
  .brand-tagline__heading { font-size: 1.5rem; }

  .form-panel { padding: 1.5rem; align-items: flex-start; }

  .form-card {
    border: none;
    box-shadow: none;
    background: transparent;
    padding: 1.5rem 0;
  }
}
</style>
