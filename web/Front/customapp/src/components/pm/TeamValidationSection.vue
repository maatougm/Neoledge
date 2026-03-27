<template>
  <div class="validation-section">
    <div class="v-header">
      <h3 class="v-title">Validation des équipes</h3>
      <NeoButton
        label="Soumettre ma validation"
        icon="pi pi-send"
        @click="showForm = true"
      />
    </div>

    <!-- Submit form -->
    <div v-if="showForm" class="submit-form">
      <h4 class="form-title">Votre validation</h4>
      <div class="approve-row">
        <button :class="['approve-btn', { 'approve-btn--yes': decision === true }]" @click="decision = true">
          <i class="pi pi-check" /> Approuvé
        </button>
        <button :class="['approve-btn', 'approve-btn--no-style', { 'approve-btn--no': decision === false }]" @click="decision = false">
          <i class="pi pi-times" /> Refusé
        </button>
      </div>
      <NeoInputText v-model="comment" label="Commentaire (optionnel)" placeholder="Ajouter un commentaire..." class="w-full" />
      <div class="form-actions">
        <NeoButton severity="secondary" label="Annuler" outlined @click="cancelForm" />
        <NeoButton
          label="Confirmer"
          icon="pi pi-check"
          :loading="store.saving"
          :disabled="decision === null"
          @click="handleSubmit"
        />
      </div>
    </div>

    <!-- Validation list -->
    <div v-if="validations.length === 0 && !showForm" class="empty-state">
      <i class="pi pi-shield" />
      <p>Aucune validation soumise pour ce projet.</p>
    </div>

    <div v-else class="validation-list">
      <div v-for="v in validations" :key="v.id" class="v-row">
        <div :class="['v-badge', v.isApproved ? 'v-badge--yes' : 'v-badge--no']">
          <i :class="v.isApproved ? 'pi pi-check' : 'pi pi-times'" />
        </div>
        <div class="v-body">
          <div class="v-top">
            <span class="v-name">{{ v.validatedByName }}</span>
            <NeoTag :value="ROLE_LABELS[v.validatedByRole] ?? v.validatedByRole" severity="secondary" />
            <span class="v-phase">Phase : {{ STATUS_LABELS[v.phase] ?? v.phase }}</span>
            <span class="v-date">{{ formatDate(v.validatedAt) }}</span>
          </div>
          <p v-if="v.comment" class="v-comment">{{ v.comment }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NeoButton, NeoTag, NeoInputText, useNeoToast } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import { PROJECT_STATUS_LABELS } from '@/types/project.types'
import type { ProjectValidation } from '@/types/pm.types'

const props = defineProps<{ projectId: string; validations: ProjectValidation[] }>()

const store = usePmStore()
const toast = useNeoToast()

const STATUS_LABELS = PROJECT_STATUS_LABELS
const ROLE_LABELS: Record<string, string> = {
  Admin: 'Admin',
  ProjectManager: 'Chef de projet',
  SpecificationTeam: 'Équipe spéc.',
  RealizationTeam: 'Équipe réal.',
  DeploymentTeam: 'Équipe déploiement',
  Viewer: 'Observateur',
}

const showForm = ref(false)
const decision = ref<boolean | null>(null)
const comment  = ref('')

const cancelForm = () => { showForm.value = false; decision.value = null; comment.value = '' }

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })

const handleSubmit = async () => {
  if (decision.value === null) return
  const ok = await store.submitValidation(props.projectId, {
    isApproved: decision.value,
    comment: comment.value.trim() || null,
  })
  if (ok) {
    toast.add({ severity: 'success', detail: 'Validation soumise.', life: 3000 })
    cancelForm()
  } else {
    toast.add({ severity: 'error', detail: store.error ?? 'Erreur.', life: 5000 })
  }
}
</script>

<style scoped>
.validation-section { display: flex; flex-direction: column; gap: 1.25rem; }

.v-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; }
.v-title { font-size: 1rem; font-weight: 700; color: #111827; margin: 0; }

.submit-form {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.form-title { font-size: 0.9rem; font-weight: 600; color: #374151; margin: 0; }

.approve-row { display: flex; gap: 0.75rem; }

.approve-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1.25rem;
  border-radius: 8px;
  border: 2px solid #e5e7eb;
  background: #fff;
  font-size: 0.875rem;
  font-weight: 600;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s;
}
.approve-btn--yes { border-color: #10b981; background: #ecfdf5; color: #059669; }
.approve-btn--no  { border-color: #ef4444; background: #fef2f2; color: #dc2626; }

.form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem;
  color: #9ca3af;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px dashed #e5e7eb;
}
.empty-state i { font-size: 2rem; }
.empty-state p { margin: 0; font-size: 0.875rem; }

.validation-list { display: flex; flex-direction: column; gap: 0.75rem; }

.v-row {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.875rem 1rem;
}

.v-badge {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  flex-shrink: 0;
}
.v-badge--yes { background: #ecfdf5; color: #059669; }
.v-badge--no  { background: #fef2f2; color: #dc2626; }

.v-body { flex: 1; display: flex; flex-direction: column; gap: 0.3rem; }
.v-top { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.v-name { font-size: 0.875rem; font-weight: 600; color: #111827; }
.v-phase { font-size: 0.78rem; color: #6b7280; }
.v-date { font-size: 0.78rem; color: #9ca3af; margin-left: auto; }
.v-comment { margin: 0; font-size: 0.82rem; color: #6b7280; font-style: italic; }
</style>
