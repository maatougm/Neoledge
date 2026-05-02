<!-- @file CahierReviewActions.vue — Approve/Reject buttons for SpecificationTeam -->
<template>
  <div v-if="canReview" class="cra">
    <div class="cra__banner">
      <i class="pi pi-shield" />
      <span>Ce cahier des charges est en attente de votre validation.</span>
    </div>
    <div class="cra__actions">
      <NeoButton
        label="Approuver"
        icon="pi pi-check"
        :loading="submitting"
        @click="onApprove"
      />
      <NeoButton
        label="Rejeter"
        icon="pi pi-times"
        severity="danger"
        outlined
        :disabled="submitting"
        @click="showRejectModal = true"
      />
    </div>
  </div>

  <AppModal v-model:visible="showRejectModal" header="Rejeter le cahier des charges" width="560px">
    <div class="cra-form">
      <div class="cra-field">
        <label class="cra-field__label">Section concernée (optionnel)</label>
        <NeoSelect
          v-model="rejectSection"
          :options="sectionOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Section concernée…"
        />
      </div>
      <div class="cra-field">
        <label class="cra-field__label">Commentaire de rejet <span class="cra-required">*</span></label>
        <textarea
          v-model="rejectComment"
          class="cra-textarea"
          rows="6"
          placeholder="Décrivez précisément ce qui doit être corrigé. L'IA utilisera ce commentaire pour améliorer la prochaine génération."
        />
        <p class="cra-hint">{{ rejectComment.length }} / 10 caractères minimum</p>
      </div>
    </div>
    <template #footer>
      <NeoButton label="Annuler" severity="secondary" outlined @click="showRejectModal = false" />
      <NeoButton
        label="Envoyer le rejet"
        icon="pi pi-send"
        severity="danger"
        :loading="submitting"
        :disabled="rejectComment.trim().length < 10"
        @click="onReject"
      />
    </template>
  </AppModal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NeoButton, NeoSelect, useNeoToast } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import { useAuthStore } from '@/stores/authStore'
import api from '@/lib/api'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ (e: 'reviewed'): void }>()

const auth = useAuthStore()
const toast = useNeoToast()

const showRejectModal = ref(false)
const rejectComment = ref('')
const rejectSection = ref('')
const submitting = ref(false)
const isProjectMember = ref(false)

const sectionOptions = [
  { label: '— Général —', value: '' },
  { label: 'Contexte', value: 'contexte' },
  { label: 'Objectif du projet', value: 'objectifProjet' },
  { label: 'Périmètre inclus', value: 'perimetreInclus' },
  { label: 'Périmètre exclu', value: 'perimetreExclus' },
  { label: 'Exigences fonctionnelles', value: 'exigencesFonctionnelles' },
  { label: 'Architecture technique', value: 'architectureTechnique' },
  { label: 'Livrables', value: 'livrables' },
  { label: 'Conclusion', value: 'conclusion' },
]

// Only Admins or SpecificationTeam users explicitly added to this project may review.
const canReview = computed(() => {
  if (auth.userRole === 'Admin') return true
  if (auth.userRole !== 'SpecificationTeam') return false
  return isProjectMember.value
})

interface ProjectMemberLite { userId: string }

onMounted(async () => {
  if (auth.userRole !== 'SpecificationTeam') return
  try {
    const { data } = await api.get<ProjectMemberLite[]>(`/pm/projects/${props.projectId}/members`)
    isProjectMember.value = !!auth.userId && data.some((m) => m.userId === auth.userId)
  } catch {
    isProjectMember.value = false
  }
})

async function onApprove(): Promise<void> {
  submitting.value = true
  try {
    await api.post(`/pm/projects/${props.projectId}/cahier-des-charges/feedback`, {
      status: 'approved',
      comment: 'Approuvé sans réserve.',
    })
    toast.add({ severity: 'success', detail: 'Cahier approuvé. Le PM sera notifié.', life: 4000 })
    emit('reviewed')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Échec de l\'approbation'
    toast.add({ severity: 'error', detail: msg, life: 5000 })
  } finally {
    submitting.value = false
  }
}

async function onReject(): Promise<void> {
  if (rejectComment.value.trim().length < 10) return
  submitting.value = true
  try {
    await api.post(`/pm/projects/${props.projectId}/cahier-des-charges/feedback`, {
      status: 'rejected',
      comment: rejectComment.value.trim(),
      section: rejectSection.value || undefined,
    })
    toast.add({ severity: 'warn', detail: 'Rejet envoyé. Le PM sera notifié.', life: 4000 })
    showRejectModal.value = false
    rejectComment.value = ''
    rejectSection.value = ''
    emit('reviewed')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Échec de l\'envoi'
    toast.add({ severity: 'error', detail: msg, life: 5000 })
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.cra {
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1.25rem;
  background: linear-gradient(to right, rgba(30, 158, 143, 0.08), rgba(30, 158, 143, 0.03));
  border: 1px solid var(--nl-accent, #1e9e8f);
  border-radius: 8px;
  margin-bottom: 1rem;
}
.cra__banner {
  display: flex; align-items: center; gap: 0.625rem;
  font-size: 0.875rem;
  color: var(--nl-text, #111827);
  font-weight: 500;
}
.cra__banner i { color: var(--nl-accent, #1e9e8f); font-size: 1.125rem; }
.cra__actions { display: flex; gap: 0.5rem; }
.cra-form { display: flex; flex-direction: column; gap: 1rem; padding: 0.5rem 0; }
.cra-field { display: flex; flex-direction: column; gap: 0.375rem; }
.cra-field__label { font-size: 0.8125rem; font-weight: 500; color: var(--nl-text-muted, #6b7280); }
.cra-required { color: #dc2626; }
.cra-textarea {
  width: 100%;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 6px;
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  font-family: inherit;
  resize: vertical;
}
.cra-hint { font-size: 0.75rem; color: var(--nl-text-muted, #9ca3af); margin: 0; }
</style>
