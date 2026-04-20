<!--
  @file     ProjectCreateForm.vue
  @module   NeoLeadge — Deployment Manager
  @desc     Form panel for creating a new deployment project with NeoLibrary inputs.
            Supports optional "start from template" to auto-apply fields after creation.
-->
<template>
  <div class="project-form">
    <div class="project-form__header">
      <h3 class="project-form__title">Nouveau projet de déploiement</h3>
    </div>

    <div class="project-form__body">
      <!-- Template selector (optional) -->
      <div v-if="templateStore.templates.length > 0" class="project-form__template-row">
        <div class="template-label">
          <i class="pi pi-copy template-label__icon" />
          <span>Démarrer depuis un modèle (optionnel)</span>
        </div>
        <NeoSelect
          v-model="selectedTemplateId"
          :options="templateOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Aucun modèle sélectionné"
          class="project-form__field--full"
        />
        <p v-if="selectedTemplateId" class="template-hint">
          <i class="pi pi-info-circle" />
          {{ selectedTemplateFieldCount }} champ(s) seront ajoutés au projet après création.
        </p>
      </div>

      <div class="project-form__row">
        <NeoInputText
          v-model="form.name"
          label="Nom du projet"
          placeholder="Ex : Déploiement GED Client X"
          :error="errors.name"
          required
          class="project-form__field"
        />
        <NeoInputText
          v-model="form.clientName"
          label="Nom du client"
          placeholder="Ex : Société ACME"
          :error="errors.clientName"
          required
          class="project-form__field"
        />
      </div>

      <div class="project-form__row">
        <NeoDatePicker
          v-model="form.startDate"
          label="Date de début"
          dateFormat="dd/mm/yy"
          :error="errors.startDate"
          required
          class="project-form__field"
        />
        <NeoDatePicker
          v-model="form.endDate"
          label="Date de fin"
          dateFormat="dd/mm/yy"
          :error="errors.endDate"
          required
          class="project-form__field"
        />
      </div>

      <NeoSelect
        v-model="form.projectManagerId"
        label="Chef de projet (optionnel)"
        :options="pmOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Sélectionner un chef de projet"
        class="project-form__field--full"
      />
    </div>

    <div class="project-form__footer">
      <NeoButton label="Annuler" severity="secondary" @click="emit('cancel')" />
      <NeoButton
        label="Créer le projet"
        icon="pi pi-check"
        :loading="submitting || applyingTemplate"
        :disabled="submitting || applyingTemplate"
        @click="handleSubmit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NeoInputText, NeoSelect, NeoDatePicker, NeoButton, useNeoToast } from '@neolibrary/components'
import { useProjectForm } from '@/composables/useProjectForm'
import { useProjectStore } from '@/stores/projectStore'
import { useUserStore } from '@/stores/userStore'
import { useTemplateStore } from '@/stores/templateStore'

const emit = defineEmits<{
  cancel: []
  created: []
}>()

const { form, errors, submitting, submitCreate } = useProjectForm()
const projectStore  = useProjectStore()
const userStore     = useUserStore()
const templateStore = useTemplateStore()
const toast         = useNeoToast()

const selectedTemplateId = ref<string | null>(null)
const applyingTemplate   = ref(false)

const pmOptions = computed(() =>
  userStore.projectManagers.map((u) => ({
    value: u.id,
    label: `${u.firstName} ${u.lastName}`,
  })),
)

const templateOptions = computed(() =>
  templateStore.templates.map((t) => ({
    value: t.id,
    label: `${t.name}${t.description ? ` — ${t.description}` : ''}`,
  })),
)

const selectedTemplateFieldCount = computed(() => {
  if (!selectedTemplateId.value) return 0
  return templateStore.templates.find((t) => t.id === selectedTemplateId.value)?.fieldCount ?? 0
})

const handleSubmit = async () => {
  const ok = await submitCreate()
  if (!ok) return

  const createdId = projectStore.currentProject?.id ?? null

  if (selectedTemplateId.value && createdId) {
    applyingTemplate.value = true
    try {
      await templateStore.applyToProject(selectedTemplateId.value, createdId)
    } catch {
      toast.add({
        severity: 'warn',
        detail: "Projet créé, mais l'application du modèle a échoué.",
        life: 5000,
      })
    } finally {
      applyingTemplate.value = false
    }
  }

  emit('created')
}

// Load PMs and templates on mount if not already loaded
watch(
  () => userStore.projectManagers.length,
  (len) => { if (len === 0) userStore.fetchAll() },
  { immediate: true },
)

watch(
  () => templateStore.templates.length,
  (len) => { if (len === 0) templateStore.fetchTemplates() },
  { immediate: true },
)
</script>

<style scoped>
.project-form {
  background: var(--nl-surface);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow);
  overflow: hidden;
}

.project-form__header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--nl-surface-2);
}

.project-form__title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
}

.project-form__body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.project-form__template-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--nl-accent-light);
  border: 1px solid rgba(13, 148, 136, 0.2);
  border-radius: var(--nl-radius);
}

.template-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--nl-accent);
}

.template-label__icon { font-size: 0.9rem; }

.template-hint {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: var(--nl-accent);
  margin: 0;
}

.project-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.project-form__field { width: 100%; }
.project-form__field--full { width: 100%; }

.project-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--nl-surface-2);
  background: var(--nl-surface-2);
}

@media (max-width: 600px) {
  .project-form__row { grid-template-columns: 1fr; }
}
</style>
