<template>
  <div class="automation-section">
    <!-- Header -->
    <div class="automation-header">
      <h3 class="section-title">Automatisations</h3>
      <NeoButton label="Nouvelle règle" icon="pi pi-plus" @click="openCreateDialog" />
    </div>

    <!-- Rules list -->
    <div v-if="store.automationRules.length === 0" class="empty-state">
      <i class="pi pi-cog empty-icon" />
      <p>Aucune règle d'automatisation configurée.</p>
    </div>

    <div v-else class="rules-list">
      <NeoCard v-for="rule in store.automationRules" :key="rule.id" class="rule-card">
        <template #content>
          <div class="rule-row">
            <div class="rule-info">
              <span class="rule-name">{{ rule.name }}</span>
              <div class="rule-badges">
                <NeoTag :value="triggerLabel(rule.triggerEvent)" severity="info" />
                <NeoTag :value="actionLabel(rule.actionType)" severity="secondary" />
              </div>
              <span class="rule-meta">
                {{ rule.executionCount }} exécution(s)
                <template v-if="rule.lastExecutedAt">
                  · Dernière: {{ formatDate(rule.lastExecutedAt) }}
                </template>
              </span>
            </div>
            <div class="rule-actions">
              <NeoButton
                :label="rule.isActive ? 'Actif' : 'Inactif'"
                outlined
                :severity="rule.isActive ? undefined : 'secondary'"
                size="small"
                @click="toggleRule(rule)"
              />
              <NeoButton
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                @click="confirmDelete(rule)"
              />
            </div>
          </div>
        </template>
      </NeoCard>
    </div>

    <!-- Logs panel -->
    <div class="logs-panel">
      <button class="logs-toggle" @click="logsExpanded = !logsExpanded">
        <i :class="['pi', logsExpanded ? 'pi-chevron-down' : 'pi-chevron-right']" />
        Historique des exécutions
        <span class="logs-count">({{ store.automationLogs.length }})</span>
      </button>

      <div v-if="logsExpanded" class="logs-list">
        <div v-if="store.automationLogs.length === 0" class="logs-empty">
          Aucune exécution enregistrée.
        </div>
        <div v-for="log in store.automationLogs.slice(0, 20)" :key="log.id" class="log-row">
          <NeoTag
            :value="logStatusLabel(log.status)"
            :severity="logStatusSeverity(log.status)"
          />
          <span class="log-detail">{{ log.detail ?? '—' }}</span>
          <span class="log-date">{{ formatDate(log.executedAt) }}</span>
        </div>
      </div>
    </div>

    <!-- Create Dialog -->
    <NeoDialog
      v-model:visible="dialogVisible"
      header="Nouvelle règle d'automatisation"
      modal
      :style="{ width: '480px' }"
    >
      <div class="dialog-form">
        <div class="form-field">
          <label>Nom de la règle</label>
          <NeoInputText v-model="form.name" placeholder="Ex: Notifier à la fin du projet" />
        </div>

        <div class="form-field">
          <label>Événement déclencheur</label>
          <NeoSelect
            v-model="form.triggerEvent"
            :options="triggerOptions"
            option-label="label"
            option-value="value"
            placeholder="Choisir un événement"
          />
        </div>

        <div class="form-field">
          <label>Type d'action</label>
          <NeoSelect
            v-model="form.actionType"
            :options="actionOptions"
            option-label="label"
            option-value="value"
            placeholder="Choisir une action"
          />
        </div>

        <!-- send_notification fields -->
        <template v-if="form.actionType === 'send_notification'">
          <div class="form-field">
            <label>Message</label>
            <NeoInputText v-model="form.actionMessage" placeholder="Message de notification" />
          </div>
          <div class="form-field">
            <label>Destinataire (userId)</label>
            <NeoInputText v-model="form.actionUserId" placeholder="ID utilisateur" />
          </div>
        </template>

        <!-- update_field fields -->
        <template v-else-if="form.actionType === 'update_field'">
          <div class="form-field">
            <label>Field ID</label>
            <NeoInputText v-model="form.actionFieldId" placeholder="ID du champ" />
          </div>
          <div class="form-field">
            <label>Valeur</label>
            <NeoInputText v-model="form.actionValue" placeholder="Nouvelle valeur" />
          </div>
        </template>

        <NeoMessage v-if="formError" severity="error" :text="formError" />
      </div>

      <template #footer>
        <NeoButton label="Annuler" outlined severity="secondary" @click="dialogVisible = false" />
        <NeoButton label="Enregistrer" :loading="saving" @click="submitRule" />
      </template>
    </NeoDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoButton, NeoCard, NeoTag, NeoDialog, NeoInputText, NeoSelect, NeoMessage } from '@neolibrary/components'
import { useNeoToast, useNeoConfirm } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import type { AutomationRule } from '@/types/pm.types'

const props = defineProps<{ projectId: string }>()

const store = usePmStore()
const toast = useNeoToast()
const confirm = useNeoConfirm()

const dialogVisible = ref(false)
const logsExpanded = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)

const defaultForm = () => ({
  name: '',
  triggerEvent: '',
  actionType: '',
  actionMessage: '',
  actionUserId: '',
  actionFieldId: '',
  actionValue: '',
})

const form = ref(defaultForm())

const triggerOptions = [
  { value: 'status_changed',        label: 'Statut modifié' },
  { value: 'validation_submitted',  label: 'Validation soumise' },
  { value: 'field_updated',         label: 'Champ mis à jour' },
  { value: 'deadline_approaching',  label: 'Échéance proche' },
]

const actionOptions = [
  { value: 'send_notification', label: 'Envoyer une notification' },
  { value: 'update_field',      label: 'Mettre à jour un champ' },
]

function triggerLabel(event: string): string {
  return triggerOptions.find((o) => o.value === event)?.label ?? event
}

function actionLabel(type: string): string {
  return actionOptions.find((o) => o.value === type)?.label ?? type
}

function logStatusLabel(status: string): string {
  if (status === 'success') return 'Succès'
  if (status === 'failed')  return 'Échec'
  return 'Ignoré'
}

function logStatusSeverity(status: string): 'success' | 'danger' | 'secondary' {
  if (status === 'success') return 'success'
  if (status === 'failed')  return 'danger'
  return 'secondary'
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function openCreateDialog() {
  form.value = defaultForm()
  formError.value = null
  dialogVisible.value = true
}

async function submitRule() {
  formError.value = null
  if (!form.value.name.trim()) {
    formError.value = 'Le nom de la règle est requis.'
    return
  }
  if (!form.value.triggerEvent) {
    formError.value = "L'événement déclencheur est requis."
    return
  }
  if (!form.value.actionType) {
    formError.value = "Le type d'action est requis."
    return
  }

  const actionConfig: Record<string, unknown> = {}
  if (form.value.actionType === 'send_notification') {
    actionConfig['message'] = form.value.actionMessage
    actionConfig['userId']  = form.value.actionUserId
  } else if (form.value.actionType === 'update_field') {
    actionConfig['fieldId'] = form.value.actionFieldId
    actionConfig['value']   = form.value.actionValue
  }

  saving.value = true
  const ok = await store.createAutomationRule(props.projectId, {
    name: form.value.name.trim(),
    triggerEvent: form.value.triggerEvent,
    actionType: form.value.actionType,
    actionConfig,
    triggerCondition: null,
  })
  saving.value = false

  if (ok) {
    toast.add({ severity: 'success', detail: 'Règle créée avec succès.', life: 3000 })
    dialogVisible.value = false
  } else {
    formError.value = store.error ?? 'Erreur lors de la création.'
  }
}

async function toggleRule(rule: AutomationRule) {
  const ok = await store.toggleAutomationRule(props.projectId, rule.id, !rule.isActive)
  if (ok) {
    toast.add({
      severity: 'success',
      detail: rule.isActive ? 'Règle désactivée.' : 'Règle activée.',
      life: 3000,
    })
  }
}

function confirmDelete(rule: AutomationRule) {
  confirm.require({
    message: `Supprimer la règle "${rule.name}" ? Cette action est irréversible.`,
    header: 'Confirmer la suppression',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    accept: async () => {
      const ok = await store.deleteAutomationRule(props.projectId, rule.id)
      if (ok) {
        toast.add({ severity: 'success', detail: 'Règle supprimée.', life: 3000 })
      }
    },
  })
}

onMounted(async () => {
  await store.fetchAutomationRules(props.projectId)
  await store.fetchAutomationLogs(props.projectId)
})
</script>

<style scoped>
.automation-section {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.automation-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--nl-text-1);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.5rem;
  color: var(--nl-text-3);
  text-align: center;
}

.empty-icon {
  font-size: 2.5rem;
  opacity: 0.4;
}

.rules-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.rule-card :deep(.p-card-content) {
  padding: 0.75rem 1rem;
}

.rule-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.rule-info {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.rule-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--nl-text-1);
}

.rule-badges {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.rule-meta {
  font-size: 0.8rem;
  color: var(--nl-text-3);
}

.rule-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-shrink: 0;
}

.logs-panel {
  border-top: 1px solid var(--nl-border);
  padding-top: 0.75rem;
}

.logs-toggle {
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--nl-text-2);
  padding: 0;
}

.logs-toggle:hover {
  color: var(--nl-text-1);
}

.logs-count {
  color: var(--nl-text-3);
  font-size: 0.8rem;
}

.logs-list {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.logs-empty {
  font-size: 0.85rem;
  color: var(--nl-text-3);
  padding: 0.5rem 0;
}

.log-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.85rem;
}

.log-detail {
  flex: 1;
  color: var(--nl-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-date {
  color: var(--nl-text-3);
  white-space: nowrap;
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 0.25rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.form-field label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--nl-text-2);
}
</style>
