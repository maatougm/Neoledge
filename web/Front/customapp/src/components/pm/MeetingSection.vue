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
    <div
      v-else-if="view === 'upload'"
      class="upload-form"
      :class="{ 'upload-form--drag': isDragOver }"
      @dragover.prevent="isDragOver = true"
      @dragleave.prevent="isDragOver = false"
      @drop.prevent="onDrop"
    >
      <div class="upload-drop-hint" v-if="!uploadFile">
        <i class="pi pi-cloud-upload upload-drop-icon" />
        <span>Glissez un fichier audio ici ou cliquez pour choisir</span>
      </div>
      <p v-else class="upload-filename">
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
    <div v-else-if="view === 'detail' && store.currentTranscript">
      <TranscriptViewer
        :transcript="store.currentTranscript"
        :project-id="projectId"
      />
      <div class="meeting-extras-wrap">
        <h3 class="meeting-extras-title">Extras</h3>
        <MeetingExtrasTabs :project-id="projectId" :meeting-id="store.currentTranscript.id" />
      </div>
    </div>

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
          <!-- Left: icon -->
          <div class="meeting-icon-wrap">
            <i class="pi pi-volume-up meeting-icon" />
          </div>

          <!-- Middle: info -->
          <div class="meeting-info">
            <span class="meeting-title">{{ meeting.title }}</span>
            <span class="meeting-meta">
              {{ formatDate(meeting.recordedAt) }}
            </span>
          </div>

          <!-- Right side: badges + actions -->
          <div class="meeting-right">
            <span class="duration-badge">{{ formatDuration(meeting.durationSeconds) }}</span>
            <div class="meeting-langs">
              <NeoTag
                v-for="lang in parseLangs(meeting.detectedLanguages)"
                :key="lang"
                :value="lang"
                severity="secondary"
              />
            </div>
            <!-- AI status badge -->
            <span v-if="meeting.aiStatus === 'processing'" class="ai-badge ai-badge--processing">
              <i class="pi pi-spin pi-spinner" />
              En cours
            </span>
            <span v-else-if="meeting.aiStatus === 'completed'" class="ai-badge ai-badge--completed">
              <i class="pi pi-check-circle" />
              IA complété
            </span>
            <span v-else-if="meeting.aiStatus === 'failed'" class="ai-badge ai-badge--failed">
              <i class="pi pi-times-circle" />
              IA échouée
            </span>
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NeoButton, NeoTag, NeoInputText, NeoMessage } from '@neolibrary/components'
import { useNeoToast } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import MeetingRecorder from '@/components/pm/MeetingRecorder.vue'
import TranscriptViewer from '@/components/pm/TranscriptViewer.vue'
import MeetingExtrasTabs from '@/components/meetings/MeetingExtrasTabs.vue'

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
const isDragOver = ref(false)

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

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024 // 200 MB
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm',
  'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/flac',
  'video/mp4', 'video/webm',
])

function validateAudioFile(file: File): string | null {
  if (!ALLOWED_AUDIO_TYPES.has(file.type) && !/\.(mp3|wav|webm|ogg|m4a|mp4|flac)$/i.test(file.name)) {
    return 'Format non supporté. Utilisez MP3, WAV, WebM, OGG, M4A, MP4 ou FLAC.'
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Le fichier est trop volumineux (max 200 Mo). Taille actuelle : ${(file.size / 1024 / 1024).toFixed(1)} Mo.`
  }
  return null
}

function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0] ?? null
  if (file) {
    const err = validateAudioFile(file)
    if (err) {
      uploadError.value = err
      view.value = 'upload'
    } else {
      uploadFile.value = file
      uploadTitle.value = file.name.replace(/\.[^.]+$/, '')
      view.value = 'upload'
    }
  }
  // Reset input so same file can be re-selected
  if (fileInput.value) fileInput.value.value = ''
}

function onDrop(e: DragEvent) {
  isDragOver.value = false
  const file = e.dataTransfer?.files?.[0] ?? null
  if (file) {
    const err = validateAudioFile(file)
    if (err) {
      uploadFile.value = null
      uploadError.value = err
    } else {
      uploadFile.value = file
      uploadTitle.value = file.name.replace(/\.[^.]+$/, '')
      uploadError.value = ''
    }
  }
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
  border: 2px dashed var(--nl-border);
  border-radius: var(--nl-radius-lg);
  transition: border-color 0.2s, background 0.2s;
}

.upload-form--drag {
  border-color: var(--nl-accent);
  background: rgba(15, 98, 254, 0.04);
}

.upload-drop-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem;
  color: var(--nl-text-3);
  font-size: 0.875rem;
  text-align: center;
}

.upload-drop-icon {
  font-size: 2rem;
  color: var(--nl-accent);
  opacity: 0.7;
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
  gap: 1rem;
  min-height: 56px;
  padding: 0 1rem;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  background: var(--nl-surface);
  transition: var(--nl-transition);
}

.meeting-row:hover {
  box-shadow: var(--nl-shadow-md, var(--nl-shadow));
}

/* Left icon */
.meeting-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(15, 98, 254, 0.08);
  flex-shrink: 0;
}

.meeting-icon {
  color: var(--nl-accent);
  font-size: 1rem;
}

/* Info block */
.meeting-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
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

/* Right cluster */
.meeting-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.duration-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--nl-text-2);
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: 6px;
  padding: 2px 8px;
  white-space: nowrap;
}

.meeting-langs {
  display: flex;
  gap: 0.25rem;
}

/* AI status badges */
.ai-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

.ai-badge--processing {
  background: #FFF7ED;
  color: #D97706;
}

.ai-badge--completed {
  background: #F0FDF4;
  color: #16A34A;
}

.ai-badge--failed {
  background: #FEF2F2;
  color: #DC2626;
}

.meeting-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}
.meeting-extras-wrap {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--nl-border, #e5e7eb);
}
.meeting-extras-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 1rem;
  color: var(--nl-text, #111827);
}
</style>
