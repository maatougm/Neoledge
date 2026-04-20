<!-- @file MeetingExtrasTabs.vue — Agenda / Attendees / Outcomes tabs for a meeting -->
<template>
  <div class="me-tabs">
    <div class="me-tabs__nav">
      <button
        v-for="t in tabs"
        :key="t"
        class="me-tabs__tab"
        :class="{ 'me-tabs__tab--active': activeTab === t }"
        @click="activeTab = t"
      >{{ t }}</button>
    </div>

    <div class="me-tabs__content">
      <!-- Agenda -->
      <div v-if="activeTab === 'Ordre du jour'">
        <div v-for="item in store.agenda" :key="item.id" class="me-item">
          <div class="me-item__body">
            <div class="me-item__title">{{ item.title }}</div>
            <div class="me-item__meta">
              {{ item.duration ? `${item.duration} min` : '' }}
              {{ item.responsible ? ` · ${item.responsible.firstName} ${item.responsible.lastName}` : '' }}
            </div>
          </div>
          <NeoButton icon="pi pi-trash" severity="danger" text aria-label="Supprimer le point d'ordre du jour" @click="removeAgenda(item.id)" />
        </div>
        <div v-if="!store.agenda.length" class="me-empty">Aucun point à l'ordre du jour.</div>
        <div class="me-add">
          <NeoInputText v-model="newAgenda.title" placeholder="Nouveau point…" />
          <NeoInputText v-model="newAgenda.durationText" placeholder="Durée (min)" />
          <NeoButton label="Ajouter" icon="pi pi-plus" @click="addAgenda" />
        </div>
      </div>

      <!-- Attendees -->
      <div v-if="activeTab === 'Participants'">
        <div v-for="att in store.attendees" :key="att.id" class="me-item">
          <div class="me-item__body">
            <label class="me-item__check">
              <input type="checkbox" :checked="att.isPresent" @change="toggleAtt(att)" />
              <span>{{ att.user ? `${att.user.firstName} ${att.user.lastName}` : att.externalName }}</span>
            </label>
            <div class="me-item__meta">{{ att.user?.email || att.externalEmail || '' }}{{ att.role ? ` · ${att.role}` : '' }}</div>
          </div>
          <NeoButton icon="pi pi-trash" severity="danger" text aria-label="Retirer le participant" @click="removeAtt(att.id)" />
        </div>
        <div v-if="!store.attendees.length" class="me-empty">Aucun participant.</div>
        <div class="me-add">
          <NeoInputText v-model="newAtt.externalName" placeholder="Nom" />
          <NeoInputText v-model="newAtt.externalEmail" placeholder="Email" />
          <NeoButton label="Ajouter" icon="pi pi-plus" @click="addAtt" />
        </div>
      </div>

      <!-- Outcomes -->
      <div v-if="activeTab === 'Décisions'">
        <div v-for="o in store.outcomes" :key="o.id" class="me-item">
          <div class="me-item__body">
            <div class="me-item__header">
              <NeoTag :value="o.type" :severity="outcomeSeverity(o.type)" />
              <span v-if="o.workPackage" class="me-item__wp-link">→ {{ o.workPackage.title }}</span>
            </div>
            <div class="me-item__desc">{{ o.description }}</div>
            <div class="me-item__meta">
              {{ o.owner ? `Resp: ${o.owner.firstName} ${o.owner.lastName}` : '' }}
              {{ o.dueDate ? ` · Échéance: ${formatDate(o.dueDate)}` : '' }}
            </div>
          </div>
          <div class="me-item__actions">
            <NeoButton
              v-if="!o.workPackageId"
              icon="pi pi-link"
              text
              title="Convertir en Work Package"
              aria-label="Convertir cette décision en Work Package"
              @click="convert(o.id)"
            />
            <NeoButton icon="pi pi-trash" severity="danger" text aria-label="Supprimer la décision" @click="removeOutcome(o.id)" />
          </div>
        </div>
        <div v-if="!store.outcomes.length" class="me-empty">Aucune décision/action.</div>
        <div class="me-add">
          <NeoSelect v-model="newOutcome.type" :options="outcomeTypes" optionLabel="label" optionValue="value" placeholder="Type" />
          <NeoInputText v-model="newOutcome.description" placeholder="Description" />
          <NeoButton label="Ajouter" icon="pi pi-plus" @click="addOutcome" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { NeoButton, NeoInputText, NeoSelect, NeoTag, useNeoToast } from '@neolibrary/components'
import { useMeetingExtrasStore } from '@/stores/meetingExtrasStore'
import type { Attendee } from '@/stores/meetingExtrasStore'

const props = defineProps<{ projectId: string; meetingId: string }>()
const toast = useNeoToast()
const store = useMeetingExtrasStore()

const tabs = ['Ordre du jour', 'Participants', 'Décisions'] as const
const activeTab = ref<(typeof tabs)[number]>('Ordre du jour')

const newAgenda = reactive<{ title: string; durationText: string }>({ title: '', durationText: '' })
const newAtt = reactive<{ externalName: string; externalEmail: string }>({ externalName: '', externalEmail: '' })
const newOutcome = reactive<{ type: 'Decision' | 'Action' | 'Note' | 'Risk'; description: string }>({ type: 'Decision', description: '' })

const outcomeTypes = [
  { label: 'Décision', value: 'Decision' },
  { label: 'Action', value: 'Action' },
  { label: 'Note', value: 'Note' },
  { label: 'Risque', value: 'Risk' },
]

function outcomeSeverity(t: string) {
  switch (t) {
    case 'Decision': return 'info'
    case 'Action':   return 'success'
    case 'Risk':     return 'danger'
    default:         return 'secondary'
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR')
}

async function loadAll() {
  await Promise.all([
    store.fetchAgenda(props.projectId, props.meetingId),
    store.fetchAttendees(props.projectId, props.meetingId),
    store.fetchOutcomes(props.projectId, props.meetingId),
  ])
}

async function addAgenda() {
  if (!newAgenda.title.trim()) return
  const duration = newAgenda.durationText ? parseInt(newAgenda.durationText, 10) : undefined
  // Validate duration is a positive integer (#23)
  if (newAgenda.durationText.trim() !== '' && (
    !Number.isFinite(duration) || (duration as number) <= 0 || !Number.isInteger(duration)
  )) {
    toast.add({ severity: 'warn', detail: 'La durée doit être un entier positif (ex : 30).', life: 4000 })
    return
  }
  await store.addAgenda(props.projectId, props.meetingId, {
    title: newAgenda.title.trim(),
    duration: Number.isFinite(duration) && (duration as number) > 0 ? duration : null,
  })
  newAgenda.title = ''
  newAgenda.durationText = ''
  toast.add({ severity: 'success', detail: 'Ajouté.', life: 2000 })
}

async function removeAgenda(id: string) {
  await store.deleteAgenda(props.projectId, props.meetingId, id)
}

async function toggleAtt(att: Attendee) {
  await store.updateAttendee(props.projectId, props.meetingId, att.id, { isPresent: !att.isPresent })
}

async function addAtt() {
  if (!newAtt.externalName.trim()) return
  await store.addAttendee(props.projectId, props.meetingId, {
    externalName: newAtt.externalName.trim(),
    externalEmail: newAtt.externalEmail || null,
    isPresent: false,
  })
  newAtt.externalName = ''
  newAtt.externalEmail = ''
}

async function removeAtt(id: string) {
  await store.removeAttendee(props.projectId, props.meetingId, id)
}

async function addOutcome() {
  if (!newOutcome.description.trim()) return
  await store.addOutcome(props.projectId, props.meetingId, {
    type: newOutcome.type,
    description: newOutcome.description.trim(),
  })
  newOutcome.description = ''
  toast.add({ severity: 'success', detail: 'Ajouté.', life: 2000 })
}

async function removeOutcome(id: string) {
  await store.deleteOutcome(props.projectId, props.meetingId, id)
}

async function convert(id: string) {
  await store.convertToWp(props.projectId, props.meetingId, id)
  toast.add({ severity: 'success', detail: 'Converti en Work Package.', life: 3000 })
}

watch(() => props.meetingId, loadAll)
onMounted(loadAll)
</script>

<style scoped>
.me-tabs { display: flex; flex-direction: column; }
.me-tabs__nav { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--nl-border, #e5e7eb); margin-bottom: 1rem; }
.me-tabs__tab {
  background: transparent; border: none;
  padding: 0.5rem 0.875rem; font-size: 0.875rem; color: var(--nl-text-muted, #6b7280);
  cursor: pointer; border-bottom: 2px solid transparent;
}
.me-tabs__tab--active { color: var(--nl-accent, #1e9e8f); border-bottom-color: var(--nl-accent, #1e9e8f); font-weight: 600; }
.me-tabs__content { display: flex; flex-direction: column; gap: 0.5rem; }
.me-item {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  border: 1px solid var(--nl-border, #e5e7eb);
  border-radius: 6px;
  background: var(--nl-card-bg, #fff);
  align-items: center;
}
.me-item__body { flex: 1; display: flex; flex-direction: column; gap: 0.25rem; }
.me-item__title { font-weight: 500; font-size: 0.875rem; }
.me-item__header { display: flex; align-items: center; gap: 0.5rem; }
.me-item__wp-link { font-size: 0.75rem; color: var(--nl-accent, #1e9e8f); }
.me-item__desc { font-size: 0.875rem; }
.me-item__meta { font-size: 0.75rem; color: var(--nl-text-muted, #6b7280); }
.me-item__check { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-weight: 500; font-size: 0.875rem; }
.me-item__actions { display: flex; gap: 0.25rem; }
.me-empty { text-align: center; color: var(--nl-text-muted, #9ca3af); padding: 1rem; font-style: italic; font-size: 0.875rem; }
.me-add { display: flex; gap: 0.5rem; padding: 0.5rem 0; margin-top: 0.5rem; border-top: 1px solid var(--nl-border, #e5e7eb); padding-top: 0.75rem; }
.me-add > :first-child { flex: 1; }
</style>
