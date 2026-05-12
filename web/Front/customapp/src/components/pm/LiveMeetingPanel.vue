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

      <!-- Meeting type preset — drives the copilot's nudging style. -->
      <div class="lm__type-row">
        <span class="lm__type-label">Type de réunion :</span>
        <div class="lm__type-chips">
          <button
            v-for="t in MEETING_TYPES"
            :key="t.value"
            type="button"
            class="lm__type-chip"
            :class="{ 'lm__type-chip--active': meetingType === t.value }"
            :title="t.hint"
            @click="meetingType = t.value"
          >
            <i :class="`pi ${t.icon}`" />
            {{ t.label }}
          </button>
        </div>
      </div>

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
            Réunion Zoom / Meet / Teams dans un autre onglet. Vous partagez ce tab avec son audio
            et votre micro — l'IA écoute les deux côtés et votre voix.
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
            <span v-if="recording && !paused" class="lm__rec-badge"><span class="lm__rec-dot" /> Enregistrement</span>
            <span v-else-if="recording && paused" class="lm__rec-badge lm__rec-badge--paused"><i class="pi pi-pause" /> En pause</span>
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
          <!-- Onsite-only: language the browser SpeechRecognition listens for.
               Without this the live transcript was hardcoded to fr-FR; meetings
               in Arabic or English came out as garbage on the PM's screen
               (although the final saved transcript was always re-Whispered
               with multilingual auto-detect). -->
          <select
            v-if="mode === 'onsite' && !recording"
            v-model="recognitionLang"
            class="lm__lang-select"
            :title="'Langue principale parlée pendant la réunion'"
          >
            <option value="fr-FR">Français (FR)</option>
            <option value="ar-TN">العربية تونسي (Darija TN)</option>
            <option value="ar-SA">العربية فصحى (MSA)</option>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
          </select>
          <NeoButton
            v-if="!recording"
            :label="mode === 'onsite' ? 'Démarrer (micro)' : 'Démarrer (partager onglet)'"
            :icon="mode === 'onsite' ? 'pi pi-microphone' : 'pi pi-desktop'"
            @click="startRecording"
          />
          <template v-else>
            <NeoButton
              v-if="!paused"
              label="Pause"
              icon="pi pi-pause"
              severity="secondary"
              @click="pauseRecording"
            />
            <NeoButton
              v-else
              label="Reprendre"
              icon="pi pi-play"
              @click="resumeRecording"
            />
            <NeoButton
              label="Terminer & enregistrer"
              icon="pi pi-stop-circle"
              severity="danger"
              @click="stopAndSave"
            />
          </template>
        </div>
      </header>

      <CopilotCoverageBar
        v-if="copilot.enabled.value"
        :coverage-pct="coverage.cahierCoveragePct"
        :drivers-answered="coverage.driversAnswered"
        :drivers-total="coverage.driversTotal"
        style="margin-bottom: 12px;"
      />

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

        <!-- RIGHT: Unified copilot checklist + inline suggestions -->
        <CopilotChecklistPanel
          :enabled="copilot.enabled.value"
          :connected="copilot.connected.value"
          :refreshing="copilotRefreshing"
          :checklist="copilot.checklist.value"
          :hint="copilot.hint.value"
          :ready-for-cahier="copilot.readyForCahier.value"
          :last-skip-reason="copilot.lastSkipReason.value"
          :covered-count="copilot.coveredCount.value"
          :total-count="copilot.totalCount.value"
          @ask="copilot.askItem"
          @dismiss="copilot.dismissItem"
          @refresh="onForceRefresh"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { NeoButton, useNeoToast } from '@neolibrary/components'
import api from '@/lib/api'
import CopilotChecklistPanel from '@/components/pm/CopilotChecklistPanel.vue'
import CopilotCoverageBar from '@/components/pm/CopilotCoverageBar.vue'
import { useLiveCopilot, type CahierSection } from '@/composables/useLiveCopilot'
import { computeCoverage, type DriverField } from '@/lib/copilot/coverage-engine'

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
type MeetingTypeKey = 'kickoff' | 'cadrage' | 'validation' | 'standup' | 'retrospective' | 'other'
const MEETING_TYPES: ReadonlyArray<{ value: MeetingTypeKey; label: string; icon: string; hint: string }> = [
  { value: 'cadrage',       label: 'Cadrage',         icon: 'pi-pencil',        hint: 'Recueil détaillé des besoins' },
  { value: 'kickoff',       label: 'Kickoff',         icon: 'pi-flag',          hint: 'Premier rendez-vous client' },
  { value: 'validation',    label: 'Validation',      icon: 'pi-check-square',  hint: 'Revue client d\'un livrable' },
  { value: 'standup',       label: 'Standup',         icon: 'pi-users',         hint: 'Réunion interne courte' },
  { value: 'retrospective', label: 'Rétrospective',   icon: 'pi-history',       hint: 'Bilan de sprint / projet' },
  { value: 'other',         label: 'Autre',           icon: 'pi-comments',      hint: 'Sans préréglage particulier' },
]
const meetingType = ref<MeetingTypeKey>('cadrage')

const mode = ref<'onsite' | 'online' | null>(null)
const recording = ref(false)
const paused = ref(false)
const transcript = ref('')
const interim = ref('')

// Onsite-mode SpeechRecognition language — defaults to fr-FR, persisted to
// localStorage so the PM doesn't have to re-pick every meeting.
const LANG_STORAGE_KEY = 'nl_speech_recognition_lang'
const recognitionLang = ref<string>(
  (typeof localStorage !== 'undefined' && localStorage.getItem(LANG_STORAGE_KEY)) || 'fr-FR',
)
watch(recognitionLang, (v) => {
  try { localStorage.setItem(LANG_STORAGE_KEY, v) } catch { /* ignore */ }
})

// Online-mode: aggregate the set of languages Whisper detected across chunks,
// passed to /save so detectedLanguages on the saved meeting is accurate
// (was hardcoded to 'fr' before).
const detectedLanguages = ref<Set<string>>(new Set())
const startedAt = ref<number | null>(null)
/** Wall-clock when the current pause began (null when not paused). */
const pauseStartedAt = ref<number | null>(null)
/** Accumulated paused milliseconds across the session — subtracted from the
 *  duration display and from the saved meeting's durationSeconds. */
const totalPausedMs = ref(0)
const tickIntervalId = ref<number | null>(null)
const tick = ref(0)
const chunkPending = ref(false)

// ── Live copilot state (unified checklist + suggestions) ─────────────────────
const copilot = useLiveCopilot(props.projectId)
const driverFields = ref<DriverField[]>([])
const lastAppendedLength = ref(0)
const copilotRefreshing = ref(false)
let copilotFireTimerId: number | null = null
let copilotShouldFireSoon = false

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
// Online mode mixes tab audio + PM microphone via Web Audio API so the
// transcript covers both the remote speaker(s) AND the PM's own voice.
let micStream: MediaStream | null = null
let audioContext: AudioContext | null = null
// Full-meeting audio buffer — every chunk is pushed here as it's recorded so
// we can upload the merged blob at end of session for replay later.
let archiveChunks: Blob[] = []
let archiveMimeType = 'audio/webm'

const formattedDuration = computed<string>(() => {
  void tick.value
  if (!startedAt.value) return '0:00'
  const now = Date.now()
  const inProgressPause = paused.value && pauseStartedAt.value !== null
    ? now - pauseStartedAt.value
    : 0
  const sec = Math.max(0, Math.floor((now - startedAt.value - totalPausedMs.value - inProgressPause) / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
})

function chooseMode(m: 'onsite' | 'online'): void {
  mode.value = m
}

function resetMode(): void {
  if (recording.value) return
  mode.value = null
  transcript.value = ''
  interim.value = ''
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
  // Was hardcoded to fr-FR — meant Arabic / English onsite meetings produced
  // garbage live captions. Driven by the language picker now, persisted.
  recognition.lang = recognitionLang.value || 'fr-FR'
  // Record the onsite-side language too so the saved meta isn't blank when
  // the PM picks ar-TN or en-US.
  const baseLang = recognition.lang.slice(0, 2).toLowerCase()
  if (baseLang === 'ar' || baseLang === 'fr' || baseLang === 'en') {
    detectedLanguages.value.add(baseLang)
  }
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
    // Auto-restart only when actively recording AND not paused — otherwise
    // a Pause click that called recognition.stop() would immediately bounce
    // back to listening.
    if (recording.value && !paused.value) {
      try { recognition?.start() } catch { /* ignore */ }
    }
  }
  try {
    recognition.start()
  } catch (err) {
    toast.add({ severity: 'error', detail: `Démarrage micro échoué : ${(err as Error).message}`, life: 4000 })
    return
  }
  // Archive the mic audio in parallel so the meeting can be replayed later.
  // SpeechRecognition does the live transcription; this MediaRecorder only
  // collects bytes for /audio upload at end of session.
  archiveChunks = []
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      mediaStream = stream
      let mimeType = 'audio/webm;codecs=opus'
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm'
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = ''
      mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      archiveMimeType = mimeType || 'audio/webm'
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) archiveChunks.push(e.data)
      }
      mediaRecorder.start(5_000)
    })
    .catch(() => {
      // Mic permission denied or unavailable — transcript still works via
      // SpeechRecognition, only the replay feature is disabled this session.
    })
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

  // Step 1 — try to grab the PM's microphone first. If denied, we degrade
  // gracefully to tab-only audio (the meeting can still be transcribed, we
  // just won't pick up the PM's voice).
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  } catch {
    micStream = null
    toast.add({
      severity: 'warn',
      detail: 'Micro indisponible — seul l\'audio de l\'onglet sera capté.',
      life: 4000,
    })
  }

  // Step 2 — tab share (the failure mode here is fatal — without tab audio
  // there's nothing to transcribe for an online meeting).
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  } catch {
    recording.value = false
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null }
    toast.add({
      severity: 'warn',
      detail: 'Partage annulé. Cochez bien "Partager l\'audio de l\'onglet".',
      life: 4000,
    })
    return
  }
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop())
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null }
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

  // Step 3 — mix tab + mic into a single MediaStream via Web Audio API.
  // The MediaRecorder reads from the mixed output so a single chunk carries
  // both voices. When mic is unavailable we fall back to tab-only.
  let mixedStream: MediaStream
  if (micStream && micStream.getAudioTracks().length > 0) {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const destination = audioContext.createMediaStreamDestination()

    const tabSource = audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
    tabSource.connect(destination)

    // Slight mic attenuation so the PM's mic doesn't drown out the remote
    // speaker. 0.9 keeps speech audible without clipping when both speak.
    const micSource = audioContext.createMediaStreamSource(micStream)
    const micGain = audioContext.createGain()
    micGain.gain.value = 0.9
    micSource.connect(micGain).connect(destination)

    mixedStream = destination.stream
  } else {
    mixedStream = new MediaStream(stream.getAudioTracks())
  }

  // When the user stops sharing from the browser bar, end the session
  stream.getAudioTracks()[0].addEventListener('ended', () => {
    if (recording.value) void stopAndSave()
  })

  let mimeType = 'audio/webm;codecs=opus'
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm'
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = ''
  mediaRecorder = mimeType ? new MediaRecorder(mixedStream, { mimeType }) : new MediaRecorder(mixedStream)
  archiveChunks = []
  archiveMimeType = mimeType || 'audio/webm'
  mediaRecorder.ondataavailable = async (e) => {
    if (!e.data || e.data.size === 0) return
    // Always archive the chunk so we can replay the full meeting later —
    // even tiny slivers matter for continuity. Transcription still skips
    // sub-5kB chunks because Whisper can't extract anything from them.
    archiveChunks.push(e.data)
    if (e.data.size < 5000) return
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
    let language: string | null = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const form = new FormData()
        form.append('audio', blob, `chunk-${Date.now()}.webm`)
        const { data } = await api.post<{ text: string; language: string | null }>(
          `/pm/projects/${props.projectId}/meetings/live/transcribe-chunk`,
          form,
        )
        text = typeof data.text === 'string' ? data.text.trim() : ''
        language = typeof data.language === 'string' ? data.language : null
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
    // Aggregate the languages Whisper detected so the saved meeting carries
    // accurate metadata (was hardcoded to 'fr' before).
    if (language) {
      const base = language.slice(0, 2).toLowerCase()
      if (base === 'ar' || base === 'fr' || base === 'en') {
        detectedLanguages.value.add(base)
      }
    }
  } finally {
    chunkPending.value = false
  }
}

function beginSession(): void {
  recording.value = true
  paused.value = false
  pauseStartedAt.value = null
  totalPausedMs.value = 0
  startedAt.value = Date.now()
  detectedLanguages.value = new Set()
  tickIntervalId.value = window.setInterval(() => { tick.value += 1 }, 1000)

  // Live copilot — best-effort start. 404s if feature flag is off → silently skip.
  void startCopilot()
}

/** Pause the meeting without ending the copilot session. SpeechRecognition is
 *  stopped (its onend guard prevents auto-restart while paused); the
 *  MediaRecorder is paused so no audio chunks are emitted to the archive or
 *  the live transcribe-chunk endpoint. Time spent paused is excluded from the
 *  duration shown to the PM and from the saved durationSeconds. */
function pauseRecording(): void {
  if (!recording.value || paused.value) return
  paused.value = true
  pauseStartedAt.value = Date.now()
  try { recognition?.stop() } catch { /* ignore */ }
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    try { mediaRecorder.pause() } catch { /* ignore */ }
  }
  toast.add({ severity: 'info', detail: 'Réunion en pause.', life: 2000 })
}

/** Resume after a pause. Reactivates SpeechRecognition / MediaRecorder and
 *  flushes the just-elapsed pause window into totalPausedMs so the duration
 *  display catches up exactly. */
function resumeRecording(): void {
  if (!recording.value || !paused.value) return
  if (pauseStartedAt.value !== null) {
    totalPausedMs.value += Date.now() - pauseStartedAt.value
    pauseStartedAt.value = null
  }
  paused.value = false
  if (mode.value === 'onsite') {
    try { recognition?.start() } catch { /* ignore — onend handler will retry */ }
  }
  if (mediaRecorder && mediaRecorder.state === 'paused') {
    try { mediaRecorder.resume() } catch { /* ignore */ }
  }
  toast.add({ severity: 'success', detail: 'Reprise de la réunion.', life: 2000 })
}

async function startCopilot(): Promise<void> {
  // Generate a frontend session id; the backend ties suggestions to it.
  const sessionId = (window.crypto && 'randomUUID' in window.crypto)
    ? window.crypto.randomUUID()
    : `lm-${Date.now()}-${Math.random().toString(36).slice(2)}`

  const result = await copilot.startSession(sessionId, meetingType.value)
  if (!result.ok) return // feature off; fail silently

  // Pull driver-fields once for the coverage gauge.
  try {
    const { data } = await api.get<{ items: Array<{ label: string; value: string | null; isBacklogDriver: boolean }> }>(
      `/pm/projects/${props.projectId}/meetings/live/copilot/_drivers`,
    ).catch(() => ({ data: { items: [] } } as never))
    if (Array.isArray(data?.items)) {
      driverFields.value = data.items.filter((f) => f.isBacklogDriver).map((f) => ({ label: f.label, value: f.value }))
    }
  } catch { /* ignore */ }

  // Heartbeat: try to fire every 25s. Service-side cooldown still gates the
  // actual model call (10s floor between fires) but we attempt more often so
  // the checklist stays fresh during long monologues / pauses.
  copilotFireTimerId = window.setInterval(() => {
    if (copilot.enabled.value) void copilot.fire()
  }, 25_000)
}

// Watch transcript growth: append the diff to the copilot, trigger a fire
// when the service signals it's worth firing, OR when the 60s heartbeat ticks.
watch(transcript, async (next) => {
  if (!copilot.enabled.value) return
  const diff = next.slice(lastAppendedLength.value).trim()
  if (diff.length === 0) return
  lastAppendedLength.value = next.length
  const { shouldFire } = await copilot.appendChunk(diff)
  if (shouldFire && !copilotShouldFireSoon) {
    copilotShouldFireSoon = true
    setTimeout(() => {
      copilotShouldFireSoon = false
      if (copilot.enabled.value) void copilot.fire()
    }, 1_000) // 1s coalesce so several rapid appends share one fire
  }
})

// ── Coverage gauge ───────────────────────────────────────────────────────────
// Two signals fed to the coverage engine:
//   1. Frontend keyword baseline (computed inside computeCoverage from transcript).
//   2. Sections from the unified checklist where status is covered/partial,
//      plus the agent-tagged coverage broadcast (legacy fallback).
const aggregatedSections = computed<CahierSection[]>(() => {
  const set = new Set<CahierSection>()
  for (const item of copilot.checklist.value) {
    if (item.status !== 'missing') set.add(item.section)
  }
  for (const s of copilot.agentCoverage.value) set.add(s)
  return Array.from(set)
})
const coverage = computed(() =>
  computeCoverage(transcript.value, driverFields.value, aggregatedSections.value),
)

async function onForceRefresh(): Promise<void> {
  if (!copilot.enabled.value || copilotRefreshing.value) return
  copilotRefreshing.value = true
  try {
    await copilot.fire({ force: true })
  } finally {
    // Give the gateway a beat to push the resulting state before clearing.
    setTimeout(() => { copilotRefreshing.value = false }, 1500)
  }
}

async function stopAndSave(): Promise<void> {
  // If the user clicks "Terminer" while paused, flush the in-progress pause
  // into the totals so durationSeconds is accurate.
  if (paused.value && pauseStartedAt.value !== null) {
    totalPausedMs.value += Date.now() - pauseStartedAt.value
    pauseStartedAt.value = null
  }
  paused.value = false
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
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop())
    micStream = null
  }
  if (audioContext) {
    audioContext.close().catch(() => { /* already closed */ })
    audioContext = null
  }
  if (tickIntervalId.value !== null) { window.clearInterval(tickIntervalId.value); tickIntervalId.value = null }

  // One final force-fire so the saved meeting carries the freshest state.
  if (copilot.enabled.value) await copilot.fire({ force: true })

  const text = transcript.value.trim()
  if (text.length < 20) {
    toast.add({ severity: 'warn', detail: 'Transcription trop courte pour être enregistrée.', life: 3500 })
    return
  }
  const duration = startedAt.value
    ? Math.max(0, Math.round((Date.now() - startedAt.value - totalPausedMs.value) / 1000))
    : 0
  try {
    const { data } = await api.post<{ transcriptId: string }>(
      `/pm/projects/${props.projectId}/meetings/live/save`,
      {
        title: `Réunion ${mode.value === 'online' ? 'en ligne' : 'sur site'} — ${new Date().toLocaleString('fr-FR')}`,
        transcript: text,
        durationSeconds: duration,
        meetingType: meetingType.value,
        detectedLanguages: [...detectedLanguages.value],
      },
    )
    toast.add({ severity: 'success', detail: 'Réunion enregistrée.', life: 3000 })
    // End the copilot session, linking suggestions to the saved transcript.
    if (copilotFireTimerId !== null) { window.clearInterval(copilotFireTimerId); copilotFireTimerId = null }
    void copilot.endSession(data.transcriptId)
    // Best-effort: upload the merged audio so the meeting can be replayed.
    // Don't block the success toast on it — the transcript is the main artefact.
    void uploadArchivedAudio(data.transcriptId)
    emit('saved', data.transcriptId)
  } catch (err) {
    toast.add({
      severity: 'error',
      detail: `Échec de l'enregistrement : ${err instanceof Error ? err.message : 'erreur inconnue'}`,
      life: 4000,
    })
  }
}

async function uploadArchivedAudio(transcriptId: string): Promise<void> {
  if (archiveChunks.length === 0) return
  try {
    const blob = new Blob(archiveChunks, { type: archiveMimeType })
    if (blob.size < 1024) return // less than 1 kB — not worth storing
    const form = new FormData()
    form.append('audio', blob, `meeting-${transcriptId}.webm`)
    await api.post(
      `/pm/projects/${props.projectId}/meetings/${transcriptId}/audio`,
      form,
      { timeout: 300_000 },
    )
  } catch {
    // Silent — replay is a nice-to-have, transcript is already saved.
  } finally {
    archiveChunks = []
  }
}

onUnmounted(() => {
  recording.value = false
  if (recognition) { try { recognition.abort() } catch { /* ignore */ } }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop() } catch { /* ignore */ }
  }
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop())
  if (micStream) micStream.getTracks().forEach((t) => t.stop())
  if (audioContext) audioContext.close().catch(() => { /* already closed */ })
  if (tickIntervalId.value !== null) window.clearInterval(tickIntervalId.value)
  if (copilotFireTimerId !== null) window.clearInterval(copilotFireTimerId)
  // The composable's own onBeforeUnmount handles socket teardown.
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

.lm__type-row {
  display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
  margin-bottom: 1.25rem;
  padding: 0.85rem 1rem;
  background: var(--nl-surface-2, #fafafa);
  border: 1px solid var(--nl-border);
  border-radius: 8px;
}
.lm__type-label {
  font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--nl-text-3); font-weight: 600;
}
.lm__type-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; flex: 1; }
.lm__type-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--nl-border);
  border-radius: 999px;
  background: var(--nl-card-bg, #fff);
  color: var(--nl-text-2);
  font-size: 0.8125rem; font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.lm__type-chip:hover { border-color: var(--nl-accent); color: var(--nl-accent); }
.lm__type-chip--active {
  background: var(--nl-accent); color: #fff;
  border-color: var(--nl-accent);
}

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
.lm__rec-badge--paused {
  background: #fef3c7;
  color: #92400e;
}
.lm__rec-badge--paused i {
  font-size: 0.75rem;
}
.lm__rec-dot {
  width: 8px; height: 8px; background: #dc2626; border-radius: 50%;
  animation: lm-pulse 1.2s infinite;
}
@keyframes lm-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.lm__grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
@media (max-width: 1100px) { .lm__grid { grid-template-columns: 1fr; } }

.lm__panel {
  background: var(--nl-surface);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 16px;
  min-height: 320px;
}
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

.lm__muted { color: var(--nl-text-3); font-size: 0.875rem; padding: 8px 0; }
</style>
