<!-- @file BacklogGeneratorView.vue — AI backlog preview & accept -->
<template>
  <ProjectModuleShell :project-id="id" title="Génération du backlog IA">
    <template #actions>
      <NeoButton
        v-if="store.proposed"
        label="Régénérer"
        icon="pi pi-refresh"
        severity="secondary"
        outlined
        :loading="store.loading"
        @click="onGenerate"
      />
      <NeoButton
        v-else
        label="Générer le backlog IA"
        icon="pi pi-sparkles"
        :loading="store.loading"
        @click="onGenerate"
      />
    </template>

    <div class="bg">
      <NeoMessage v-if="store.error" severity="error" :text="store.error" />

      <div v-if="store.loading" class="bg__loading">
        <i class="pi pi-spin pi-spinner bg__spin" />
        <p>Génération en cours, veuillez patienter (~30 s)…</p>
        <p class="bg__hint">L'IA analyse questionnaire + cahier des charges + résumés de réunions.</p>
      </div>

      <div v-else-if="!store.proposed" class="bg__empty">
        <i class="pi pi-magic bg__empty-icon" />
        <p>Cliquez sur « Générer le backlog IA » pour créer un backlog à partir du questionnaire, du cahier des charges et des réunions.</p>
      </div>

      <div v-else-if="store.proposed.epics.length === 0" class="bg__empty">
        <p>L'IA n'a proposé aucun epic. Vérifiez que le questionnaire et le cahier des charges sont remplis.</p>
      </div>

      <div v-else class="bg__list">
        <EpicCard
          v-for="(epic, ei) in store.proposed.epics"
          :key="epic._uid ?? `epic-${ei}`"
          :epic="epic"
          :epic-idx="ei"
          @update="(p) => store.updateEpic(ei, p)"
          @remove="store.removeEpic(ei)"
          @update-task="(ti, p) => store.updateTask(ei, ti, p)"
          @remove-task="(ti) => store.removeTask(ei, ti)"
          @add-task="store.addTask(ei)"
        />

        <div class="bg__footer">
          <div class="bg__totals">
            <span><strong>{{ totalEpics }}</strong> epic(s)</span>
            <span><strong>{{ totalTasks }}</strong> tâche(s)</span>
            <span><strong>{{ totalHours }} h</strong> estimées</span>
          </div>
          <NeoButton
            label="Accepter et créer les tâches"
            icon="pi pi-check"
            :loading="accepting"
            :disabled="totalTasks === 0"
            @click="onAccept"
          />
        </div>
      </div>
    </div>
  </ProjectModuleShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NeoButton, NeoMessage, useNeoToast } from '@neolibrary/components'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import EpicCard from '@/components/pm/backlog/EpicCard.vue'
import { useBacklogGeneratorStore } from '@/stores/backlogGeneratorStore'
import { extractErrorMessage } from '@/lib/api'

const props = defineProps<{ id: string }>()
const router = useRouter()
const toast = useNeoToast()
const store = useBacklogGeneratorStore()
const accepting = ref(false)

const totalEpics = computed(() => store.proposed?.epics.length ?? 0)
const totalTasks = computed(() =>
  store.proposed?.epics.reduce((acc, e) => acc + e.children.length, 0) ?? 0,
)
const totalHours = computed(() => {
  if (!store.proposed) return 0
  let h = 0
  for (const e of store.proposed.epics) {
    for (const t of e.children) h += Number(t.estimatedHours) || 0
  }
  return h
})

async function onGenerate(): Promise<void> {
  await store.generate(props.id)
  if (store.error) {
    toast.add({ severity: 'error', detail: store.error, life: 5000 })
  }
}

async function onAccept(): Promise<void> {
  accepting.value = true
  try {
    const result = await store.accept(props.id)
    toast.add({
      severity: 'success',
      detail: `${result.created} tâche(s) créée(s) avec succès.`,
      life: 4000,
    })
    store.reset()
    await router.push({ name: 'pm-assign-tasks', params: { id: props.id } })
  } catch (err: unknown) {
    const msg = extractErrorMessage(err) ?? 'Échec de la création'
    toast.add({ severity: 'error', detail: msg, life: 5000 })
  } finally {
    accepting.value = false
  }
}

onMounted(() => {
  store.reset()
})
</script>

<style scoped>
.bg { padding: 1.5rem; overflow-y: auto; }
.bg__loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 4rem 2rem;
  color: var(--nl-text-muted, #6b7280);
  text-align: center;
}
.bg__spin { font-size: 2.5rem; color: var(--nl-accent, #1e9e8f); margin-bottom: 1rem; }
.bg__hint { font-size: 0.8125rem; opacity: 0.75; margin-top: 0.5rem; }
.bg__empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 4rem 2rem;
  text-align: center;
  background: var(--nl-card-bg, #fff);
  border: 1px dashed var(--nl-border, #e5e7eb);
  border-radius: 8px;
  color: var(--nl-text-muted, #6b7280);
}
.bg__empty-icon { font-size: 3rem; color: var(--nl-accent, #1e9e8f); margin-bottom: 1rem; opacity: 0.6; }
.bg__list { padding-bottom: 2rem; }
.bg__footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 1rem 1.25rem;
  background: var(--nl-card-bg, #fff);
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 8px;
  position: sticky;
  bottom: 0;
  margin-top: 1rem;
  box-shadow: 0 -4px 12px rgba(0,0,0,0.04);
}
.bg__totals { display: flex; gap: 1.5rem; font-size: 0.875rem; color: var(--nl-text-muted, #6b7280); }
.bg__totals strong { color: var(--nl-text, #111827); }
</style>
