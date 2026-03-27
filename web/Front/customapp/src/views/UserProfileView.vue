<!--
  @file     UserProfileView.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Full profile management page — identity info + integrated password change
-->
<template>
  <div class="profile-page">
    <!-- Page header -->
    <header class="page-header">
      <button class="back-btn" aria-label="Retour" @click="goBack">
        <i class="pi pi-arrow-left" aria-hidden="true" />
        Retour
      </button>
      <h1 class="page-title">Mon profil</h1>
    </header>

    <div class="profile-grid">
      <!-- ── Left column: identity card ───────────────────── -->
      <aside class="identity-card" aria-label="Identité">
        <div class="avatar" aria-hidden="true">{{ initials }}</div>
        <div class="identity-name">{{ fullName || 'Utilisateur' }}</div>
        <NeoTag :value="roleLabel" severity="info" class="role-tag" />
        <div class="identity-email">
          <i class="pi pi-envelope" aria-hidden="true" />
          <span>{{ email }}</span>
        </div>
        <div class="identity-meta">
          <div class="meta-row">
            <i class="pi pi-shield" aria-hidden="true" />
            <span>Compte actif</span>
          </div>
        </div>
      </aside>

      <!-- ── Right column: settings panels ───────────────── -->
      <div class="settings-panels">

        <!-- Panel 1: Personal info -->
        <section class="settings-panel" aria-labelledby="panel-info-title">
          <div class="panel-header">
            <i class="pi pi-user-edit panel-icon" aria-hidden="true" />
            <h2 id="panel-info-title" class="panel-title">Informations personnelles</h2>
          </div>

          <div class="panel-body">
            <div class="fields-row">
              <div class="field-group">
                <label for="firstName" class="field-label">Prénom</label>
                <NeoInputText
                  id="firstName"
                  v-model="firstName"
                  placeholder="Prénom"
                  :disabled="savingInfo"
                  class="field-input"
                />
              </div>
              <div class="field-group">
                <label for="lastName" class="field-label">Nom</label>
                <NeoInputText
                  id="lastName"
                  v-model="lastName"
                  placeholder="Nom de famille"
                  :disabled="savingInfo"
                  class="field-input"
                />
              </div>
            </div>

            <div class="field-group">
              <label class="field-label">Adresse e-mail</label>
              <div class="readonly-field">
                <i class="pi pi-lock readonly-icon" aria-hidden="true" />
                <span>{{ email }}</span>
              </div>
              <p class="field-hint">L'adresse e-mail ne peut pas être modifiée ici.</p>
            </div>

            <NeoMessage v-if="infoError" severity="error" :text="infoError" class="panel-msg" />

            <div class="panel-actions">
              <NeoButton
                label="Enregistrer les modifications"
                icon="pi pi-check"
                :loading="savingInfo"
                :disabled="!infoChanged"
                @click="saveInfo"
              />
            </div>
          </div>
        </section>

        <!-- Panel 2: Security / password change -->
        <section class="settings-panel" aria-labelledby="panel-security-title">
          <div class="panel-header">
            <i class="pi pi-lock panel-icon" aria-hidden="true" />
            <h2 id="panel-security-title" class="panel-title">Sécurité</h2>
          </div>

          <div class="panel-body">
            <p class="section-description">
              Choisissez un mot de passe fort d'au moins 8 caractères, avec des majuscules, des chiffres et des caractères spéciaux.
            </p>

            <div class="field-group">
              <label for="currentPassword" class="field-label">Mot de passe actuel</label>
              <NeoPassword
                id="currentPassword"
                v-model="currentPassword"
                placeholder="••••••••"
                toggleMask
                :feedback="false"
                autocomplete="current-password"
                class="field-input"
              />
            </div>

            <div class="fields-row">
              <div class="field-group">
                <label for="newPassword" class="field-label">Nouveau mot de passe</label>
                <NeoPassword
                  id="newPassword"
                  v-model="newPassword"
                  placeholder="••••••••"
                  toggleMask
                  :feedback="true"
                  autocomplete="new-password"
                  class="field-input"
                />
              </div>
              <div class="field-group">
                <label for="confirmPassword" class="field-label">Confirmer le mot de passe</label>
                <NeoPassword
                  id="confirmPassword"
                  v-model="confirmPassword"
                  placeholder="••••••••"
                  toggleMask
                  :feedback="false"
                  autocomplete="new-password"
                  class="field-input"
                />
              </div>
            </div>

            <NeoMessage v-if="pwError" severity="error" :text="pwError" class="panel-msg" />
            <NeoMessage v-if="pwSuccess" severity="success" :text="pwSuccess" class="panel-msg" />

            <div class="panel-actions">
              <NeoButton
                label="Changer le mot de passe"
                icon="pi pi-key"
                :loading="savingPw"
                :disabled="!currentPassword || !newPassword || !confirmPassword"
                @click="savePassword"
              />
            </div>
          </div>
        </section>

      </div>
    </div>

    <NeoToast />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import {
  NeoButton, NeoInputText, NeoPassword,
  NeoTag, NeoMessage, NeoToast, useNeoToast,
} from '@neolibrary/components'
import { useApp } from '@/stores/useApp'
import { USER_ROLE_LABELS } from '@/types/user.types'
import type { UserRole } from '@/types/user.types'

interface JwtPayload {
  sub?: string
  given_name?: string
  family_name?: string
  email?: string
  'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'?: string
}

const router = useRouter()
const app    = useApp()
const toast  = useNeoToast()

// ── JWT-decoded identity ───────────────────────────────────────────────────────
const userId = ref('')
const email  = ref('')
const role   = ref<UserRole | ''>('')

// ── Editable fields ────────────────────────────────────────────────────────────
const firstName = ref('')
const lastName  = ref('')
const origFirst = ref('')
const origLast  = ref('')

// ── Password fields ────────────────────────────────────────────────────────────
const currentPassword = ref('')
const newPassword     = ref('')
const confirmPassword = ref('')

// ── Loading / error state ──────────────────────────────────────────────────────
const savingInfo = ref(false)
const savingPw   = ref(false)
const infoError  = ref<string | null>(null)
const pwError    = ref<string | null>(null)
const pwSuccess  = ref<string | null>(null)

// ── Computed ───────────────────────────────────────────────────────────────────
const initials = computed(() => {
  const f = firstName.value.charAt(0).toUpperCase()
  const l = lastName.value.charAt(0).toUpperCase()
  return f || l ? `${f}${l}` : '?'
})

const fullName = computed(() =>
  [firstName.value, lastName.value].filter(Boolean).join(' ')
)

const roleLabel = computed(() =>
  role.value ? (USER_ROLE_LABELS[role.value as UserRole] ?? role.value) : ''
)

const infoChanged = computed(() =>
  firstName.value !== origFirst.value || lastName.value !== origLast.value
)

// ── Init ───────────────────────────────────────────────────────────────────────
onMounted(() => {
  if (!app.jwt) return
  try {
    const payload = JSON.parse(atob(app.jwt.split('.')[1])) as JwtPayload
    userId.value    = payload.sub ?? ''
    firstName.value = payload.given_name ?? ''
    lastName.value  = payload.family_name ?? ''
    origFirst.value = payload.given_name ?? ''
    origLast.value  = payload.family_name ?? ''
    email.value     = payload.email ?? ''
    role.value      = (
      payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ?? ''
    ) as UserRole | ''
  } catch { /* JWT decode failed — ignore */ }
})

// ── Back navigation ────────────────────────────────────────────────────────────
function goBack(): void {
  const r = app.userRole
  if (r === 'Admin') router.push({ name: 'admin' })
  else if (r === 'ProjectManager') router.push({ name: 'pm' })
  else router.push({ name: 'team' })
}

// ── Save personal info ─────────────────────────────────────────────────────────
async function saveInfo(): Promise<void> {
  infoError.value = null
  if (!userId.value) {
    infoError.value = 'Impossible d\'identifier l\'utilisateur.'
    return
  }
  savingInfo.value = true
  try {
    await axios.put(
      `${app.apiUrl}/admin/AppUser/${userId.value}`,
      { firstName: firstName.value.trim(), lastName: lastName.value.trim() },
      { headers: app.authHeader() },
    )
    origFirst.value = firstName.value
    origLast.value  = lastName.value
    toast.add({ severity: 'success', detail: 'Profil mis à jour avec succès.', life: 3000 })
  } catch {
    infoError.value = 'Erreur lors de la mise à jour. Veuillez réessayer.'
  } finally {
    savingInfo.value = false
  }
}

// ── Change password ────────────────────────────────────────────────────────────
async function savePassword(): Promise<void> {
  pwError.value   = null
  pwSuccess.value = null

  if (newPassword.value.length < 8) {
    pwError.value = 'Le nouveau mot de passe doit contenir au moins 8 caractères.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    pwError.value = 'Les mots de passe ne correspondent pas.'
    return
  }

  savingPw.value = true
  try {
    await axios.post(
      `${app.apiUrl}/auth/change-password`,
      {
        currentPassword: currentPassword.value,
        newPassword:     newPassword.value,
      },
      { headers: app.authHeader() },
    )
    currentPassword.value = ''
    newPassword.value     = ''
    confirmPassword.value = ''
    pwSuccess.value = 'Mot de passe modifié avec succès.'
    toast.add({ severity: 'success', detail: 'Mot de passe mis à jour.', life: 3000 })
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } }).response?.status
    pwError.value = status === 400
      ? 'Mot de passe actuel incorrect.'
      : 'Erreur lors du changement de mot de passe.'
  } finally {
    savingPw.value = false
  }
}
</script>

<style scoped>
/* ── Page layout ──────────────────────────────────────────────────────────────── */
.profile-page {
  min-height: 100vh;
  background: #f8fafc;
  padding: 2rem;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  max-width: 960px;
  margin: 0 auto 2rem;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: 1px solid #e2e8f0;
  color: #475569;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.45rem 0.875rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.back-btn:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
  color: #1e293b;
}

.back-btn:focus-visible {
  outline: 2px solid #0d9488;
  outline-offset: 2px;
}

.page-title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 700;
  color: #0f172a;
}

/* ── Two-column grid ──────────────────────────────────────────────────────────── */
.profile-grid {
  max-width: 960px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 1.5rem;
  align-items: start;
}

/* ── Identity card (left column) ──────────────────────────────────────────────── */
.identity-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 2rem 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  position: sticky;
  top: 2rem;
}

.avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0d9488, #0891b2);
  color: #fff;
  font-size: 1.75rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(13, 148, 136, 0.3);
}

.identity-name {
  font-size: 1rem;
  font-weight: 700;
  color: #0f172a;
  text-align: center;
  line-height: 1.3;
}

.role-tag { margin-top: 0.1rem; }

.identity-email {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: #64748b;
  text-align: center;
  word-break: break-all;
}

.identity-meta {
  width: 100%;
  padding-top: 0.75rem;
  border-top: 1px solid #f1f5f9;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: #64748b;
}

.meta-row .pi { color: #0d9488; }

/* ── Settings panels (right column) ───────────────────────────────────────────── */
.settings-panels {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.settings-panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #f1f5f9;
  background: #fafafa;
}

.panel-icon {
  font-size: 1rem;
  color: #0d9488;
}

.panel-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #0f172a;
}

.panel-body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* ── Form fields ──────────────────────────────────────────────────────────────── */
.fields-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #374151;
}

.field-input { width: 100%; }

.readonly-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.55rem 0.875rem;
  color: #6b7280;
  font-size: 0.875rem;
}

.readonly-icon { color: #9ca3af; font-size: 0.85rem; }

.field-hint {
  margin: 0;
  font-size: 0.75rem;
  color: #9ca3af;
}

.section-description {
  margin: 0;
  font-size: 0.8125rem;
  color: #64748b;
  line-height: 1.5;
}

.panel-msg { width: 100%; }

.panel-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 0.25rem;
}

/* ── Dark mode ────────────────────────────────────────────────────────────────── */
:global(.dark) .profile-page { background: #0f172a; }
:global(.dark) .page-title   { color: #f1f5f9; }
:global(.dark) .back-btn     { border-color: #334155; color: #94a3b8; background: transparent; }
:global(.dark) .back-btn:hover { background: rgba(255,255,255,0.06); color: #e2e8f0; border-color: #475569; }
:global(.dark) .identity-card,
:global(.dark) .settings-panel { background: #1e293b; border-color: #334155; }
:global(.dark) .panel-header  { background: #1a2740; border-color: #334155; }
:global(.dark) .panel-title,
:global(.dark) .identity-name { color: #f1f5f9; }
:global(.dark) .field-label   { color: #cbd5e1; }
:global(.dark) .readonly-field { background: #0f172a; border-color: #334155; color: #94a3b8; }
:global(.dark) .identity-meta { border-color: #334155; }
:global(.dark) .section-description { color: #94a3b8; }

/* ── Mobile ───────────────────────────────────────────────────────────────────── */
@media (max-width: 720px) {
  .profile-page { padding: 1rem; }
  .profile-grid { grid-template-columns: 1fr; }
  .identity-card { position: static; flex-direction: row; align-items: flex-start; flex-wrap: wrap; gap: 1rem; padding: 1.25rem; }
  .avatar { width: 60px; height: 60px; font-size: 1.3rem; }
  .identity-meta { flex-direction: row; border-top: none; padding-top: 0; }
  .fields-row { grid-template-columns: 1fr; }
}
</style>
