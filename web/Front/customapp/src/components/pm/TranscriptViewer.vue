<template>
  <div class="transcript-viewer">
    <!-- Header -->
    <div class="viewer-header">
      <div class="viewer-meta">
        <h3 class="viewer-title">{{ transcript.title }}</h3>
        <div class="viewer-info">
          <span class="viewer-date">{{ formatDate(transcript.recordedAt) }}</span>
          <span class="viewer-sep">·</span>
          <span class="viewer-duration">{{ formatDuration(transcript.durationSeconds) }}</span>
          <span class="viewer-sep">·</span>
          <span>{{ uniqueSpeakers.length }} intervenant(s)</span>
        </div>
        <div class="viewer-langs">
          <NeoTag
            v-for="lang in languageList"
            :key="lang"
            :value="languageLabel(lang)"
            severity="info"
          />
        </div>
      </div>

      <div class="header-actions">
        <button class="toggle-btn" @click="showRenamePanel = !showRenamePanel">
          <i class="pi pi-user-edit" />
          Renommer
        </button>
        <button class="toggle-btn" @click="showFullText = !showFullText">
          <i :class="['pi', showFullText ? 'pi-list' : 'pi-align-left']" />
          {{ showFullText ? 'Vue segments' : 'Texte complet' }}
        </button>
      </div>
    </div>

    <!-- Speaker rename panel -->
    <div v-if="showRenamePanel" class="rename-panel">
      <p class="rename-hint">Renommez les intervenants détectés par l'IA :</p>
      <div class="rename-grid">
        <div v-for="speaker in uniqueSpeakers" :key="speaker" class="rename-row">
          <span :class="['speaker-dot', speakerDotClass(speaker)]" />
          <span class="rename-original">{{ speaker }}</span>
          <i class="pi pi-arrow-right rename-arrow" />
          <NeoInputText
            :modelValue="speakerNames[speaker] ?? ''"
            @update:modelValue="(v: string) => speakerNames[speaker] = v"
            :placeholder="speaker === 'Speaker 1' ? 'Chef de projet' : speaker === 'Speaker 2' ? 'Client' : speaker"
            class="rename-input"
          />
        </div>
      </div>
      <div class="rename-actions">
        <NeoButton
          label="Appliquer"
          icon="pi pi-check"
          size="small"
          :loading="renaming"
          :disabled="!hasRenames"
          @click="applyRenames"
        />
      </div>
    </div>

    <!-- Full text view -->
    <div v-if="showFullText" class="full-text">
      <p>{{ fullText }}</p>
    </div>

    <!-- Segment list -->
    <div v-else class="segment-list">
      <div
        v-for="seg in transcript.segments"
        :key="seg.id"
        :class="['segment', segmentAlignClass(seg.speaker)]"
      >
        <div :class="['segment-bubble', segmentBubbleClass(seg.speaker)]"
             :style="{ opacity: Math.max(seg.confidence, 0.6) }">
          <div class="segment-header">
            <span :class="['speaker-dot', speakerDotClass(seg.speaker)]" />
            <span class="speaker-name">{{ speakerLabel(seg.speaker) }}</span>
            <span class="segment-time">[{{ formatTime(seg.startTime) }} - {{ formatTime(seg.endTime) }}]</span>
            <NeoTag :value="seg.language" severity="secondary" />
          </div>
          <p class="segment-text">{{ seg.text }}</p>
        </div>
      </div>

      <div v-if="transcript.segments.length === 0" class="empty-segments">
        Aucun segment disponible.
      </div>
    </div>

    <!-- AI Analysis Panel -->
    <MeetingAiPanel :project-id="projectId" :meeting-id="transcript.id" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { NeoTag, NeoButton, NeoInputText } from '@neolibrary/components'
import { useNeoToast } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import type { MeetingTranscriptDetail } from '@/types/pm.types'
import MeetingAiPanel from './MeetingAiPanel.vue'

const props = defineProps<{ transcript: MeetingTranscriptDetail; projectId: string }>()
const emit = defineEmits<{ renamed: [] }>()

const store = usePmStore()
const toast = useNeoToast()

const showFullText = ref(false)
const showRenamePanel = ref(false)
const renaming = ref(false)
const speakerNames = reactive<Record<string, string>>({})

const LANGUAGE_LABELS: Record<string, string> = {
  fr: 'Français',
  ar: 'العربية',
  en: 'English',
}

// Speaker colors cycle for auto-detected speakers
const SPEAKER_COLORS = ['var(--nl-accent)', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899']
const SPEAKER_BG     = ['var(--nl-accent-light)', '#eff6ff', '#f5f3ff', '#fffbeb', '#fdf2f8']

const uniqueSpeakers = computed(() => {
  const seen = new Set<string>()
  for (const seg of props.transcript.segments) {
    seen.add(seg.speaker)
  }
  return [...seen]
})

const hasRenames = computed(() =>
  Object.values(speakerNames).some((v) => v.trim().length > 0)
)

const languageList = computed(() =>
  props.transcript.detectedLanguages
    ? props.transcript.detectedLanguages.split(',').map((l) => l.trim())
    : [],
)

const fullText = computed(() =>
  props.transcript.segments.map((s) => s.text).join(' '),
)

function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function formatTime(seconds: number): string {
  return formatDuration(Math.floor(seconds))
}

function speakerIndex(speaker: string): number {
  return uniqueSpeakers.value.indexOf(speaker)
}

function speakerLabel(speaker: string): string {
  // If renamed, show the new name
  if (speakerNames[speaker]?.trim()) return speakerNames[speaker]
  // Known types
  const known: Record<string, string> = { PM: 'Chef de projet', Client: 'Client', Unknown: 'Inconnu' }
  if (known[speaker]) return known[speaker]
  // Auto-detected: "Speaker 1" → "Intervenant 1"
  const match = speaker.match(/Speaker (\d+)/)
  if (match) return `Intervenant ${match[1]}`
  return speaker
}

function segmentAlignClass(speaker: string): string {
  const idx = speakerIndex(speaker)
  if (idx === 0) return 'segment--left'
  if (idx === 1) return 'segment--right'
  return 'segment--center'
}

function segmentBubbleClass(speaker: string): string {
  const idx = speakerIndex(speaker)
  return `bubble--speaker-${idx}`
}

function speakerDotClass(speaker: string): string {
  const idx = speakerIndex(speaker)
  return `dot--speaker-${idx}`
}

async function applyRenames() {
  renaming.value = true
  const renames = Object.entries(speakerNames).filter(([, v]) => v.trim().length > 0)

  for (const [oldName, newName] of renames) {
    try {
      await store.renameSpeaker(props.projectId, props.transcript.id, oldName, newName.trim())
    } catch {
      toast.add({ severity: 'error', detail: `Erreur lors du renommage de "${oldName}".`, life: 3000 })
      renaming.value = false
      return
    }
  }

  toast.add({ severity: 'success', detail: 'Intervenants renommés avec succès.', life: 3000 })
  showRenamePanel.value = false
  renaming.value = false
  emit('renamed')
}
</script>

<style scoped>
.transcript-viewer {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.viewer-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.viewer-meta {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.viewer-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--nl-text-1);
  margin: 0;
}

.viewer-info {
  font-size: 0.8rem;
  color: var(--nl-text-3);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.viewer-sep { color: var(--nl-border-strong); }

.viewer-langs {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.25rem;
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--nl-text-3);
  cursor: pointer;
  transition: var(--nl-transition);
  white-space: nowrap;
}

.toggle-btn:hover {
  color: var(--nl-accent);
  border-color: var(--nl-accent);
}

.full-text {
  background: var(--nl-surface-2);
  border-radius: var(--nl-radius);
  padding: 1.25rem;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--nl-text-2);
  white-space: pre-wrap;
}

.segment-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.segment {
  display: flex;
}

.segment--left { justify-content: flex-start; }
.segment--right { justify-content: flex-end; }
.segment--center { justify-content: center; }

.segment-bubble {
  max-width: 75%;
  padding: 0.75rem 1rem;
  border-radius: var(--nl-radius-lg);
}

.bubble--pm {
  background: var(--nl-accent-light);
  border: 1px solid var(--nl-accent);
  border-opacity: 0.2;
}

.bubble--client {
  background: #eff6ff;
  border: 1px solid rgba(59, 130, 246, 0.2);
}

.bubble--unknown {
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
}

.segment-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.35rem;
  flex-wrap: wrap;
}

.speaker-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot--pm { background: var(--nl-accent); }
.dot--client { background: #3b82f6; }
.dot--unknown { background: var(--nl-text-3); }

.speaker-name {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--nl-text-2);
}

.segment-time {
  font-size: 0.7rem;
  color: var(--nl-text-3);
  font-family: 'Courier New', monospace;
}

.segment-text {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--nl-text-1);
  margin: 0;
}

.empty-segments {
  text-align: center;
  color: var(--nl-text-3);
  padding: 2rem;
  font-size: 0.9rem;
}

/* Header actions */
.header-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* Speaker rename panel */
.rename-panel {
  background: var(--nl-surface-2);
  border: 1px solid var(--nl-border);
  border-radius: var(--nl-radius);
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.rename-hint {
  font-size: 0.8rem;
  color: var(--nl-text-3);
  margin: 0;
}

.rename-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.rename-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.rename-original {
  font-size: 0.8rem;
  color: var(--nl-text-2);
  font-weight: 600;
  min-width: 80px;
}

.rename-arrow {
  color: var(--nl-text-3);
  font-size: 0.75rem;
}

.rename-input {
  flex: 1;
}

.rename-actions {
  display: flex;
  justify-content: flex-end;
}

/* Dynamic speaker bubble colors (index-based) */
.bubble--speaker-0 {
  background: var(--nl-accent-light);
  border: 1px solid rgba(var(--nl-accent-rgb, 20, 184, 166), 0.25);
}

.bubble--speaker-1 {
  background: #eff6ff;
  border: 1px solid rgba(59, 130, 246, 0.2);
}

.bubble--speaker-2 {
  background: #f5f3ff;
  border: 1px solid rgba(139, 92, 246, 0.2);
}

.bubble--speaker-3 {
  background: #fffbeb;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.bubble--speaker-4 {
  background: #fdf2f8;
  border: 1px solid rgba(236, 72, 153, 0.2);
}

/* Dynamic speaker dot colors (index-based) */
.dot--speaker-0 { background: var(--nl-accent); }
.dot--speaker-1 { background: #3b82f6; }
.dot--speaker-2 { background: #8b5cf6; }
.dot--speaker-3 { background: #f59e0b; }
.dot--speaker-4 { background: #ec4899; }
</style>
