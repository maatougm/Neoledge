<!-- @file src/components/pm/LiveMeetingPanel.vue
     Sprint 9 — Live AI-assisted meeting with personalized checklist.
     Modes:
       - "onsite"  → microphone via browser SpeechRecognition (free, no audio upload)
       - "online"  → tab audio via getDisplayMedia + chunked Whisper transcription -->
<template>
  <div class="lm">
    <!-- Mode picker (shown until a mode is chosen) -->
    <div v-if="!mode" class="lm__picker">
      <h2 class="lm__title">Réunion en direct</h2>
      <p class="lm__subtitle">
        L'IA écoute la conversation et tient une checklist personnalisée des informations à
        collecter pour ce projet. Quand tout est coché, elle peut produire un cahier des charges et un
        backlog parfaits.
      </p>
      <div class="lm__modes">
        <button class="lm__mode-card" :disabled="!speechSupported" @click="chooseMode('onsite')">
          <i class="pi pi-microphone lm__mode-icon" />
          <h3>Sur site</h3>
          <p>Réunion en présentiel. L'IA écoute le micro de cet appareil.</p>
          <p v-if="!speechSupported" class="lm__mode-warn">
            Non supporté sur {{ navigatorHint }} — utilisez Chrome ou Edge.
          </p>
        </button>
        <button class="lm__mode-card" @click="chooseMode('online')">
          <i class="pi pi-desktop lm__mode-icon" />
          <h3>En ligne</h3>
          <p>
            Réunion Zoom / Meet / Teams dans un autre onglet. Vous partagez ce tab avec son audio,
            l'IA écoute les deux côtés.
          </p>
        </button>
      </div>
    </div>

    <!-- Active session -->
    <div v-else>
      <header class="lm__header">
        <div>
          <h2 class="lm__title">Réunion {{ mode === 'onsite' ? 'sur site' : 'en ligne' }}</h2>
          <p class="lm__subtitle">
            <span v-if="recording" class="lm__rec-badge"><span class="lm__rec-dot" /> Enregistrement</span>
            <span class="lm__duration">{{ formattedDuration }}</span>
          </p>
        </div>
        <div class="lm__actions">
          <NeoButton
            label="Changer de mode"
            severity="secondary"
            text
            size="small"
            :disabled="recording"
            @click="resetMode"
          />
          <NeoButton
            v-if="!recording"
            :label="mode === 'onsite' ? 'Démarrer (micro)' : 'Démarrer (partager onglet)'"
            :icon="mode === 'onsite' ? 'pi pi-microphone' : 'pi pi-desktop'"
            @click="startRecording"
          />
          <NeoButton
            v-else
            label="Terminer & enregistrer"
            icon="pi pi-stop-circle"
            severity="danger"
            @click="stopAndSave"
          />
        </div>
      </header>

      <div class="lm__grid">
        <!-- LEFT: Live transcript -->
        <section class="lm__panel">
          <h3 class="lm__panel-title">
            <i class="pi pi-list" /> Transcript
            <span v-if="chunkPending" class="lm__chip">transcription…</span>
          </h3>
          <div class="lm__transcript">
            <p v-if="!transcript && !interim" class="lm__muted">
              {{ recording
                ? mode === 'onsite' ? 'Parlez — la transcription apparaît ici en temps réel.' : 'En attente de l\'audio du tab partagé…'
                : 'Cliquez sur Démarrer pour commencer.'
              }}
            </p>
            <p v-if="transcript" class="lm__transcript-text">{{ transcript }}</p>
            <p v-if="interim" class="lm__interim">{{ interim }}</p>
          </div>
        </section>

        <!-- RIGHT: Checklist -->
        <section class="lm__panel lm__panel--checklist">
          <h3 class="lm__panel-title">
            <i class="pi pi-check-square" /> Checklist projet
            <span class="lm__chip">{{ coveredCount }}/{{ checklist.length }}</span>
          </h3>

          <NeoMessage
            v-if="readyForCahier"
            severity="success"
            text="✓ Toutes les informations clés ont été collectées. Vous pouvez maintenant générer un cahier des charges et un backlog optimaux."
          />

          <NeoMessage
            v-if="aiHint"
            severity="info"
            :text="aiHint"
          />

          <div v-if="!checklist.length" class="lm__muted">
            <span v-if="checklistLoading"><i class="pi pi-spin pi-cog" /> Préparation de la checklist…</span>
            <span v-else>La checklist sera générée dès que la conversation aura assez de matière.</span>
          </div>

          <ul v-else class="lm__checklist">
            <li
              v-for="item in sortedChecklist"
              :key="item.id"
              class="lm__chk-item"
              :class="`lm__chk-item--${item.status}`"
            >
              <span class="lm__chk-icon">
                <i v-if="item.status === 'covered'" class="pi pi-check-circle" />
                <i v-else-if="item.status === 'partial'" class="pi pi-exclamation-circle" />
                <i v-else class="pi pi-circle" />
              </span>
              <div class="lm__chk-body">
                <div class="lm__chk-q">{{ item.question }}</div>
                <div v-if="item.evidence" class="lm__chk-evidence">« {{ item.evidence }} »</div>
                <div class="lm__chk-meta">
                  <span class="lm__chk-cat">{{ categoryLabel(item.category) }}</span>
                </div>
              </div>
            </li>
          </ul>

          <NeoButton
            v-if="recording || transcript.length > 50"
            label="Rafraîchir la checklist"
            icon="pi pi-refresh"
            severity="secondary"
            outlined
            size="small"
            :loading="checklistLoading"
            style="margin-top: 12px;"
            @click="refreshChecklist"
          />
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { NeoButton, NeoMessage, useNeoToast } from '@neolibrary/components'
import api from '@/lib/api'

type ChecklistStatus = 'covered' | 'partial' | 'missing'
type ChecklistCategory =
  | 'context' | 'users' | 'features' | 'constraints'
  | 'integrations' | 'security' | 'timeline' | 'other'

interface ChecklistItem {
  id: string
  category: ChecklistCategory
  question: string
  status: ChecklistStatus
  evidence?: string | null
}

interface ChecklistResponse {
  checklist: ChecklistItem[]
  readyForCahier: boolean
  hint?: string | null
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ (e: 'saved', transcriptId: string): void }>()

const toast = useNeoToast()

// ── Browser feature detection ─────────────────────────────────────────────────
const SR =
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
const speechSupported = !!SR
const navigatorHint = navigator.userAgent.includes('Firefox')
  ? 'Firefox'
  : navigator.userAgent.includes('Safari')
    ? 'Safari'
    : 'ce navigateur'

// ── State ─────────────────────────────────────────────────────────────────────
const mode = ref<'onsite' | 'online' | null>(null)
const recording = ref(false)
const transcript = ref('')
const interim = ref('')
const startedAt = ref<number | null>(null)
const tickIntervalId = ref<number | null>(null)
const checklistTimerId = ref<number | null>(null)
const initialChecklistTimeoutId = ref<number | null>(null)
const tick = ref(0)

const checklist = ref<ChecklistItem[]>([])
const checklistLoading = ref(false)
const readyForCahier = ref(false)
const aiHint = ref<string | null>(null)
const chunkPending = ref(false)

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: (e: SpeechRecognitionEventLike) => void
  onerror: (e: { error: string }) => void
  onend: () => void
  start: () => void
  stop: () => void
  abort: () => void
}
let recognition: SpeechRecognitionLike | null = null
let mediaRecorder: MediaRecorder | null = null
let mediaStream: MediaStream | null = null

const formattedDuration = computed<string>(() => {
  void tick.value
  if (!startedAt.value) return '0:00'
  const sec = Math.floor((Date.now() - startedAt.value) / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
})

const coveredCount = computed(() => checklist.value.filter((i) => i.status === 'covered').length)

const sortedChecklist = computed(() => {
  const order: Record<ChecklistStatus, number> = { missing: 0, partial: 1, covered: 2 }
  return [...checklist.value].sort((a, b) => order[a.status] - order[b.status])
})

const CATEGORY_LABELS: Record<ChecklistCategory, string> = {
  context: 'Contexte',
  users: 'Utilisateurs',
  features: 'Fonctionnalités',
  constraints: 'Contraintes',
  integrations: 'Intégrations',
  security: 'Sécurité',
  timeline: 'Échéances',
  other: 'Autre',
}
function categoryLabel(c: ChecklistCategory): string {
  return CATEGORY_LABELS[c] ?? c
}

function chooseMode(m: 'onsite' | 'online'): void {
  mode.value = m
}

function resetMode(): void {
  if (recording.value) return
  mode.value = null
  transcript.value = ''
  interim.value = ''
  checklist.value = []
  readyForCahier.value = false
  aiHint.value = null
}

async function startRecording(): Promise<void> {
  if (recording.value) return
  if (mode.value === 'onsite') {
    if (!speechSupported || !SR) {
      toast.add({ severity: 'error', detail: 'Reconnaissance vocale non supportée.', life: 4000 })
      return
    }
    startSpeechRecognition()
  } else if (mode.value === 'online') {
    await startTabCapture()
  }
}

function startSpeechRecognition(): void {
  const Ctor = SR as unknown as new () => SpeechRecognitionLike
  recognition = new Ctor()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = 'fr-FR'
  recognition.onresult = (event) => {
    let interimChunk = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      const text = result[0].transcript
      if (result.isFinal) transcript.value += (transcript.value ? ' ' : '') + text.trim()
      else interimChunk += text
    }
    interim.value = interimChunk
  }
  recognition.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return
    toast.add({ severity: 'error', detail: `Micro : ${e.error}`, life: 3500 })
  }
  recognition.onend = () => {
    if (recording.value) {
      try { recognition?.start() } catch { /* ignore */ }
    }
  }
  try {
    recognition.start()
  } catch (err) {
    toast.add({ severity: 'error', detail: `Démarrage micro échoué : ${(err as Error).message}`, life: 4000 })
    return
  }
  beginSession()
}

async function startTabCapture(): Promise<void> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast.add({
      severity: 'error',
      detail: 'Capture d\'onglet non supportée par ce navigateur.',
      life: 4000,
    })
    return
  }
  // Optimistic lock against double-clicks during the await on getDisplayMedia.
  // Reset on any early-return below.
  recording.value = true
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  } catch (err) {
    recording.value = false
    toast.add({
      severity: 'warn',
      detail: 'Partage annulé. Cochez bien "Partager l\'audio de l\'onglet".',
      life: 4000,
    })
    return
  }
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop())
    recording.value = false
    toast.add({
      severity: 'error',
      detail: 'Aucune piste audio dans le flux. Cochez "Partager l\'audio de l\'onglet" lors du partage.',
      life: 5000,
    })
    return
  }
  mediaStream = stream
  // Stop video tracks immediately — we only need audio
  stream.getVideoTracks().forEach((t) => t.stop())
  const audioOnly = new MediaStream(stream.getAudioTracks())

  // When the user stops sharing from the browser bar, end the session
  stream.getAudioTracks()[0].addEventListener('ended', () => {
    if (recording.value) void stopAndSave()
  })

  let mimeType = 'audio/webm;codecs=opus'
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm'
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = ''
  mediaRecorder = mimeType ? new MediaRecorder(audioOnly, { mimeType }) : new MediaRecorder(audioOnly)
  mediaRecorder.ondataavailable = async (e) => {
    if (!e.data || e.data.size < 5000) return // skip near-silent slivers
    await uploadChunk(e.data)
  }
  // 20-second chunks: balance between latency and Whisper call frequency
  mediaRecorder.start(20_000)
  beginSession()
}

async function uploadChunk(blob: Blob): Promise<void> {
  chunkPending.value = true
  try {
    // Retry up to 2 extra times when Whisper returns empty text —
    // short or quiet audio slices can silently fail on the first pass.
    const MAX_ATTEMPTS = 3
    const RETRY_DELAY_MS = 1500
    let text = ''
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const form = new FormData()
        form.append('audio', blob, `chunk-${Date.now()}.webm`)
        const { data } = await api.post<{ text: string }>(
          `/pm/projects/${props.projectId}/meetings/live/transcribe-chunk`,
          form,
        )
        text = typeof data.text === 'string' ? data.text.trim() : ''
        if (text.length > 0) break
      } catch {
        // network/server error — wait then retry unless it's the last attempt
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }
    if (text.length > 0) {
      transcript.value += (transcript.value ? ' ' : '') + text
    }
  } finally {
    chunkPending.value = false
  }
}

function beginSession(): void {
  recording.value = true
  startedAt.value = Date.now()
  tickIntervalId.value = window.setInterval(() => { tick.value += 1 }, 1000)
  // First checklist call after 25s, then every 30s
  initialChecklistTimeoutId.value = window.setTimeout(refreshChecklist, 25_000)
  checklistTimerId.value = window.setInterval(refreshChecklist, 30_000)
}

async function refreshChecklist(): Promise<void> {
  if (checklistLoading.value) return
  const text = transcript.value.trim()
  if (text.length < 30 && checklist.value.length === 0) return
  checklistLoading.value = true
  try {
    const { data } = await api.post<ChecklistResponse>(
      `/pm/projects/${props.projectId}/meetings/live/checklist`,
      { transcript: text, previousChecklist: checklist.value },
    )
    if (Array.isArray(data.checklist) && data.checklist.length > 0) {
      checklist.value = data.checklist
    }
    readyForCahier.value = !!data.readyForCahier
    aiHint.value = data.hint ?? null
  } catch {
    // Silent retry next tick
  } finally {
    checklistLoading.value = false
  }
}

async function stopAndSave(): Promise<void> {
  recording.value = false
  if (recognition) { try { recognition.stop() } catch { /* ignore */ } recognition = null }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop() } catch { /* ignore */ }
  }
  mediaRecorder = null
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop())
    mediaStream = null
  }
  if (tickIntervalId.value !== null) { window.clearInterval(tickIntervalId.value); tickIntervalId.value = null }
  if (checklistTimerId.value !== null) { window.clearInterval(checklistTimerId.value); checklistTimerId.value = null }
  if (initialChecklistTimeoutId.value !== null) { window.clearTimeout(initialChecklistTimeoutId.value); initialChecklistTimeoutId.value = null }

  // Final checklist refresh so the saved meeting carries the freshest state
  await refreshChecklist()

  const text = transcript.value.trim()
  if (text.length < 20) {
    toast.add({ severity: 'warn', detail: 'Transcription trop courte pour être enregistrée.', life: 3500 })
    return
  }
  const duration = startedAt.value ? Math.round((Date.now() - startedAt.value) / 1000) : 0
  try {
    const { data } = await api.post<{ transcriptId: string }>(
      `/pm/projects/${props.projectId}/meetings/live/save`,
      {
        title: `Réunion ${mode.value === 'online' ? 'en ligne' : 'sur site'} — ${new Date().toLocaleString('fr-FR')}`,
        transcript: text,
        durationSeconds: duration,
      },
    )
    toast.add({ severity: 'success', detail: 'Réunion enregistrée.', life: 3000 })
    emit('saved', data.transcriptId)
  } catch (err) {
    toast.add({
      severity: 'error',
      detail: `Échec de l'enregistrement : ${err instanceof Error ? err.message : 'erreur inconnue'}`,
      life: 4000,
    })
  }
}

onUnmounted(() => {
  recording.value = false
  if (recognition) { try { recognition.abort() } catch { /* ignore */ } }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop() } catch { /* ignore */ }
  }
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop())
  if (tickIntervalId.value !== null) window.clearInterval(tickIntervalId.value)
  if (checklistTimerId.value !== null) window.clearInterval(checklistTimerId.value)
  if (initialChecklistTimeoutId.value !== null) window.clearTimeout(initialChecklistTimeoutId.value)
})
</script>

<style scoped>
.lm { display: flex; flex-direction: column; gap: 16px; }

/* ── Mode picker ──────────────────────────────────────────────────────────── */
.lm__picker {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 24px;
}
.lm__title { font-size: 1.25rem; font-weight: 600; margin: 0 0 4px; }
.lm__subtitle { font-size: 0.9375rem; color: var(--nl-text-2); margin: 0 0 20px; max-width: 720px; line-height: 1.5; }

.lm__modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 740px) { .lm__modes { grid-template-columns: 1fr; } }

.lm__mode-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  background: var(--nl-surface-2, #f9fafb);
  border: 2px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 20px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.1s;
  font-family: inherit;
}
.lm__mode-card:hover:not(:disabled) { border-color: var(--nl-accent); transform: translateY(-2px); }
.lm__mode-card:disabled { opacity: 0.6; cursor: not-allowed; }
.lm__mode-card h3 { font-size: 1rem; margin: 8px 0 6px; font-weight: 600; }
.lm__mode-card p { font-size: 0.875rem; color: var(--nl-text-2); margin: 0; }
.lm__mode-icon { font-size: 1.75rem; color: var(--nl-accent); }
.lm__mode-warn { color: #b45309; font-size: 0.8125rem; margin-top: 8px !important; }

/* ── Active session ───────────────────────────────────────────────────────── */
.lm__header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
}
.lm__actions { display: flex; align-items: center; gap: 12px; }
.lm__duration { font-variant-numeric: tabular-nums; color: var(--nl-text-2); margin-left: 8px; }

.lm__rec-badge {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fee2e2; color: #991b1b;
  padding: 2px 10px; border-radius: 999px;
  font-size: 0.8125rem; font-weight: 600;
}
.lm__rec-dot {
  width: 8px; height: 8px; background: #dc2626; border-radius: 50%;
  animation: lm-pulse 1.2s infinite;
}
@keyframes lm-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.lm__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .lm__grid { grid-template-columns: 1fr; } }

.lm__panel {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 16px;
  min-height: 320px;
}
.lm__panel--checklist { background: var(--nl-surface-2, #fafafa); }
.lm__panel-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 0.9375rem; font-weight: 600; margin: 0 0 12px;
}
.lm__chip {
  font-size: 0.75rem;
  background: var(--nl-accent-light); color: var(--nl-accent);
  padding: 2px 8px; border-radius: 999px;
  margin-left: auto; font-weight: 500;
}

.lm__transcript {
  background: var(--nl-surface-2, #f9fafb);
  border-radius: var(--nl-radius);
  padding: 12px; max-height: 360px; overflow-y: auto;
  font-size: 0.875rem; line-height: 1.5;
}
.lm__transcript-text { margin: 0; white-space: pre-wrap; }
.lm__interim { margin: 8px 0 0; color: var(--nl-text-3); font-style: italic; white-space: pre-wrap; }

/* ── Checklist ────────────────────────────────────────────────────────────── */
.lm__checklist { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 8px; }
.lm__chk-item {
  display: flex; gap: 10px; padding: 10px;
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  transition: background 0.2s, border-color 0.2s;
}
.lm__chk-item--covered { background: #ecfdf5; border-color: #a7f3d0; }
.lm__chk-item--partial { background: #fffbeb; border-color: #fde68a; }
.lm__chk-item--missing { background: var(--nl-surface); border-color: var(--nl-border); }

.lm__chk-icon { flex-shrink: 0; font-size: 1.125rem; padding-top: 1px; }
.lm__chk-item--covered .lm__chk-icon { color: #059669; }
.lm__chk-item--partial .lm__chk-icon { color: #d97706; }
.lm__chk-item--missing .lm__chk-icon { color: var(--nl-text-3); }

.lm__chk-body { flex: 1; min-width: 0; }
.lm__chk-q { font-size: 0.875rem; font-weight: 500; }
.lm__chk-evidence {
  margin-top: 4px; padding: 6px 8px;
  background: rgba(255, 255, 255, 0.7);
  border-left: 2px solid #059669;
  font-size: 0.8125rem; color: var(--nl-text-2);
  font-style: italic;
}
.lm__chk-meta { margin-top: 4px; font-size: 0.75rem; color: var(--nl-text-3); }
.lm__chk-cat {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 6px; border-radius: 4px;
}

.lm__muted { color: var(--nl-text-3); font-size: 0.875rem; padding: 8px 0; }
</style>
