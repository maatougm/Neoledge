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
        <!-- Avatar with upload -->
        <div class="avatar-wrap">
          <img
            v-if="avatarUrl"
            :src="avatarUrl"
            class="avatar avatar--img"
            alt="Photo de profil"
            @error="avatarUrl = null"
          />
          <div v-else class="avatar" aria-hidden="true">{{ initials }}</div>
          <button
            class="avatar-change-btn"
            :disabled="uploadingAvatar"
            title="Changer la photo"
            aria-label="Changer la photo de profil"
            @click="triggerFileInput"
          >
            <i v-if="!uploadingAvatar" class="pi pi-camera" aria-hidden="true" />
            <i v-else class="pi pi-spin pi-spinner" aria-hidden="true" />
          </button>
          <input
            ref="fileInputRef"
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            class="avatar-file-input"
            aria-label="Sélectionner une photo"
            @change="onFileSelected"
          />
        </div>
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

        <!-- Panel 3: Two-factor authentication -->
        <SecuritySection />

      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import {
  NeoButton, NeoInputText, NeoPassword,
  NeoTag, NeoMessage, useNeoToast,
} from '@neolibrary/components'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'
import { USER_ROLE_LABELS } from '@/types/user.types'
import type { UserRole } from '@/types/user.types'
import SecuritySection from '@/components/admin/sections/SecuritySection.vue'

interface JwtPayload {
  sub?: string
  given_name?: string
  family_name?: string
  email?: string
  'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'?: string
}

const router      = useRouter()
const authStore   = useAuthStore()
const configStore = useConfigStore()
const toast       = useNeoToast()

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

// ── Avatar ─────────────────────────────────────────────────────────────────────
const avatarUrl       = ref<string | null>(null)
const uploadingAvatar = ref(false)
const fileInputRef    = ref<HTMLInputElement | null>(null)

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
onMounted(async () => {
  if (!authStore.jwt) return
  try {
    const payload = JSON.parse(atob(authStore.jwt.split('.')[1])) as JwtPayload
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

  // Load avatar URL if user has one
  if (userId.value) {
    avatarUrl.value = `${configStore.apiUrl}/api/userprofile/avatar/${userId.value}`
  }
})

// ── Avatar upload ──────────────────────────────────────────────────────────────
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 2 * 1024 * 1024

function triggerFileInput(): void {
  fileInputRef.value?.click()
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file  = input.files?.[0]
  input.value = '' // reset so same file can be re-selected

  if (!file) return

  if (!ALLOWED_TYPES.has(file.type)) {
    toast.add({ severity: 'error', detail: 'Format non supporté. Utilisez JPG, PNG ou WebP.', life: 4000 })
    return
  }
  if (file.size > MAX_BYTES) {
    toast.add({ severity: 'error', detail: 'L\'image dépasse 2 Mo.', life: 4000 })
    return
  }

  uploadingAvatar.value = true
  try {
    const base64 = await toBase64(file)
    const ext    = `.${file.name.split('.').pop()?.toLowerCase() ?? 'jpg'}`
    const { data } = await api.post<string>(
      '/api/userprofile/avatar',
      { base64Image: base64, fileExtension: ext },
    )
    // Force browser to reload the image by appending a cache-bust
    avatarUrl.value = `${configStore.apiUrl}/api/userprofile/avatar/${userId.value}?t=${Date.now()}`
    void nextTick() // let Vue re-render before showing the toast
    void data // satisfies TS — path returned from backend, not used directly
    toast.add({ severity: 'success', detail: 'Photo de profil mise à jour.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: 'Erreur lors du téléchargement de la photo.', life: 4000 })
  } finally {
    uploadingAvatar.value = false
  }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = () => reject(new Error('Lecture du fichier échouée'))
    reader.readAsDataURL(file)
  })
}

// ── Back navigation ────────────────────────────────────────────────────────────
function goBack(): void {
  router.push({ name: 'app-home' })
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
    await api.put(
      `/admin/AppUser/${userId.value}`,
      { firstName: firstName.value.trim(), lastName: lastName.value.trim() },
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
    await api.post('/auth/change-password', {
      currentPassword: currentPassword.value,
      newPassword:     newPassword.value,
    })
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
  background: var(--nl-bg);
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
  border: 1px solid var(--nl-border);
  color: var(--nl-text-2);
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.45rem 0.875rem;
  border-radius: var(--nl-radius);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.back-btn:hover {
  background: color-mix(in srgb, var(--nl-text-1) 5%, transparent);
  border-color: var(--nl-text-3);
  color: var(--nl-text-1);
}

.back-btn:focus-visible {
  outline: 2px solid var(--nl-accent);
  outline-offset: 2px;
}

.page-title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--nl-text-1);
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
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  padding: 2rem 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  position: sticky;
  top: 2rem;
}

.avatar-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--nl-accent), color-mix(in srgb, var(--nl-accent) 70%, #000));
  color: var(--nl-color-white, #fff);
  font-size: 1.75rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(13, 148, 136, 0.3);
}

.avatar--img {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 4px 12px rgba(13, 148, 136, 0.3);
}

.avatar-change-btn {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--nl-accent);
  color: var(--nl-color-white, #fff);
  border: 2px solid var(--nl-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  cursor: pointer;
  transition: background 0.15s;
}

.avatar-change-btn:hover { background: color-mix(in srgb, var(--nl-accent) 80%, #000); }
.avatar-change-btn:focus-visible { outline: 2px solid var(--nl-accent); outline-offset: 2px; }
.avatar-change-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.avatar-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
}

.identity-name {
  font-size: 1rem;
  font-weight: 700;
  color: var(--nl-text-1);
  text-align: center;
  line-height: 1.3;
}

.role-tag { margin-top: 0.1rem; }

.identity-email {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--nl-text-3);
  text-align: center;
  word-break: break-all;
}

.identity-meta {
  width: 100%;
  padding-top: 0.75rem;
  border-top: 1px solid var(--nl-border);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--nl-text-3);
}

.meta-row .pi { color: var(--nl-accent); }

/* ── Settings panels (right column) ───────────────────────────────────────────── */
.settings-panels {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.settings-panel {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--nl-border);
  background: color-mix(in srgb, var(--nl-surface) 80%, var(--nl-bg));
}

.panel-icon {
  font-size: 1rem;
  color: var(--nl-accent);
}

.panel-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--nl-text-1);
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
  color: var(--nl-text-2);
}

.field-input { width: 100%; }

.readonly-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: color-mix(in srgb, var(--nl-bg) 60%, var(--nl-surface));
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  padding: 0.55rem 0.875rem;
  color: var(--nl-text-3);
  font-size: 0.875rem;
}

.readonly-icon { color: var(--nl-text-3); font-size: 0.85rem; }

.field-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--nl-text-3);
}

.section-description {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--nl-text-3);
  line-height: 1.5;
}

.panel-msg { width: 100%; }

.panel-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 0.25rem;
}

/* ── Dark mode: handled automatically via CSS variables ──────────────────────── */

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
