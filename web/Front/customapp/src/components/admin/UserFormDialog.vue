<!--
  @file     UserFormDialog.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Modal dialog — create or edit an AppUser
-->
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-scrim" @mousedown.self="emit('close')">
        <div class="modal-box" role="dialog" aria-modal="true">

          <!-- Header -->
          <div class="modal-header">
            <span class="modal-title">{{ isEdit ? "Modifier l'utilisateur" : 'Nouvel utilisateur' }}</span>
            <button class="modal-close" @click="emit('close')" aria-label="Fermer">
              <i class="pi pi-times" />
            </button>
          </div>

          <!-- User hero (edit mode only) -->
          <div v-if="isEdit && props.user" class="user-hero">
            <div class="user-avatar">{{ heroInitials }}</div>
            <div class="user-hero-info">
              <p class="user-hero-name">{{ props.user.firstName }} {{ props.user.lastName }}</p>
              <p class="user-hero-email">{{ props.user.email }}</p>
            </div>
            <NeoTag :value="USER_ROLE_LABELS[props.user.role]" severity="info" />
          </div>

          <!-- Form body -->
          <div class="form-body">
            <div class="fields-row">
              <div class="field-group">
                <NeoInputText v-model="form.firstName" label="Prénom" placeholder="Jean" :error="errors.firstName" required />
              </div>
              <div class="field-group">
                <NeoInputText v-model="form.lastName" label="Nom" placeholder="Dupont" :error="errors.lastName" required />
              </div>
            </div>

            <NeoInputText v-model="form.email" label="Adresse e-mail" placeholder="jean.dupont@example.com" :error="errors.email" required />

            <NeoPassword
              v-if="!isEdit"
              v-model="form.password"
              label="Mot de passe"
              placeholder="Min. 8 caractères, 1 maj, 1 chiffre"
              :error="errors.password"
              toggleMask
              :feedback="true"
              required
            />

            <div>
              <NeoSelect
                v-model="form.role"
                label="Rôle"
                :options="filteredRoleOptions"
                optionLabel="label"
                optionValue="value"
                :error="errors.role"
                required
              />
              <p class="role-hint">{{ ROLE_DESCRIPTIONS[form.role] }}</p>
            </div>
          </div>

          <!-- Footer -->
          <div class="modal-footer">
            <NeoButton label="Annuler" severity="secondary" outlined @click="emit('close')" />
            <NeoButton
              :label="submitLabel"
              :icon="isEdit ? 'pi pi-check' : 'pi pi-user-plus'"
              :loading="loading"
              @click="handleSubmit"
            />
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, watch, computed } from 'vue'
import { NeoInputText, NeoPassword, NeoSelect, NeoButton, NeoTag } from '@neolibrary/components'
import { USER_ROLE_OPTIONS, USER_ROLE_LABELS } from '@/types/user.types'
import type { UserResponse, CreateUserPayload, UpdateUserPayload, UserRole } from '@/types/user.types'
import { useAuthStore } from '@/stores/authStore'

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  Admin:              'Accès complet — gestion des utilisateurs et des projets.',
  ProjectManager:     'Gestion et suivi des projets assignés.',
  SpecificationTeam:  'Valide les spécifications des projets.',
  RealizationTeam:    'Équipe en charge de la réalisation.',
  DeploymentTeam:     'Déploiement et livraison des projets.',
  Viewer:             'Lecture seule — aucune action possible.',
}

const props = defineProps<{
  visible: boolean
  user?: UserResponse | null
  loading?: boolean
}>()

const emit = defineEmits<{
  close: []
  create: [payload: CreateUserPayload]
  update: [id: string, payload: UpdateUserPayload]
}>()

const authStore = useAuthStore()

const isEdit = computed(() => !!props.user)

/** Filter the Admin option out when the current user is not Admin */
const filteredRoleOptions = computed(() => {
  const canManageAdmins = authStore.can('user.manage_admins') || authStore.userRole === 'Admin'
  if (canManageAdmins) return USER_ROLE_OPTIONS
  return USER_ROLE_OPTIONS.filter((o) => o.value !== 'Admin')
})

const submitLabel = computed(() => isEdit.value ? 'Enregistrer les modifications' : "Créer l'utilisateur")

const heroInitials = computed(() => {
  const f = (props.user?.firstName ?? '').charAt(0).toUpperCase()
  const l = (props.user?.lastName  ?? '').charAt(0).toUpperCase()
  return `${f}${l}` || '?'
})

const form = reactive({
  firstName: '',
  lastName:  '',
  email:     '',
  password:  '',
  role:      'Viewer' as UserRole,
})

const errors = reactive<Partial<Record<keyof typeof form, string>>>({})

watch(
  () => props.user,
  (u) => {
    if (u) {
      form.firstName = u.firstName
      form.lastName  = u.lastName
      form.email     = u.email
      form.role      = u.role
      form.password  = ''
    } else {
      Object.assign(form, { firstName: '', lastName: '', email: '', password: '', role: 'Viewer' })
    }
    Object.keys(errors).forEach((k) => delete errors[k as keyof typeof errors])
  },
  { immediate: true },
)

const validate = (): boolean => {
  Object.keys(errors).forEach((k) => delete errors[k as keyof typeof errors])
  if (!form.firstName.trim()) errors.firstName = 'Le prénom est requis.'
  if (!form.lastName.trim())  errors.lastName  = 'Le nom est requis.'
  if (!form.email.trim() || !/^\S+@\S+\.\S+$/.test(form.email))
    errors.email = 'Adresse e-mail invalide.'
  if (!isEdit.value && !/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(form.password))
    errors.password = 'Au moins 8 caractères, 1 majuscule et 1 chiffre.'
  return Object.keys(errors).length === 0
}

const handleSubmit = () => {
  if (!validate()) return
  if (isEdit.value && props.user) {
    emit('update', props.user.id, {
      firstName: form.firstName,
      lastName:  form.lastName,
      email:     form.email,
      role:      form.role,
    })
  } else {
    emit('create', {
      firstName: form.firstName,
      lastName:  form.lastName,
      email:     form.email,
      password:  form.password,
      role:      form.role,
    })
  }
}
</script>

<style scoped>
/* ── Custom modal ────────────────────────────────────────────────────────── */
.modal-scrim {
  position: fixed;
  inset: 0;
  /* Stack above topbar dropdowns (9500), below Cmd-K (9800) and PrimeVue overlays. */
  z-index: 9600;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.modal-box {
  background: var(--nl-surface);
  border-radius: var(--nl-radius-lg, 12px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
  width: min(540px, 96vw);
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.125rem 1.375rem 0.875rem;
  border-bottom: 1px solid var(--nl-border);
  flex-shrink: 0;
}

.modal-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--nl-text-1);
}

.modal-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--nl-text-3);
  padding: 0.25rem;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.modal-close:hover {
  background: var(--nl-surface-2);
  color: var(--nl-text-1);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.625rem;
  padding: 0.875rem 1.375rem 1.125rem;
  border-top: 1px solid var(--nl-border);
  flex-shrink: 0;
}

/* Transition */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-active .modal-box,
.modal-leave-active .modal-box {
  transition: transform 0.18s ease, opacity 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal-box,
.modal-leave-to .modal-box {
  transform: translateY(-12px);
  opacity: 0;
}

/* User hero (edit mode header) */
.user-hero {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  background: var(--nl-surface-2);
  border-bottom: 1px solid var(--nl-border);
  padding: 0.875rem 1.375rem;
}

.user-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--nl-accent), #0891b2);
  color: #fff;
  font-size: 0.9rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.user-hero-info { flex: 1; min-width: 0; }

.user-hero-name {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--nl-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-hero-email {
  margin: 0;
  font-size: 0.78rem;
  color: var(--nl-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Form */
.form-body {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
  padding: 1.125rem 1.375rem;
}

.fields-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.875rem;
}

.field-group { display: flex; flex-direction: column; }

.role-hint {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: var(--nl-text-3);
  min-height: 1.1em;
  transition: color 0.15s;
}

@media (max-width: 480px) {
  .fields-row { grid-template-columns: 1fr; }
}
</style>
