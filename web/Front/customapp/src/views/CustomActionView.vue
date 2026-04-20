<template>
  <div class="custom-action-page">
    <div class="custom-action-card">
      <h1 class="custom-action-title">Modification du document</h1>
      <p class="custom-action-subtitle">Mettez à jour le titre du document ci-dessous.</p>

      <NeoInputText
        v-model="subject"
        label="Titre"
        placeholder="Saisissez le titre du document"
        class="custom-action-field"
      />

      <NeoMessage
        v-if="errorMessage"
        severity="error"
        :text="errorMessage"
        :closable="true"
        class="custom-action-message"
      />

      <div class="custom-action-actions">
        <NeoButton
          label="Valider"
          icon="pi pi-check"
          :loading="submitting"
          @click="onSubmit"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoInputText, NeoButton, NeoMessage } from '@neolibrary/components'
import { useApp } from '@/stores/useApp'

const app = useApp()

const subject = ref('')
const errorMessage = ref('')
const submitting = ref(false)

onMounted(async () => {
  try {
    app.setLoading(true)
    const data = await app.getSample()
    subject.value = data.subject
  } catch {
    errorMessage.value = 'Impossible de charger les données du document.'
  } finally {
    app.setLoading(false)
  }
})

const onSubmit = async () => {
  if (!subject.value.trim()) {
    errorMessage.value = 'Le titre ne peut pas être vide.'
    return
  }

  try {
    submitting.value = true
    errorMessage.value = ''
    await app.updateSample({ subject: subject.value })
    // Use the configured API host as the expected parent origin so the message is
    // not broadcast to all parents. Falls back to '*' only when unconfigured.
    const targetOrigin: string = app.apiUrl ? new URL(app.apiUrl).origin : '*'
    if (!app.apiUrl) {
      console.warn('[CustomActionView] apiUrl not configured — postMessage sent to *, consider setting it in config.')
    }
    window.parent.postMessage('EliseCustomActionDone', targetOrigin)
  } catch {
    errorMessage.value = 'Une erreur est survenue lors de la mise à jour.'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.custom-action-page {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 2rem 1rem;
  min-height: 100vh;
}

.custom-action-card {
  background: var(--nl-surface);
  border-radius: var(--nl-radius-lg);
  box-shadow: var(--nl-shadow);
  padding: 2rem;
  width: 100%;
  max-width: 560px;
}

.custom-action-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0 0 0.5rem;
}

.custom-action-subtitle {
  font-size: 0.9rem;
  color: var(--nl-text-3);
  margin: 0 0 1.5rem;
}

.custom-action-field {
  width: 100%;
  margin-bottom: 1.25rem;
}

.custom-action-message {
  margin-bottom: 1.25rem;
}

.custom-action-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
