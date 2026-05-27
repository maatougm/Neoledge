<template>
  <div class="meeting-section">
    <!-- Header -->
    <div class="section-header">
      <button v-if="view !== 'list'" class="back-link" @click="goToList">
        <i class="pi pi-arrow-left" /> Retour
      </button>
      <h3 v-if="view === 'list'" class="section-title">Réunions</h3>
      <div v-if="view === 'list' && !readonly" class="header-actions">
        <NeoButton
          label="Réunion en direct"
          icon="pi pi-bolt"
          size="small"
          @click="view = 'live'"
        />
      </div>
    </div>

    <!-- Live meeting (AI checklist + tab capture or mic) -->
    <LiveMeetingPanel
      v-if="view === 'live'"
      :project-id="projectId"
      @saved="onLiveSaved"
    />

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
        <p>Aucune réunion enregistrée.</p>
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
                v-if="!readonly"
                icon="pi pi-trash"
                size="small"
                severity="danger"
                outlined
                aria-label="Supprimer la réunion"
                @click="confirmRemoveMeeting(meeting)"
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
import { NeoButton, NeoTag } from '@neolibrary/components'
import { useNeoToast, useNeoConfirm } from '@neolibrary/components'
import { usePmStore } from '@/stores/pmStore'
import TranscriptViewer from '@/components/pm/TranscriptViewer.vue'
import MeetingExtrasTabs from '@/components/meetings/MeetingExtrasTabs.vue'
import LiveMeetingPanel from '@/components/pm/LiveMeetingPanel.vue'

const props = withDefaults(
  defineProps<{ projectId: string; readonly?: boolean }>(),
  { readonly: false },
)

const store = usePmStore()
const toast = useNeoToast()
const confirm = useNeoConfirm()

type ViewState = 'list' | 'detail' | 'live'
const view = ref<ViewState>('list')

onMounted(() => {
  store.fetchMeetings(props.projectId)
})

function goToList() {
  view.value = 'list'
}

async function onLiveSaved(_transcriptId: string) {
  await store.fetchMeetings(props.projectId)
  view.value = 'list'
}

async function openMeeting(meetingId: string) {
  await store.fetchTranscript(props.projectId, meetingId)
  if (store.currentTranscript) {
    view.value = 'detail'
  }
}

function confirmRemoveMeeting(meeting: { id: string; title?: string }): void {
  confirm.require({
    message: `Supprimer la réunion « ${meeting.title ?? 'sans titre'} » ? Cette action est définitive.`,
    header: 'Confirmer la suppression',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    acceptClass: 'p-button-danger',
    accept: () => { void removeMeeting(meeting.id) },
  })
}

async function removeMeeting(meetingId: string) {
  const ok = await store.deleteMeeting(props.projectId, meetingId)
  if (ok) {
    toast.add({ severity: 'success', detail: 'Réunion supprimée.', life: 3000 })
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

.meeting-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(240, 200, 0, 0.12);
  flex-shrink: 0;
}

.meeting-icon {
  color: var(--nl-accent);
  font-size: 1rem;
}

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

.ai-badge--processing { background: var(--nl-warning-light); color: #D97706; }
.ai-badge--completed  { background: var(--nl-success-light); color: #16A34A; }
.ai-badge--failed     { background: var(--nl-danger-light); color: #DC2626; }

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
