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
      <div v-for="rule in store.automationRules" :key="rule.id" class="rule-card">
        <div class="rule-status-dot" :class="rule.isActive ? 'rule-status-dot--active' : 'rule-status-dot--inactive'" />
        <div class="rule-info">
          <span class="rule-name">{{ rule.name }}</span>
          <div class="rule-badges">
            <span class="rule-badge rule-badge--trigger">{{ triggerLabel(rule.triggerEvent) }}</span>
            <span class="rule-badge rule-badge--action">{{ actionLabel(rule.actionType) }}</span>
          </div>
          <span class="rule-exec-count">{{ rule.executionCount }} exécution(s)<template v-if="rule.lastExecutedAt"> · {{ formatDate(rule.lastExecutedAt) }}</template></span>
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
    </div>

    <!-- Logs panel -->
    <div class="logs-panel">
      <button class="logs-toggle" @click="logsExpanded = !logsExpanded">
        <i :class="['pi', logsExpanded ? 'pi-chevron-down' : 'pi-chevron-right']" />
        Historique des exécutions
        <span class="logs-count">({{ store.automationLogs.length }})</span>
      </button>

      <div v-if="logsExpanded" class="logs-table-wrap">
        <div v-if="store.automationLogs.length === 0" class="logs-empty">
          Aucune exécution enregistrée.
        </div>
        <table v-else class="logs-table">
          <thead>
            <tr>
              <th>Statut</th>
              <th>Détail</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in store.automationLogs.slice(0, 20)" :key="log.id">
              <td>
                <span :class="['log-status-chip', `log-status-chip--${log.status}`]">
                  {{ logStatusLabel(log.status) }}
                </span>
              </td>
              <td class="log-detail-cell">{{ log.detail ?? '—' }}</td>
              <td class="log-date-cell">{{ formatDate(log.executedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Create Dialog -->
    <AppModal
      v-model:visible="dialogVisible"
      header="Nouvelle règle d'automatisation"
      width="480px"
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
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoButton, NeoInputText, NeoSelect, NeoMessage } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
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
  // Legacy project-level events
  { value: 'status_changed',                 label: 'Projet : statut modifié' },
  { value: 'validation_submitted',           label: 'Projet : validation soumise' },
  { value: 'field_updated',                  label: 'Projet : champ mis à jour' },
  { value: 'deadline_approaching',           label: 'Projet : échéance proche' },
  // v2.0 work package events
  { value: 'work_package_created',           label: 'Work Package : créé' },
  { value: 'work_package_status_changed',    label: 'Work Package : statut modifié' },
  // v2.0 sprint events
  { value: 'sprint_started',                 label: 'Sprint : démarré' },
  { value: 'sprint_closed',                  label: 'Sprint : clôturé' },
  // v2.0 milestone events
  { value: 'milestone_reached',              label: 'Jalon : atteint' },
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

  // Extra validation for send_notification (#12)
  if (form.value.actionType === 'send_notification') {
    if (!form.value.actionMessage.trim()) {
      formError.value = 'Le message de notification ne peut pas être vide.'
      return
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (form.value.actionUserId && !UUID_RE.test(form.value.actionUserId)) {
      formError.value = "L'ID utilisateur doit être un UUID valide (ex : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)."
      return
    }
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

/* Rule cards */
.rules-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.rule-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  background: var(--nl-surface);
  transition: box-shadow 0.15s;
}

.rule-card:hover {
  box-shadow: var(--nl-shadow-md, var(--nl-shadow));
}

/* Active/Inactive status dot */
.rule-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.rule-status-dot--active  { background: #16A34A; }
.rule-status-dot--inactive { background: var(--nl-text-3); }

.rule-info {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1;
  min-width: 0;
}

.rule-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--nl-text-1);
}

.rule-badges {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.rule-badge {
  display: inline-flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
}

.rule-badge--trigger {
  background: #EFF4FF;
  color: #0F62FE;
}

.rule-badge--action {
  background: #F0FDF4;
  color: #16A34A;
}

.rule-exec-count {
  font-size: 11px;
  color: var(--nl-text-3);
}

.rule-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-shrink: 0;
}

/* Logs panel */
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

.logs-toggle:hover { color: var(--nl-text-1); }

.logs-count {
  color: var(--nl-text-3);
  font-size: 0.8rem;
}

.logs-table-wrap {
  margin-top: 0.75rem;
  overflow-x: auto;
}

.logs-empty {
  font-size: 0.85rem;
  color: var(--nl-text-3);
  padding: 0.5rem 0;
}

.logs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.logs-table th {
  text-align: left;
  padding: 0.4rem 0.75rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--nl-text-3);
  border-bottom: 1px solid var(--nl-border);
}

.logs-table td {
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--nl-border);
  vertical-align: middle;
}

.logs-table tr:last-child td { border-bottom: none; }

.log-status-chip {
  display: inline-flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
  white-space: nowrap;
}

.log-status-chip--success { background: #F0FDF4; color: #16A34A; }
.log-status-chip--failed  { background: #FEF2F2; color: #DC2626; }
.log-status-chip--skipped { background: var(--nl-surface-2); color: var(--nl-text-3); }

.log-detail-cell {
  color: var(--nl-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.log-date-cell {
  color: var(--nl-text-3);
  white-space: nowrap;
  font-size: 0.75rem;
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
