<!-- @file src/components/pm/AiBacklogPreviewModal.vue
     Sprint 5 — IA Backlog Generation. Preview + per-row select before persist. -->
<template>
  <AppModal v-model:visible="visible" header="Backlog généré par l'IA" width="760px">
    <div v-if="loading" class="ai-bk__loading">
      <i class="pi pi-spin pi-cog" /> Génération en cours…
    </div>

    <NeoMessage
      v-else-if="!loading && proposed.epics.length === 0"
      severity="warn"
      text="Contexte insuffisant. Remplissez le questionnaire et générez d'abord le cahier des charges."
    />

    <div v-else class="ai-bk__list">
      <div v-for="(epic, ei) in proposed.epics" :key="ei" class="ai-bk__epic">
        <label class="ai-bk__row">
          <input v-model="epic._checked" type="checkbox" />
          <span class="ai-bk__title">{{ epic.title }}</span>
          <span class="ai-bk__meta">
            <NeoTag :value="epic.priority" severity="info" />
            <span class="ai-bk__hours">{{ epic.estimatedHours }}h</span>
          </span>
        </label>
        <p v-if="epic.description" class="ai-bk__desc">{{ epic.description }}</p>

        <div class="ai-bk__children">
          <label
            v-for="(task, ti) in epic.children"
            :key="ti"
            class="ai-bk__row ai-bk__row--child"
            :class="{ 'ai-bk__row--disabled': !epic._checked }"
          >
            <input v-model="task._checked" type="checkbox" :disabled="!epic._checked" />
            <span class="ai-bk__title">{{ task.title }}</span>
            <span class="ai-bk__meta">
              <NeoTag :value="task.type" severity="secondary" />
              <NeoTag :value="task.priority" severity="info" />
              <span class="ai-bk__hours">{{ task.estimatedHours }}h</span>
            </span>
          </label>
        </div>
      </div>
    </div>

    <template #footer>
      <NeoButton label="Annuler" severity="secondary" outlined @click="close" />
      <NeoButton
        :label="acceptLabel"
        icon="pi pi-check"
        :loading="accepting"
        :disabled="loading || accepting || selectedCount === 0"
        @click="accept"
      />
    </template>
  </AppModal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NeoButton, NeoTag, NeoMessage, useNeoToast } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import api from '@/lib/api'

interface ProposedTask {
  title: string
  description: string
  type: 'Task' | 'Bug' | 'Feature'
  priority: 'Low' | 'Normal' | 'High' | 'Critical'
  estimatedHours: number
  _checked?: boolean
}

interface ProposedEpic {
  title: string
  description: string
  priority: 'Low' | 'Normal' | 'High' | 'Critical'
  estimatedHours: number
  children: ProposedTask[]
  _checked?: boolean
}

interface ProposedBacklog {
  epics: ProposedEpic[]
}

const props = defineProps<{ visible: boolean; projectId: string }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'accepted', count: number): void
}>()

const toast = useNeoToast()
const loading = ref(false)
const accepting = ref(false)
const proposed = ref<ProposedBacklog>({ epics: [] })

const visible = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v),
})

const selectedCount = computed(() => {
  let n = 0
  for (const e of proposed.value.epics) {
    if (!e._checked) continue
    n += 1
    for (const c of e.children) if (c._checked) n += 1
  }
  return n
})

const acceptLabel = computed(() => `Créer les tâches sélectionnées (${selectedCount.value})`)

async function load(): Promise<void> {
  loading.value = true
  proposed.value = { epics: [] }
  try {
    const { data } = await api.post<ProposedBacklog>(
      `/pm/projects/${props.projectId}/ai/generate-backlog`,
    )
    proposed.value = {
      epics: (data.epics ?? []).map((e) => ({
        ...e,
        _checked: true,
        children: (e.children ?? []).map((c) => ({ ...c, _checked: true })),
      })),
    }
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : 'Erreur inconnue'
    toast.add({ severity: 'error', detail: `Échec génération IA : ${detail}`, life: 4000 })
    close()
  } finally {
    loading.value = false
  }
}

async function accept(): Promise<void> {
  if (selectedCount.value === 0) return
  accepting.value = true
  try {
    const payload: ProposedBacklog = {
      epics: proposed.value.epics
        .filter((e) => e._checked)
        .map((e) => ({
          title: e.title,
          description: e.description,
          priority: e.priority,
          estimatedHours: e.estimatedHours,
          children: e.children
            .filter((c) => c._checked)
            .map((c) => ({
              title: c.title,
              description: c.description,
              type: c.type,
              priority: c.priority,
              estimatedHours: c.estimatedHours,
            })),
        })),
    }
    const { data } = await api.post<{ created: number }>(
      `/pm/projects/${props.projectId}/ai/accept-backlog`,
      payload,
    )
    toast.add({
      severity: 'success',
      detail: `${data.created} tâche(s) créée(s)`,
      life: 3000,
    })
    emit('accepted', data.created)
    close()
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : 'Erreur inconnue'
    toast.add({ severity: 'error', detail: `Échec création : ${detail}`, life: 4000 })
  } finally {
    accepting.value = false
  }
}

function close(): void {
  emit('update:visible', false)
}

watch(
  () => props.visible,
  (v) => {
    if (v) void load()
  },
)
</script>

<style scoped>
.ai-bk__loading {
  padding: 24px;
  text-align: center;
  color: var(--nl-text-2);
}
.ai-bk__loading .pi { margin-right: 8px; }

.ai-bk__list {
  max-height: 60vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ai-bk__epic {
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 12px;
  background: var(--nl-surface);
}

.ai-bk__row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 0;
}
.ai-bk__row--child { padding-left: 24px; }
.ai-bk__row--disabled { opacity: 0.5; cursor: not-allowed; }

.ai-bk__title { flex: 1; font-weight: 500; }
.ai-bk__meta { display: flex; align-items: center; gap: 6px; }
.ai-bk__hours { font-size: 0.8125rem; color: var(--nl-text-3); min-width: 32px; text-align: right; }
.ai-bk__desc { margin: 4px 0 8px 24px; font-size: 0.8125rem; color: var(--nl-text-2); }

.ai-bk__children {
  margin-top: 8px;
  border-top: 1px dashed var(--nl-border);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
