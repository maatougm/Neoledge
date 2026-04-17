<!-- @file src/views/TimeTrackingView.vue — Time entries + log time dialog -->
<template>
  <ProjectModuleShell :project-id="id" title="Temps">
    <template #actions>
      <NeoButton label="Saisir du temps" icon="pi pi-clock" @click="showLog = true" />
    </template>

    <div class="tt-tabs">
      <button
        v-for="t in tabs"
        :key="t"
        class="tt-tab"
        :class="{ 'tt-tab--active': activeTab === t }"
        @click="activeTab = t"
      >{{ t }}</button>
    </div>

    <div class="tt-content">
      <!-- My entries -->
      <div v-if="activeTab === 'Mes saisies'">
        <table class="tt-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Heures</th>
              <th>Work Package</th>
              <th>Activité</th>
              <th>Commentaire</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in timeStore.myEntries" :key="e.id">
              <td>{{ formatDate(e.spentOn) }}</td>
              <td>{{ e.hours }}h</td>
              <td>{{ e.workPackage?.title ?? '—' }}</td>
              <td><NeoTag :value="e.activity" severity="secondary" /></td>
              <td>{{ e.comment ?? '' }}</td>
              <td>
                <NeoButton icon="pi pi-trash" text severity="danger" aria-label="Supprimer la saisie" @click="removeEntry(e.id)" />
              </td>
            </tr>
            <tr v-if="!timeStore.myEntries.length"><td colspan="6" class="tt-empty">Aucune saisie.</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Project summary -->
      <div v-if="activeTab === 'Résumé projet'">
        <div v-if="timeStore.summary">
          <div class="tt-card">
            <h3>Total: {{ timeStore.summary.total }}h</h3>
          </div>
          <div class="tt-grid">
            <div>
              <h4>Par utilisateur</h4>
              <table class="tt-table">
                <tbody>
                  <tr v-for="u in timeStore.summary.byUser" :key="u.userId">
                    <td>{{ u.name }}</td>
                    <td class="tt-num">{{ u.hours }}h</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <h4>Par activité</h4>
              <table class="tt-table">
                <tbody>
                  <tr v-for="a in timeStore.summary.byActivity" :key="a.activity">
                    <td>{{ a.activity }}</td>
                    <td class="tt-num">{{ a.hours }}h</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div v-else class="tt-empty">Chargement…</div>
      </div>
    </div>

  </ProjectModuleShell>

  <AppModal v-model:visible="showLog" header="Saisir du temps" width="480px">
      <div class="tt-form">
        <NeoDatePicker v-model="logForm.spentOn" dateFormat="yy-mm-dd" placeholder="Date" />
        <NeoInputText v-model="logForm.hoursText" label="Heures (ex. 2.5)" />
        <NeoSelect
          v-model="logForm.workPackageId"
          :options="wpOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Work package"
        />
        <NeoSelect
          v-model="logForm.activity"
          :options="activityOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Activité"
        />
        <NeoInputText v-model="logForm.comment" label="Commentaire (optionnel)" />
      </div>
      <template #footer>
        <NeoButton label="Annuler" severity="secondary" outlined @click="showLog = false" />
        <NeoButton label="Enregistrer" icon="pi pi-check" @click="submitLog" />
      </template>
    </AppModal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { NeoButton, NeoInputText, NeoSelect, NeoDatePicker, NeoTag, useNeoToast } from '@neolibrary/components'
import AppModal from '@/components/common/AppModal.vue'
import ProjectModuleShell from '@/components/common/ProjectModuleShell.vue'
import { formatDate } from '@/lib/formatDate'
import { useTimeStore } from '@/stores/timeStore'
import { useWorkPackageStore } from '@/stores/workPackageStore'

const props = defineProps<{ id: string }>()
const toast = useNeoToast()
const timeStore = useTimeStore()
const wpStore = useWorkPackageStore()

const tabs = ['Mes saisies', 'Résumé projet'] as const
const activeTab = ref<(typeof tabs)[number]>('Mes saisies')
const showLog = ref(false)

const logForm = reactive<{ spentOn: string | null; hoursText: string; workPackageId: string | null; activity: string; comment: string }>({
  spentOn: new Date().toISOString().slice(0, 10),
  hoursText: '1',
  workPackageId: null,
  activity: 'development',
  comment: '',
})

const activityOptions = [
  { label: 'Développement', value: 'development' },
  { label: 'Design', value: 'design' },
  { label: 'Tests', value: 'testing' },
  { label: 'Réunion', value: 'meeting' },
  { label: 'Autre', value: 'other' },
]

const wpOptions = computed(() => wpStore.items.map((w) => ({ label: w.title, value: w.id })))

async function load() {
  await wpStore.fetchAll(props.id)
  await timeStore.fetchMy({ projectId: props.id })
  await timeStore.fetchSummary(props.id)
}

async function submitLog() {
  const hours = parseFloat(logForm.hoursText)
  if (!logForm.spentOn || !hours || hours <= 0) {
    toast.add({ severity: 'warn', detail: 'Date et heures requis.', life: 3000 })
    return
  }
  try {
    await timeStore.create({
      projectId: props.id,
      workPackageId: logForm.workPackageId ?? undefined,
      hours,
      spentOn: logForm.spentOn,
      activity: logForm.activity,
      comment: logForm.comment || undefined,
    })
    await timeStore.fetchSummary(props.id)
    showLog.value = false
    logForm.hoursText = '1'
    logForm.comment = ''
    toast.add({ severity: 'success', detail: 'Saisie enregistrée.', life: 3000 })
  } catch {
    toast.add({ severity: 'error', detail: 'Échec.', life: 3000 })
  }
}

async function removeEntry(id: string) {
  await timeStore.remove(id)
  await timeStore.fetchSummary(props.id)
  toast.add({ severity: 'success', detail: 'Supprimée.', life: 3000 })
}

onMounted(load)
</script>

<style scoped>
.tt-view { display: flex; flex-direction: column; height: 100%; background: var(--nl-bg, #f5f7f9); }
.tt-tabs { display: flex; gap: 0.25rem; padding: 0 1.5rem; background: var(--nl-card-bg, #fff); border-bottom: 1px solid var(--nl-border, #e5e7eb); }
.tt-tab {
  background: transparent;
  border: none;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  color: var(--nl-text-muted, #6b7280);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.tt-tab--active { color: var(--nl-accent, #1e9e8f); border-bottom-color: var(--nl-accent, #1e9e8f); font-weight: 600; }
.tt-content { flex: 1; overflow-y: auto; padding: 1rem 1.5rem; }
.tt-table { width: 100%; border-collapse: collapse; background: var(--nl-card-bg, #fff); border-radius: 8px; overflow: hidden; }
.tt-table thead th { padding: 0.75rem 1rem; background: var(--nl-table-header-bg, #f3f4f6); text-align: left; font-size: 0.75rem; font-weight: 600; color: var(--nl-text-muted, #6b7280); text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--nl-border, #e5e7eb); }
.tt-table tbody td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--nl-border, #f3f4f6); font-size: 0.875rem; }
.tt-empty { text-align: center; color: var(--nl-text-muted, #9ca3af); padding: 2rem !important; }
.tt-num { text-align: right; font-family: monospace; }
.tt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem; }
.tt-card { background: var(--nl-card-bg, #fff); padding: 1rem 1.5rem; border-radius: 8px; border: 1px solid var(--nl-border, #e5e7eb); margin-bottom: 1rem; }
.tt-form { display: flex; flex-direction: column; gap: 0.75rem; }
</style>
