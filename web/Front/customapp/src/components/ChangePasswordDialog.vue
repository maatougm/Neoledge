<template>
  <AppModal
    :visible="visible"
    header="Changer mon mot de passe"
    width="420px"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="form-body change-password-form">
      <div class="field-wrap">
        <NeoPassword
          v-model="current"
          label="Mot de passe actuel"
          placeholder="••••••••"
          toggleMask
          :feedback="false"
          autocomplete="current-password"
        />
      </div>
      <div class="field-wrap">
        <NeoPassword
          v-model="newPass"
          label="Nouveau mot de passe"
          placeholder="••••••••"
          toggleMask
          :feedback="true"
          autocomplete="new-password"
        />
      </div>
      <div class="field-wrap">
        <NeoPassword
          v-model="confirm"
          label="Confirmer le nouveau mot de passe"
          placeholder="••••••••"
          toggleMask
          :feedback="false"
          autocomplete="new-password"
        />
      </div>
      <NeoMessage v-if="errorMsg" severity="error" :text="errorMsg" />
    </div>
    <template #footer>
      <NeoButton label="Annuler" severity="secondary" outlined @click="emit('update:visible', false)" />
      <NeoButton label="Enregistrer" :loading="loading" @click="submit" />
    </template>
  </AppModal>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import AppModal from '@/components/common/AppModal.vue'
import { NeoPassword, NeoButton, NeoMessage, useNeoToast } from '@neolibrary/components'
import api from '@/lib/api'
import { applyAutofill } from '@/lib/autofillFix'

const props = defineProps<{ visible: boolean }>()
const emit  = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

// NeoPassword doesn't forward `autocomplete` to the underlying <input>, so Chrome's
// password manager skips the fields and DOM Issues warns about missing autocomplete.
// Patch the inner inputs once the dialog is mounted in the DOM (Teleport) and visible.
watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    await nextTick()
    applyAutofill({
      scope: '.change-password-form',
      password: 'current-password',
      passwordSecond: 'new-password',
    })
    // The helper only patches the first two password inputs; tag the confirm field too.
    const inputs = document.querySelectorAll<HTMLInputElement>(
      '.change-password-form input[type="password"]',
    )
    const third = inputs[2]
    if (third && !third.getAttribute('autocomplete')) {
      third.setAttribute('autocomplete', 'new-password')
      third.setAttribute('name', 'new-password-confirm')
    }
  },
)

const toast   = useNeoToast()
const current = ref('')
const newPass = ref('')
const confirm = ref('')
const errorMsg = ref('')
const loading  = ref(false)

const reset = () => { current.value = ''; newPass.value = ''; confirm.value = ''; errorMsg.value = '' }

async function submit() {
  errorMsg.value = ''
  if (newPass.value.length < 8) {
    errorMsg.value = 'Le nouveau mot de passe doit contenir au moins 8 caractères.'
    return
  }
  if (newPass.value !== confirm.value) {
    errorMsg.value = 'Les mots de passe ne correspondent pas.'
    return
  }
  loading.value = true
  try {
    await api.post('/auth/change-password', { currentPassword: current.value, newPassword: newPass.value })
    toast.add({ severity: 'success', detail: 'Mot de passe modifié avec succès.', life: 3000 })
    emit('update:visible', false)
    reset()
  } catch {
    errorMsg.value = 'Erreur lors du changement de mot de passe.'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.form-body { display: flex; flex-direction: column; gap: 1rem; padding: 0.5rem 0; }
.field-wrap { display: flex; flex-direction: column; gap: 0.3rem; }
</style>
