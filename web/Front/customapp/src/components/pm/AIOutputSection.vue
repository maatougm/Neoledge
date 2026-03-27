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

    <div v-if="aiOutput" class="ai-output">
      <p>{{ aiOutput }}</p>
    </div>
    <div v-else class="ai-empty">
      <i class="pi pi-clock" />
      <p>L'analyse IA sera disponible une fois le questionnaire validé par l'administrateur.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ aiOutput: string | null | undefined }>()
</script>

<style scoped>
.ai-section { display: flex; flex-direction: column; gap: 1.25rem; }

.ai-header { display: flex; align-items: center; gap: 1rem; }

.ai-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: linear-gradient(135deg, #0d9488, #6366f1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ai-icon { font-size: 1.25rem; color: #fff; }

.ai-title { font-size: 1rem; font-weight: 700; color: #111827; margin: 0; }
.ai-sub   { font-size: 0.82rem; color: #6b7280; margin: 0.15rem 0 0; }

.ai-output {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-left: 4px solid #0d9488;
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  font-size: 0.9rem;
  line-height: 1.7;
  color: #374151;
  white-space: pre-wrap;
}

.ai-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem;
  color: #9ca3af;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px dashed #e5e7eb;
  text-align: center;
}
.ai-empty i { font-size: 2rem; }
.ai-empty p { margin: 0; font-size: 0.875rem; }
</style>
