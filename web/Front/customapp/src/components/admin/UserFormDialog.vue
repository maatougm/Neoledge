<!--
  @file     UserFormDialog.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Modal dialog — create or edit an AppUser
-->
<template>
  <Dialog
    :visible="visible"
    @update:visible="$event || emit('close')"
    :header="isEdit ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'"
    :modal="true"
    :closable="true"
    style="width: min(540px, 96vw)"
  >
    <!-- User header (edit mode only) -->
    <div v-if="isEdit && props.user" class="user-hero">
      <div class="user-avatar">{{ heroInitials }}</div>
      <div class="user-hero-info">
        <p class="user-hero-name">{{ props.user.firstName }} {{ props.user.lastName }}</p>
        <p class="user-hero-email">{{ props.user.email }}</p>
      </div>
      <NeoTag
        :value="USER_ROLE_LABELS[props.user.role]"
        severity="info"
      />
    </div>

    <div class="form-body">
      <!-- Name row -->
      <div class="fields-row">
        <div class="field-group">
          <NeoInputText
            v-model="form.firstName"
            label="Prénom"
            placeholder="Jean"
            :error="errors.firstName"
            required
          />
        </div>
        <div class="field-group">
          <NeoInputText
            v-model="form.lastName"
            label="Nom"
            placeholder="Dupont"
            :error="errors.lastName"
            required
          />
        </div>
      </div>

      <!-- Email -->
      <NeoInputText
        v-model="form.email"
        label="Adresse e-mail"
        placeholder="jean.dupont@example.com"
        :error="errors.email"
        required
      />

      <!-- Password (create only) -->
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

      <!-- Role -->
      <div>
        <NeoSelect
          v-model="form.role"
          label="Rôle"
          :options="USER_ROLE_OPTIONS"
          optionLabel="label"
          optionValue="value"
          :error="errors.role"
          required
        />
        <p class="role-hint">{{ ROLE_DESCRIPTIONS[form.role] }}</p>
      </div>
    </div>

    <template #footer>
      <NeoButton label="Annuler" severity="secondary" outlined @click="emit('close')" />
      <NeoButton
        :label="isEdit ? 'Enregistrer les modifications' : 'Créer l\'utilisateur'"
        :icon="isEdit ? 'pi pi-check' : 'pi pi-user-plus'"
        :loading="loading"
        @click="handleSubmit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { reactive, watch, computed } from 'vue'
import Dialog from 'primevue/dialog'
import { NeoInputText, NeoPassword, NeoSelect, NeoButton, NeoTag } from '@neolibrary/components'
import { USER_ROLE_OPTIONS, USER_ROLE_LABELS } from '@/types/user.types'
import type { UserResponse, CreateUserPayload, UpdateUserPayload, UserRole } from '@/types/user.types'

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

const isEdit = computed(() => !!props.user)

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
  if (!isEdit.value && form.password.length < 8)
    errors.password = 'Au moins 8 caractères.'
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
/* User hero (edit mode header) */
.user-hero {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.875rem 1rem;
  margin-bottom: 1.25rem;
}

.user-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0d9488, #0891b2);
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
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-hero-email {
  margin: 0;
  font-size: 0.78rem;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Form */
.form-body {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
  padding: 0.25rem 0;
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
  color: #9ca3af;
  min-height: 1.1em;
  transition: color 0.15s;
}

@media (max-width: 480px) {
  .fields-row { grid-template-columns: 1fr; }
}
</style>
