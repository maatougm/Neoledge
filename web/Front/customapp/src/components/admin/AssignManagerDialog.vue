<!--
  @file     AssignManagerDialog.vue
  @module   NeoLeadge — Deployment Manager
  @author   [dev]
  @date     2026-03-26
  @desc     Modal dialog for assigning or replacing a project manager on a project
-->
<template>
  <div v-if="visible" class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-panel">
      <div class="dialog-header">
        <h3 class="dialog-title">Assigner un chef de projet</h3>
        <button class="dialog-close" @click="emit('close')">
          <i class="pi pi-times" />
        </button>
      </div>

      <div class="dialog-body">
        <p class="dialog-hint">
          Sélectionnez le chef de projet à assigner au projet
          <strong>{{ projectName }}</strong>.
        </p>

        <NeoSelect
          v-model="selectedManagerId"
          label="Chef de projet"
          :options="pmOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Choisir un chef de projet…"
          :error="selectionError"
          required
        />
      </div>

      <div class="dialog-footer">
        <NeoButton label="Annuler" severity="secondary" @click="emit('close')" />
        <NeoButton
          label="Assigner"
          icon="pi pi-check"
          :loading="loading"
          @click="handleAssign"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NeoSelect, NeoButton } from '@neolibrary/components'
import { useUserStore } from '@/stores/userStore'
import { useProjectStore } from '@/stores/projectStore'
import { useNeoToast } from '@neolibrary/components'

const props = defineProps<{
  visible: boolean
  projectId: string
  projectName: string
}>()

const emit = defineEmits<{
  close: []
  assigned: []
}>()

const userStore = useUserStore()
const projectStore = useProjectStore()
const toast = useNeoToast()

const selectedManagerId = ref<string | null>(null)
const selectionError = ref('')
const loading = ref(false)

const pmOptions = computed(() =>
  userStore.projectManagers.map((u) => ({
    value: u.id,
    label: `${u.firstName} ${u.lastName} — ${u.email}`,
  })),
)

watch(
  () => props.visible,
  (open) => {
    if (open) {
      selectedManagerId.value = null
      selectionError.value = ''
      if (userStore.projectManagers.length === 0) userStore.fetchAll()
    }
  },
)

const handleAssign = async () => {
  if (!selectedManagerId.value) {
    selectionError.value = 'Veuillez sélectionner un chef de projet.'
    return
  }
  selectionError.value = ''
  loading.value = true
  try {
    await projectStore.assignManager(props.projectId, {
      projectManagerId: selectedManagerId.value,
    })
    if (!projectStore.error) {
      toast.add({ severity: 'success', detail: 'Chef de projet assigné avec succès.', life: 3000 })
      emit('assigned')
      emit('close')
    } else {
      toast.add({ severity: 'error', detail: projectStore.error, life: 5000 })
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog-panel {
  background: var(--nl-surface);
  border-radius: var(--nl-radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  width: 100%;
  max-width: 420px;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--nl-surface-2);
}

.dialog-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
}

.dialog-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--nl-text-3);
  font-size: 1rem;
  padding: 0.25rem;
  border-radius: 4px;
}
.dialog-close:hover { color: var(--nl-text-1); background: var(--nl-surface-2); }

.dialog-body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.dialog-hint {
  font-size: 0.875rem;
  color: var(--nl-text-3);
  margin: 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--nl-surface-2);
  background: var(--nl-surface-2);
}
</style>
