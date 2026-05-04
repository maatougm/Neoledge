<!-- @file KeyboardHelpDialog.vue — Shown when user presses "?" -->
<template>
  <AppModal v-model:visible="visibleModel" header="Raccourcis clavier" width="520px">
    <table class="kb-help">
      <tbody>
        <tr><td><kbd>?</kbd></td><td>Afficher cette aide</td></tr>
        <tr><td><kbd>/</kbd> ou <kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>Recherche globale</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Fermer les dialogues</td></tr>
        <tr><td class="kb-help__sep" colspan="2">Navigation (depuis un projet)</td></tr>
        <tr><td><kbd>g</kbd> <kbd>p</kbd></td><td>Aperçu projet</td></tr>
        <tr><td><kbd>g</kbd> <kbd>g</kbd></td><td>Gantt</td></tr>
        <tr><td><kbd>g</kbd> <kbd>b</kbd></td><td>Board (Kanban)</td></tr>
        <tr><td><kbd>g</kbd> <kbd>t</kbd></td><td>Temps</td></tr>
<tr><td><kbd>g</kbd> <kbd>l</kbd></td><td>Liste des projets</td></tr>
        <tr><td class="kb-help__sep" colspan="2">Actions</td></tr>
        <tr><td><kbd>c</kbd></td><td>Nouveau Work Package (sur /workpackages)</td></tr>
      </tbody>
    </table>
  </AppModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AppModal from './AppModal.vue'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

const visibleModel = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v),
})
</script>

<style scoped>
.kb-help { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.kb-help td { padding: 0.5rem 0.75rem; vertical-align: middle; }
.kb-help td:first-child { white-space: nowrap; color: var(--nl-text-muted, #6b7280); width: 180px; }
.kb-help__sep { padding: 0.75rem 0 0.25rem !important; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--nl-text-muted, #9ca3af); }
kbd {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  background: var(--nl-surface-2, #f3f4f6);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 4px;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 0.75rem;
  color: var(--nl-text, #111827);
  min-width: 20px;
  text-align: center;
}
</style>
