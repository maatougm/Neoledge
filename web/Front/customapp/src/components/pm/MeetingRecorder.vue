<template>
  <div class="recorder">
    <!-- Recording controls -->
    <div v-if="!recordedBlob" class="recorder-controls">
      <div class="auto-detect-badge">
        <i class="pi pi-sparkles" />
        <span>Détection automatique des intervenants (Tunisien, Français, Anglais)</span>
      </div>

      <div class="timer-area">
        <span v-if="isRecording" class="pulse-dot" />
        <span class="timer">{{ formattedTime }}</span>
      </div>

      <div class="action-row">
        <NeoButton
          v-if="!isRecording"
          label="Enregistrer"
          icon="pi pi-circle-fill"
          @click="startRecording"
        />
        <NeoButton
          v-else
          label="Arrêter"
          icon="pi pi-stop-circle"
          severity="danger"
          @click="stopRecording"
        />
      </div>

      <NeoMessage v-if="recorderError" severity="error" :text="recorderError" />
    </div>

    <!-- Preview after recording -->
    <div v-else class="recorder-preview">
      <audio :src="audioUrl" controls class="audio-player" />

      <NeoInputText
        v-model="meetingTitle"
        label="Titre"
        placeholder="Titre de la réunion…"
        class="title-input"
      />

      <div class="preview-actions">
        <NeoButton
          label="Transcrire"
          icon="pi pi-microphone"
          :loading="uploading"
          :disabled="!meetingTitle.trim()"
          @click="submitRecording"
        />
        <NeoButton
          label="Annuler"
          outlined
          :disabled="uploading"
          @click="discardRecording"
        />
      </div>

      <NeoMessage v-if="uploadError" severity="error" :text="uploadError" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { NeoButton, NeoInputText, NeoMessage } from '@neolibrary/components'
import { useNeoToast } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import type { SpeakerRange } from '@/types/pm.types'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ transcribed: [] }>()

const store = usePmStore()
const toast = useNeoToast()

const isRecording = ref(false)
const elapsedSeconds = ref(0)
const currentSpeaker = ref<string>('PM')
const speakerRanges = ref<SpeakerRange[]>([])
const recordedBlob = ref<Blob | null>(null)
const audioUrl = ref('')
const meetingTitle = ref('')
const recorderError = ref('')
const uploadError = ref('')
const uploading = ref(false)

let mediaRecorder: MediaRecorder | null = null
let chunks: Blob[] = []
let timerInterval: ReturnType<typeof setInterval> | null = null
let speakerStart = 0

const formattedTime = computed(() => {
  const mins = Math.floor(elapsedSeconds.value / 60)
  const secs = elapsedSeconds.value % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
})

async function startRecording() {
  recorderError.value = ''
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunks = []

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks = [...chunks, e.data]
      }
    }

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
      recordedBlob.value = blob
      audioUrl.value = URL.createObjectURL(blob)
      stream.getTracks().forEach((t) => t.stop())
    }

    mediaRecorder.start(1000)
    isRecording.value = true
    elapsedSeconds.value = 0
    speakerRanges.value = []
    currentSpeaker.value = 'PM'
    speakerStart = 0

    timerInterval = setInterval(() => {
      elapsedSeconds.value = elapsedSeconds.value + 1
    }, 1000)
  } catch {
    recorderError.value = "Impossible d'accéder au microphone. Vérifiez les permissions."
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return

  // close the last speaker range
  const finalRanges: SpeakerRange[] = [
    ...speakerRanges.value,
    { start: speakerStart, end: elapsedSeconds.value, speaker: currentSpeaker.value },
  ]
  speakerRanges.value = finalRanges

  mediaRecorder.stop()
  isRecording.value = false
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

function switchSpeaker(speaker: string) {
  if (currentSpeaker.value === speaker) return
  const elapsed = elapsedSeconds.value
  speakerRanges.value = [
    ...speakerRanges.value,
    { start: speakerStart, end: elapsed, speaker: currentSpeaker.value },
  ]
  speakerStart = elapsed
  currentSpeaker.value = speaker
}

async function submitRecording() {
  if (!recordedBlob.value) return
  uploading.value = true
  uploadError.value = ''

  const formData = new FormData()
  formData.append('audio', recordedBlob.value, 'recording.webm')
  formData.append('title', meetingTitle.value.trim())
  formData.append('speakerMap', JSON.stringify(speakerRanges.value))

  const ok = await store.uploadMeeting(props.projectId, formData)
  uploading.value = false

  if (ok) {
    toast.add({ severity: 'success', detail: 'Réunion transcrite avec succès.', life: 3000 })
    discardRecording()
    emit('transcribed')
  } else {
    uploadError.value = store.error ?? "Erreur lors de l'envoi."
  }
}

function discardRecording() {
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  recordedBlob.value = null
  audioUrl.value = ''
  meetingTitle.value = ''
  uploadError.value = ''
}

onBeforeUnmount(() => {
  if (timerInterval) clearInterval(timerInterval)
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
})
</script>

<style scoped>
.recorder {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.5rem;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius-lg);
}

.recorder-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.auto-detect-badge {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  background: var(--nl-accent-light);
  border: 1px solid var(--nl-accent);
  border-radius: var(--nl-radius);
  color: var(--nl-accent);
  font-size: 0.8125rem;
  font-weight: 500;
}

.auto-detect-badge .pi { font-size: 1rem; }

.timer-area {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.pulse-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--nl-danger);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}

.timer {
  font-family: 'Courier New', monospace;
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--nl-text-1);
  letter-spacing: 0.05em;
}

.action-row {
  display: flex;
  gap: 0.75rem;
}

.recorder-preview {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.audio-player {
  width: 100%;
  border-radius: var(--nl-radius);
}

.title-input {
  width: 100%;
}

.preview-actions {
  display: flex;
  gap: 0.75rem;
}
</style>
