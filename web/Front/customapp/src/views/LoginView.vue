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
        <div class="form-header">
          <h1 class="form-title">Connexion</h1>
          <p class="form-sub">Bienvenue. Connectez-vous à votre espace de travail.</p>
        </div>

        <form class="form-fields" @submit.prevent="handleLogin" novalidate>
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

        <div class="divider">
          <span>Accès rapide</span>
        </div>

        <div class="quick-access">
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
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { NeoInputText, NeoPassword, NeoButton, NeoMessage } from '@neolibrary/components'
import { useApp } from '@/stores/useApp'

const router = useRouter()
const app    = useApp()

const email    = ref('')
const password = ref('')
const loading  = ref(false)
const errorMsg = ref<string | null>(null)

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

const handleLogin = async () => {
  errorMsg.value = null
  loading.value  = true
  try {
    await app.login(email.value.trim(), password.value)
    if (app.mustChangePassword) {
      router.push({ name: 'force-change-password' })
    } else {
      const role = app.userRole
      if (role === 'Admin')               router.push({ name: 'admin' })
      else if (role === 'ProjectManager') router.push({ name: 'pm' })
      else                                router.push({ name: 'team' })
    }
  } catch {
    errorMsg.value = 'Email ou mot de passe incorrect.'
  } finally {
    loading.value = false
  }
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
  width: 420px;
  flex-shrink: 0;
  background: var(--nl-sidebar-bg);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 2.5rem;
  position: relative;
  overflow: hidden;
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
  gap: 0.625rem;
}

.brand-mark {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--nl-accent);
  color: #fff;
  font-size: 0.8125rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.brand-name {
  font-size: 0.9375rem;
  font-weight: 700;
  color: #FAFAFA;
  letter-spacing: -0.2px;
}

.brand-statement h2 {
  font-size: 1.875rem;
  font-weight: 800;
  line-height: 1.2;
  color: #FAFAFA;
  letter-spacing: -0.5px;
  margin-bottom: 0.875rem;
}

.brand-statement p {
  font-size: 0.875rem;
  color: #71717A;
  line-height: 1.6;
}

.brand-features {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.brand-features li {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  font-size: 0.8125rem;
  color: #A1A1AA;
  font-weight: 500;
}

.feat-check {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(13, 148, 136, 0.15);
  color: var(--nl-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.625rem;
  font-weight: 700;
  flex-shrink: 0;
}

/* Abstract geometry */
.geo {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.geo--1 {
  width: 320px;
  height: 320px;
  background: rgba(13, 148, 136, 0.06);
  bottom: -80px;
  right: -120px;
}

.geo--2 {
  width: 180px;
  height: 180px;
  background: rgba(13, 148, 136, 0.04);
  top: 20%;
  right: -60px;
}

.geo--3 {
  width: 80px;
  height: 80px;
  border: 1px solid rgba(255,255,255,0.04);
  top: 40%;
  left: 30px;
}

.brand-footer {
  font-size: 0.75rem;
  color: #3F3F46;
  position: relative;
  z-index: 1;
}

/* ── Right: Form panel ──────────────────────────────────────────────────────── */
.form-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nl-surface);
  padding: 2.5rem;
}

.form-inner {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.form-header { display: flex; flex-direction: column; gap: 0.375rem; }

.form-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--nl-text-1);
  letter-spacing: -0.3px;
}

.form-sub {
  font-size: 0.875rem;
  color: var(--nl-text-3);
}

.form-fields {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.field-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--nl-text-2);
}

.submit-btn {
  width: 100%;
  margin-top: 0.25rem;
}

/* Divider */
.divider {
  display: flex;
  align-items: center;
  gap: 1rem;
  color: var(--nl-text-3);
  font-size: 0.75rem;
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
  gap: 0.5rem;
}

.qa-btn {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 0.625rem 0.875rem;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  text-align: left;
  width: 100%;
  font-family: var(--nl-font);
}

.qa-btn:hover:not(:disabled) {
  background: var(--nl-surface);
  border-color: var(--nl-border-strong);
}

.qa-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.qa-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: #fff;
  font-size: 0.65rem;
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

.qa-role  { font-size: 0.8125rem; font-weight: 600; color: var(--nl-text-1); }
.qa-email { font-size: 0.72rem;   color: var(--nl-text-3); }

/* Mobile */
@media (max-width: 768px) {
  .login-page { flex-direction: column; }
  .brand-panel { width: 100%; min-height: 220px; }
  .brand-statement h2 { font-size: 1.375rem; }
  .brand-features { display: none; }
}
</style>
