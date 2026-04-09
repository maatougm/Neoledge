<template>
  <div class="ai-section">
    <div class="ai-header">
      <div class="ai-icon-wrap">
        <i class="pi pi-sparkles ai-icon" />
      </div>
      <div>
        <h3 class="ai-title">Analyse IA</h3>
        <p class="ai-sub">Résultat généré automatiquement à partir du questionnaire</p>
      </div>
    </div>

    <!-- Content state: AI output exists -->
    <div v-if="aiOutput" class="ai-output">
      <p>{{ aiOutput }}</p>
      <div class="ai-actions">
        <NeoButton
          label="Régénérer"
          icon="pi pi-sparkles"
          outlined
          size="small"
          :loading="generating"
          @click="handleGenerate"
        />
      </div>
    </div>

    <!-- Empty state: no AI output -->
    <div v-else class="ai-empty">
      <i class="pi pi-sparkles ai-empty-icon" />
      <p class="ai-empty-text">Aucune analyse disponible</p>
      <NeoButton
        label="Générer l'analyse"
        icon="pi pi-sparkles"
        :loading="generating"
        @click="handleGenerate"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NeoButton, useNeoToast } from '@neolibrary/components'

defineProps<{ aiOutput: string | null | undefined }>()

const toast = useNeoToast()
const generating = ref(false)

const handleGenerate = (): void => {
  generating.value = true

  // Simulate a brief loading state before showing the info toast
  setTimeout(() => {
    generating.value = false
    toast.add({
      severity: 'info',
      detail: 'Fonctionnalité IA bientôt disponible.',
      life: 4000,
    })
  }, 800)
}
</script>

<style scoped>
.ai-section { display: flex; flex-direction: column; gap: 1.25rem; }

.ai-header { display: flex; align-items: center; gap: 1rem; }

.ai-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--nl-accent), var(--nl-info, #6366f1));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ai-icon { font-size: 1.25rem; color: #fff; }

.ai-title { font-size: 1rem; font-weight: 700; color: var(--nl-text-1); margin: 0; }
.ai-sub   { font-size: 0.82rem; color: var(--nl-text-3); margin: 0.15rem 0 0; }

.ai-output {
  background: var(--nl-surface-2, #f8fafc);
  border: 1px solid var(--nl-border);
  border-left: 4px solid var(--nl-accent);
  border-radius: var(--nl-radius);
  padding: 1.25rem 1.5rem;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--nl-text-2);
  white-space: pre-wrap;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.ai-output p { margin: 0; }

.ai-actions {
  display: flex;
  justify-content: flex-end;
}

.ai-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 3rem;
  color: var(--nl-text-3);
  background: var(--nl-surface-2);
  border-radius: var(--nl-radius);
  border: 1px dashed var(--nl-border);
  text-align: center;
}
.ai-empty-icon { font-size: 2rem; color: var(--nl-accent); }
.ai-empty-text { margin: 0; font-size: 0.875rem; }
</style>
