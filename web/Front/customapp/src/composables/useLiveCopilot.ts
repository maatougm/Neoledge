/**
 * @file useLiveCopilot.ts — wires the unified live meeting copilot.
 * One agent fire produces BOTH a project checklist (topics-to-collect)
 * AND inline question suggestions attached to missing/partial items.
 *
 * Connects to the `/live-meeting` socket namespace, joins the project+session
 * room, exposes a reactive checklist + hint + ready flag, and offers per-item
 * action helpers (ask/dismiss) plus session lifecycle (start/append/fire/end).
 */

import { ref, computed, onBeforeUnmount } from 'vue'
import { io, type Socket } from 'socket.io-client'
import api, { extractErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'

// ─── Types (mirrored from backend live-copilot.types.ts) ───────────────────

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

export type ChecklistStatus = 'covered' | 'partial' | 'missing'

export type ChecklistCategory =
  | 'context' | 'users' | 'features' | 'constraints'
  | 'integrations' | 'security' | 'timeline' | 'other'

export type UserItemAction = 'asked' | 'dismissed'

export interface ChecklistSuggestion {
  question: string
  rationale: string
  urgency: SuggestionUrgency
}

export interface ChecklistItem {
  id: string
  topic: string
  question: string
  category: ChecklistCategory
  section: CahierSection
  status: ChecklistStatus
  evidence: string | null
  suggestion: ChecklistSuggestion | null
  userAction: UserItemAction | null
}

export type FireSkipReason =
  | 'cooldown' | 'cap_reached' | 'budget' | 'min_content' | 'no_session' | 'provider'

interface MeetingStatePayload {
  checklist: ChecklistItem[]
  hint: string | null
  readyForCahier: boolean
}

// ─── Composable ────────────────────────────────────────────────────────────

export function useLiveCopilot(projectId: string) {
  const auth = useAuthStore()
  const config = useConfigStore()

  const checklist = ref<ChecklistItem[]>([])
  const hint = ref<string | null>(null)
  const readyForCahier = ref<boolean>(false)
  const lastSkipReason = ref<FireSkipReason | null>(null)
  const connected = ref(false)
  const enabled = ref(false) // false until startSession returns 201
  const liveSessionId = ref<string | null>(null)
  /** Cumulative agent-tagged covered sections — drives the coverage gauge. */
  const agentCoverage = ref<CahierSection[]>([])

  let socket: Socket | null = null

  // ─── Computed views ──────────────────────────────────────────────────────

  /** Items with an active (pending) suggestion the PM can Ask / Ignore. */
  const pendingSuggestions = computed<ChecklistItem[]>(() =>
    checklist.value.filter((i) => i.suggestion !== null && i.userAction === null),
  )

  const coveredCount = computed(() => checklist.value.filter((i) => i.status === 'covered').length)
  const totalCount = computed(() => checklist.value.length)

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async function startSession(sessionId: string, meetingType?: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      await api.post(`/pm/projects/${projectId}/meetings/live/copilot/session`, {
        liveSessionId: sessionId,
        ...(meetingType ? { meetingType } : {}),
      })
      liveSessionId.value = sessionId
      enabled.value = true
      _connectSocket(sessionId)
      return { ok: true }
    } catch (e: unknown) {
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

  /** Fire the agent. `force=true` bypasses cooldown + min-content gates. */
  async function fire(options: { force?: boolean } = {}): Promise<void> {
    if (!enabled.value || !liveSessionId.value) return
    try {
      await api.post(`/pm/projects/${projectId}/meetings/live/copilot/fire`, {
        liveSessionId: liveSessionId.value,
        ...(options.force ? { force: true } : {}),
      })
    } catch {
      /* fire never 5xx's mid-meeting — service downgrades to skipReason via socket. */
    }
  }

  async function askItem(itemId: string): Promise<void> {
    if (!enabled.value || !liveSessionId.value) return
    // Optimistic: mark the item as asked locally.
    _patchItem(itemId, { userAction: 'asked' })
    try {
      await api.post(
        `/pm/projects/${projectId}/meetings/live/copilot/items/${itemId}/ask`,
        { liveSessionId: liveSessionId.value, itemId },
      )
    } catch {
      _patchItem(itemId, { userAction: null })
    }
  }

  async function dismissItem(itemId: string): Promise<void> {
    if (!enabled.value || !liveSessionId.value) return
    _patchItem(itemId, { userAction: 'dismissed' })
    try {
      await api.post(
        `/pm/projects/${projectId}/meetings/live/copilot/items/${itemId}/dismiss`,
        { liveSessionId: liveSessionId.value, itemId },
      )
    } catch {
      _patchItem(itemId, { userAction: null })
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
    agentCoverage.value = []
    checklist.value = []
    hint.value = null
    readyForCahier.value = false
  }

  // ─── Socket plumbing ─────────────────────────────────────────────────────

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

    socket.on('copilot:meeting-state', (payload: unknown) => {
      if (!isMeetingStatePayload(payload)) return
      checklist.value = payload.checklist
      hint.value = payload.hint
      readyForCahier.value = payload.readyForCahier
    })

    socket.on('copilot:fire-skipped', (payload: unknown) => {
      if (payload && typeof payload === 'object' && 'reason' in payload) {
        lastSkipReason.value = (payload as { reason: FireSkipReason }).reason
      }
    })

    socket.on('copilot:coverage', (payload: unknown) => {
      if (!payload || typeof payload !== 'object' || !('sections' in payload)) return
      const sections = (payload as { sections: unknown }).sections
      if (!Array.isArray(sections)) return
      const next = new Set<CahierSection>(agentCoverage.value)
      for (const s of sections) {
        if (typeof s === 'string') next.add(s as CahierSection)
      }
      agentCoverage.value = Array.from(next)
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

  function _patchItem(itemId: string, patch: Partial<ChecklistItem>): void {
    const idx = checklist.value.findIndex((i) => i.id === itemId)
    if (idx < 0) return
    checklist.value = [
      ...checklist.value.slice(0, idx),
      { ...checklist.value[idx], ...patch },
      ...checklist.value.slice(idx + 1),
    ]
  }

  onBeforeUnmount(() => {
    _disconnectSocket()
  })

  return {
    // state
    checklist,
    hint,
    readyForCahier,
    pendingSuggestions,
    coveredCount,
    totalCount,
    enabled,
    connected,
    lastSkipReason,
    liveSessionId,
    agentCoverage,
    // actions
    startSession,
    appendChunk,
    fire,
    askItem,
    dismissItem,
    endSession,
  }
}

// ─── Type guards ───────────────────────────────────────────────────────────

function isMeetingStatePayload(value: unknown): value is MeetingStatePayload {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.checklist)) return false
  if (typeof v.readyForCahier !== 'boolean') return false
  if (v.hint !== null && typeof v.hint !== 'string') return false
  return v.checklist.every((i) => i && typeof i === 'object' && 'id' in (i as Record<string, unknown>) && 'status' in (i as Record<string, unknown>))
}
