/**
 * @file useLiveCopilot.ts — wires the live meeting copilot socket and HTTP.
 * Connects to the `/live-meeting` namespace, joins the project+session
 * room, exposes a reactive list of suggestion cards, and offers the
 * action helpers (start/append/fire/dismiss/ask/end).
 */

import { ref, computed, onBeforeUnmount } from 'vue'
import { io, type Socket } from 'socket.io-client'
import api, { extractErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'

export type SuggestionUrgency = 'low' | 'medium' | 'high'

export type CahierSection =
  | 'objectifDocument'
  | 'contexte'
  | 'objectifProjet'
  | 'perimetreInclus'
  | 'perimetreExclus'
  | 'exigencesFonctionnelles'
  | 'architectureTechnique'
  | 'livrables'
  | 'conclusion'
  | 'backlog_driver'

export interface SuggestionCard {
  id: string
  question: string
  rationale: string
  urgency: SuggestionUrgency
  section: CahierSection
  status: 'pending' | 'dismissed' | 'asked'
  createdAt: string
}

export type FireSkipReason = 'cooldown' | 'cap_reached' | 'budget' | 'min_content' | 'no_session' | 'provider'

export function useLiveCopilot(projectId: string) {
  const auth = useAuthStore()
  const config = useConfigStore()

  const cards = ref<SuggestionCard[]>([])
  const lastSkipReason = ref<FireSkipReason | null>(null)
  const connected = ref(false)
  const enabled = ref(false) // false until startSession returns 201
  const liveSessionId = ref<string | null>(null)

  let socket: Socket | null = null

  // ─── Computed: counts ──────────────────────────────────────────────────────

  const pendingCards = computed(() => cards.value.filter((c) => c.status === 'pending'))

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async function startSession(sessionId: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      await api.post(`/pm/projects/${projectId}/meetings/live/copilot/session`, {
        liveSessionId: sessionId,
      })
      liveSessionId.value = sessionId
      enabled.value = true
      _connectSocket(sessionId)
      return { ok: true }
    } catch (e: unknown) {
      // 404 → feature flag is off. Fail soft.
      const msg = extractErrorMessage(e) ?? 'unavailable'
      enabled.value = false
      return { ok: false, reason: msg }
    }
  }

  async function appendChunk(chunk: string): Promise<{ shouldFire: boolean }> {
    if (!enabled.value || !liveSessionId.value || !chunk) return { shouldFire: false }
    try {
      const { data } = await api.post<{ shouldFire: boolean }>(
        `/pm/projects/${projectId}/meetings/live/copilot/append`,
        { liveSessionId: liveSessionId.value, chunk },
      )
      return data
    } catch {
      return { shouldFire: false }
    }
  }

  async function fire(): Promise<void> {
    if (!enabled.value || !liveSessionId.value) return
    try {
      await api.post(`/pm/projects/${projectId}/meetings/live/copilot/fire`, {
        liveSessionId: liveSessionId.value,
      })
    } catch {
      // The fire endpoint never 5xx's mid-meeting (the service downgrades
      // any error to a `provider` skip reason that arrives via socket).
    }
  }

  async function dismiss(suggestionId: string): Promise<void> {
    // Optimistic update.
    const idx = cards.value.findIndex((c) => c.id === suggestionId)
    if (idx >= 0) {
      cards.value = [
        ...cards.value.slice(0, idx),
        { ...cards.value[idx], status: 'dismissed' },
        ...cards.value.slice(idx + 1),
      ]
    }
    try {
      await api.post(
        `/pm/projects/${projectId}/meetings/live/copilot/suggestions/${suggestionId}/dismiss`,
      )
    } catch {
      // Revert on failure.
      if (idx >= 0) {
        cards.value = [
          ...cards.value.slice(0, idx),
          { ...cards.value[idx], status: 'pending' },
          ...cards.value.slice(idx + 1),
        ]
      }
    }
  }

  async function markAsked(suggestionId: string): Promise<void> {
    const idx = cards.value.findIndex((c) => c.id === suggestionId)
    if (idx >= 0) {
      cards.value = [
        ...cards.value.slice(0, idx),
        { ...cards.value[idx], status: 'asked' },
        ...cards.value.slice(idx + 1),
      ]
    }
    try {
      await api.post(
        `/pm/projects/${projectId}/meetings/live/copilot/suggestions/${suggestionId}/ask`,
      )
    } catch {
      if (idx >= 0) {
        cards.value = [
          ...cards.value.slice(0, idx),
          { ...cards.value[idx], status: 'pending' },
          ...cards.value.slice(idx + 1),
        ]
      }
    }
  }

  async function endSession(meetingTranscriptId?: string | null): Promise<void> {
    if (!enabled.value || !liveSessionId.value) return
    try {
      await api.delete(`/pm/projects/${projectId}/meetings/live/copilot/session`, {
        data: { liveSessionId: liveSessionId.value, meetingTranscriptId: meetingTranscriptId ?? undefined },
      })
    } catch { /* non-fatal */ }
    _disconnectSocket()
    liveSessionId.value = null
    enabled.value = false
  }

  // ─── Socket plumbing ───────────────────────────────────────────────────────

  function _connectSocket(sessionId: string): void {
    if (!auth.jwt || !config.apiUrl) return
    if (socket?.connected) return

    const base = config.apiUrl.replace(/\/$/, '')
    socket = io(`${base}/live-meeting`, {
      auth: { token: auth.jwt },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 30_000,
    })

    socket.on('connect', () => {
      connected.value = true
      socket?.emit('copilot:join', { projectId, liveSessionId: sessionId })
    })
    socket.on('disconnect', () => { connected.value = false })
    socket.io.on('reconnect_attempt', () => {
      if (socket && auth.jwt) socket.auth = { token: auth.jwt }
    })
    socket.io.on('reconnect', () => {
      socket?.emit('copilot:join', { projectId, liveSessionId: sessionId })
    })

    socket.on('copilot:suggestions', (payload: unknown) => {
      if (!isSuggestionsPayload(payload)) return
      // Append, dedupe by id.
      const existing = new Set(cards.value.map((c) => c.id))
      const additions = payload.cards.filter((c) => !existing.has(c.id))
      if (additions.length > 0) cards.value = [...additions, ...cards.value]
    })

    socket.on('copilot:fire-skipped', (payload: unknown) => {
      if (payload && typeof payload === 'object' && 'reason' in payload) {
        lastSkipReason.value = (payload as { reason: FireSkipReason }).reason
      }
    })
  }

  function _disconnectSocket(): void {
    if (socket) {
      socket.removeAllListeners()
      socket.disconnect()
      socket = null
    }
    connected.value = false
  }

  onBeforeUnmount(() => {
    _disconnectSocket()
  })

  return {
    cards,
    pendingCards,
    enabled,
    connected,
    lastSkipReason,
    liveSessionId,
    startSession,
    appendChunk,
    fire,
    dismiss,
    markAsked,
    endSession,
  }
}

function isSuggestionsPayload(value: unknown): value is { cards: SuggestionCard[] } {
  if (!value || typeof value !== 'object' || !('cards' in value)) return false
  const cards = (value as { cards: unknown }).cards
  if (!Array.isArray(cards)) return false
  return cards.every((c) => c && typeof c === 'object' && 'id' in c && 'question' in c)
}
