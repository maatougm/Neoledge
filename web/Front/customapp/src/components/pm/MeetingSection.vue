<template>
  <div class="meeting-section">
    <!-- Header -->
    <div class="section-header">
      <button v-if="view !== 'list'" class="back-link" @click="goToList">
        <i class="pi pi-arrow-left" /> Retour
      </button>
      <h3 v-if="view === 'list'" class="section-title">Reunions</h3>
      <div v-if="view === 'list'" class="header-actions">
        <NeoButton
          label="Nouvelle reunion"
          icon="pi pi-microphone"
          size="small"
          @click="view = 'record'"
        />
        <NeoButton
          label="Importer un fichier"
          icon="pi pi-upload"
          size="small"
          outlined
          @click="triggerFileUpload"
        />
        <input
          ref="fileInput"
          type="file"
          accept="audio/*,.mp3,.wav,.webm,.ogg,.m4a,.mp4,.flac"
          style="display:none"
          @change="onFileSelected"
        />
      </div>
    </div>

    <!-- Record view -->
    <MeetingRecorder
      v-if="view === 'record'"
      :project-id="projectId"
      @transcribed="onTranscribed"
    />

    <!-- File upload view -->
    <div v-else-if="view === 'upload'" class="upload-form">
      <p class="upload-filename">
        <i class="pi pi-file-audio" /> {{ uploadFile?.name }}
      </p>
      <NeoInputText
        v-model="uploadTitle"
        label="Titre de la réunion"
        placeholder="Ex : Réunion de lancement projet…"
      />
      <NeoMessage v-if="uploadError" severity="error" :text="uploadError" />
      <div class="preview-actions">
        <NeoButton
          label="Transcrire"
          icon="pi pi-microphone"
          :loading="uploading"
          @click="submitFileUpload"
        />
        <NeoButton label="Annuler" outlined :disabled="uploading" @click="goToList" />
      </div>
    </div>

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
import { NeoButton, NeoTag, NeoInputText, NeoMessage } from '@neolibrary/components'
import { useNeoToast } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import MeetingRecorder from '@/components/pm/MeetingRecorder.vue'
import TranscriptViewer from '@/components/pm/TranscriptViewer.vue'

const props = defineProps<{ projectId: string }>()

const store = usePmStore()
const toast = useNeoToast()

type ViewState = 'list' | 'record' | 'detail' | 'upload'
const view = ref<ViewState>('list')

// File upload state
const fileInput = ref<HTMLInputElement | null>(null)
const uploadFile = ref<File | null>(null)
const uploadTitle = ref('')
const uploadError = ref('')
const uploading = ref(false)

onMounted(() => {
  store.fetchMeetings(props.projectId)
})

function goToList() {
  view.value = 'list'
  uploadFile.value = null
  uploadTitle.value = ''
  uploadError.value = ''
}

function triggerFileUpload() {
  fileInput.value?.click()
}

function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0] ?? null
  if (file) {
    uploadFile.value = file
    uploadTitle.value = file.name.replace(/\.[^.]+$/, '')
    view.value = 'upload'
  }
  // Reset input so same file can be re-selected
  if (fileInput.value) fileInput.value.value = ''
}

async function submitFileUpload() {
  if (!uploadFile.value) return
  if (!uploadTitle.value.trim()) {
    uploadError.value = 'Veuillez entrer un titre.'
    return
  }
  uploading.value = true
  uploadError.value = ''
  const formData = new FormData()
  formData.append('audio', uploadFile.value, uploadFile.value.name)
  formData.append('title', uploadTitle.value.trim())
  const ok = await store.uploadMeeting(props.projectId, formData)
  uploading.value = false
  if (ok) {
    toast.add({ severity: 'success', detail: 'Réunion transcrite avec succès.', life: 3000 })
    await store.fetchMeetings(props.projectId)
    goToList()
  } else {
    uploadError.value = store.error ?? "Erreur lors de la transcription."
  }
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
  flex-wrap: wrap;
  gap: 0.5rem;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.upload-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
}

.upload-filename {
  font-size: 0.875rem;
  color: var(--nl-text-2);
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
}

.preview-actions {
  display: flex;
  gap: 0.75rem;
}

.title-hint {
  margin-top: -0.5rem;
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
