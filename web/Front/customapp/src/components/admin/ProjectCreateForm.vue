<!--
  @file     ProjectCreateForm.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-26
  @desc     Form panel for creating a new deployment project with NeoLibrary inputs
-->
<template>
  <div class="project-form">
    <div class="project-form__header">
      <h3 class="project-form__title">Nouveau projet de déploiement</h3>
    </div>

    <div class="project-form__body">
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
        :loading="submitting"
        @click="handleSubmit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { NeoInputText, NeoSelect, NeoDatePicker, NeoButton } from '@neolibrary/components'
import { useProjectForm } from '@/composables/useProjectForm'
import { useUserStore } from '@/stores/userStore'

const emit = defineEmits<{
  cancel: []
  created: []
}>()

const { form, errors, submitting, submitCreate } = useProjectForm()
const userStore = useUserStore()

const pmOptions = computed(() =>
  userStore.projectManagers.map((u) => ({
    value: u.id,
    label: `${u.firstName} ${u.lastName}`,
  })),
)

const handleSubmit = async () => {
  const ok = await submitCreate()
  if (ok) emit('created')
}

// Load PMs on mount if not already loaded
watch(
  () => userStore.projectManagers.length,
  (len) => { if (len === 0) userStore.fetchAll() },
  { immediate: true },
)
</script>

<style scoped>
.project-form {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.project-form__header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #f3f4f6;
}

.project-form__title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #111827;
  margin: 0;
}

.project-form__body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
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
  border-top: 1px solid #f3f4f6;
  background: #f9fafb;
}

@media (max-width: 600px) {
  .project-form__row { grid-template-columns: 1fr; }
}
</style>
