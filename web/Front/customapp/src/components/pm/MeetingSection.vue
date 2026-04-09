<template>
  <div class="meeting-section">
    <!-- Header -->
    <div class="section-header">
      <button v-if="view !== 'list'" class="back-link" @click="goToList">
        <i class="pi pi-arrow-left" /> Retour
      </button>
      <h3 v-if="view === 'list'" class="section-title">Reunions</h3>
      <NeoButton
        v-if="view === 'list'"
        label="Nouvelle reunion"
        icon="pi pi-microphone"
        size="small"
        @click="view = 'record'"
      />
    </div>

    <!-- Record view -->
    <MeetingRecorder
      v-if="view === 'record'"
      :project-id="projectId"
      @transcribed="onTranscribed"
    />

    <!-- Detail view -->
    <TranscriptViewer
      v-else-if="view === 'detail' && store.currentTranscript"
      :transcript="store.currentTranscript"
      :project-id="projectId"
    />

    <!-- List view -->
    <div v-else-if="view === 'list'">
      <div v-if="store.meetings.length === 0" class="empty-state">
        <i class="pi pi-microphone empty-icon" />
        <p>Aucune reunion enregistree.</p>
      </div>

      <div v-else class="meeting-list">
        <div
          v-for="meeting in store.meetings"
          :key="meeting.id"
          class="meeting-row"
        >
          <div class="meeting-info">
            <span class="meeting-title">{{ meeting.title }}</span>
            <span class="meeting-meta">
              {{ formatDate(meeting.recordedAt) }} ·
              {{ formatDuration(meeting.durationSeconds) }} ·
              {{ meeting.segmentCount }} segments
            </span>
            <div class="meeting-langs">
              <NeoTag
                v-for="lang in parseLangs(meeting.detectedLanguages)"
                :key="lang"
                :value="lang"
                severity="secondary"
              />
            </div>
          </div>
          <div class="meeting-actions">
            <NeoButton
              label="Voir"
              icon="pi pi-eye"
              size="small"
              outlined
              @click="openMeeting(meeting.id)"
            />
            <NeoButton
              icon="pi pi-trash"
              size="small"
              severity="danger"
              outlined
              @click="removeMeeting(meeting.id)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoButton, NeoTag } from '@neolibrary/components'
import { useNeoToast } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import MeetingRecorder from '@/components/pm/MeetingRecorder.vue'
import TranscriptViewer from '@/components/pm/TranscriptViewer.vue'

const props = defineProps<{ projectId: string }>()

const store = usePmStore()
const toast = useNeoToast()

type ViewState = 'list' | 'record' | 'detail'
const view = ref<ViewState>('list')

onMounted(() => {
  store.fetchMeetings(props.projectId)
})

function goToList() {
  view.value = 'list'
}

async function onTranscribed() {
  await store.fetchMeetings(props.projectId)
  view.value = 'list'
}

async function openMeeting(meetingId: string) {
  await store.fetchTranscript(props.projectId, meetingId)
  if (store.currentTranscript) {
    view.value = 'detail'
  }
}

async function removeMeeting(meetingId: string) {
  const ok = await store.deleteMeeting(props.projectId, meetingId)
  if (ok) {
    toast.add({ severity: 'success', detail: 'Reunion supprimee.', life: 3000 })
  } else {
    toast.add({ severity: 'error', detail: store.error ?? 'Erreur lors de la suppression.', life: 4000 })
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function parseLangs(raw: string): string[] {
  return raw ? raw.split(',').map((l) => l.trim()) : []
}
</script>

<style scoped>
.meeting-section {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
}

.back-link {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: none;
  color: var(--nl-text-3);
  font-size: 0.875rem;
  cursor: pointer;
  padding: 0.3rem 0;
  transition: color 0.15s;
}

.back-link:hover { color: var(--nl-accent); }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  color: var(--nl-text-3);
}

.empty-icon {
  font-size: 2.5rem;
  opacity: 0.4;
}

.meeting-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.meeting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  background: var(--nl-surface);
  transition: var(--nl-transition);
}

.meeting-row:hover {
  box-shadow: var(--nl-shadow);
}

.meeting-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.meeting-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--nl-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meeting-meta {
  font-size: 0.75rem;
  color: var(--nl-text-3);
}

.meeting-langs {
  display: flex;
  gap: 0.25rem;
  margin-top: 0.15rem;
}

.meeting-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}
</style>
