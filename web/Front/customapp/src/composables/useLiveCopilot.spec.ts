/**
 * @file useLiveCopilot.spec.ts
 * Covers the unified live-meeting copilot composable: HTTP lifecycle calls
 * (start/append/fire/ask/dismiss/end), the auto-resurrect path when the
 * server session map was wiped, and the socket event handlers
 * (meeting-state, fire-skipped, coverage). The composable needs to be
 * called inside a Vue setup() so we host it in a tiny mountable component.
 *
 * Note: refs returned from setup() inside a nested object are NOT auto-
 * unwrapped on the component instance — we capture the composable result
 * via `let` and access `.value` on each ref directly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => {
  const post = vi.fn()
  const del = vi.fn()
  return {
    default: { post, delete: del },
    extractErrorMessage: (e: unknown) => {
      const r = (e as { response?: { data?: { message?: string } } } | undefined)?.response?.data?.message
      if (typeof r === 'string') return r
      return (e as { message?: string })?.message ?? 'unknown'
    },
  }
})

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ jwt: 'JWT-1' }),
}))

vi.mock('@/stores/configStore', () => ({
  useConfigStore: () => ({ apiUrl: 'https://api' }),
}))

type Handler = (payload: unknown) => void
interface MockSocket {
  connected: boolean
  auth: { token: string }
  on: ReturnType<typeof vi.fn>
  emit: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  removeAllListeners: ReturnType<typeof vi.fn>
  io: { on: ReturnType<typeof vi.fn> }
  _fire: (event: string, payload?: unknown) => void
}
const mockSocketRef: { current: MockSocket | null } = { current: null }

vi.mock('socket.io-client', () => ({
  io: () => {
    const handlers = new Map<string, Handler>()
    const mock: MockSocket = {
      connected: false,
      auth: { token: '' },
      on: vi.fn((event: string, cb: Handler) => { handlers.set(event, cb) }),
      emit: vi.fn(),
      disconnect: vi.fn(() => { mock.connected = false }),
      removeAllListeners: vi.fn(),
      io: { on: vi.fn() },
      _fire(event: string, payload?: unknown) { handlers.get(event)?.(payload) },
    }
    mockSocketRef.current = mock
    return mock
  },
}))

// ─── Host component to invoke the composable inside setup() ───────────────────

import { useLiveCopilot } from './useLiveCopilot'

type Copilot = ReturnType<typeof useLiveCopilot>

function mountHost(projectId = 'proj-1'): { wrapper: VueWrapper; copilot: Copilot } {
  let captured: Copilot
  const Host = defineComponent({
    setup() {
      captured = useLiveCopilot(projectId)
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  return { wrapper, copilot: captured! }
}

async function getApi() {
  return (await import('@/lib/api')).default as unknown as {
    post: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
}

describe('useLiveCopilot', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockSocketRef.current = null
    vi.clearAllMocks()
  })

  it('startSession() POSTs and flips enabled/connected on socket connect', async () => {
    const api = await getApi()
    api.post.mockResolvedValueOnce({ data: {} })

    const { copilot } = mountHost()
    const result = await copilot.startSession('sess-1', 'kickoff')

    expect(result.ok).toBe(true)
    expect(api.post).toHaveBeenCalledWith(
      '/pm/projects/proj-1/meetings/live/copilot/session',
      { liveSessionId: 'sess-1', meetingType: 'kickoff' },
    )
    expect(copilot.enabled.value).toBe(true)
    expect(copilot.liveSessionId.value).toBe('sess-1')

    mockSocketRef.current!._fire('connect')
    expect(copilot.connected.value).toBe(true)
    expect(mockSocketRef.current!.emit).toHaveBeenCalledWith(
      'copilot:join',
      { projectId: 'proj-1', liveSessionId: 'sess-1' },
    )
  })

  it('startSession() returns ok:false and stays disabled on server error', async () => {
    const api = await getApi()
    api.post.mockRejectedValueOnce(new Error('unavailable'))

    const { copilot } = mountHost()
    const result = await copilot.startSession('sess-X')
    expect(result.ok).toBe(false)
    expect(copilot.enabled.value).toBe(false)
  })

  it('appendChunk() short-circuits when not enabled', async () => {
    const api = await getApi()
    const { copilot } = mountHost()
    const out = await copilot.appendChunk('some text')
    expect(out).toEqual({ shouldFire: false })
    expect(api.post).not.toHaveBeenCalled()
  })

  it('appendChunk() forwards the chunk and returns the shouldFire flag', async () => {
    const api = await getApi()
    api.post.mockResolvedValueOnce({ data: {} }) // startSession
    api.post.mockResolvedValueOnce({ data: { shouldFire: true } }) // appendChunk

    const { copilot } = mountHost()
    await copilot.startSession('sess-1')
    const out = await copilot.appendChunk('hello')
    expect(out).toEqual({ shouldFire: true })
  })

  it('appendChunk() auto-resurrects the server session on 400 "Session introuvable"', async () => {
    const api = await getApi()
    api.post.mockResolvedValueOnce({ data: {} }) // startSession
    // First append: simulate the server-restart 400.
    const sessionGone = Object.assign(new Error('Session introuvable.'), {
      response: { status: 400, data: { message: 'Session introuvable.' } },
    })
    api.post.mockRejectedValueOnce(sessionGone)
    // resurrect → POST /session succeeds.
    api.post.mockResolvedValueOnce({ data: {} })
    // Replay of appendChunk → success.
    api.post.mockResolvedValueOnce({ data: { shouldFire: false } })

    const { copilot } = mountHost()
    await copilot.startSession('sess-1')
    const out = await copilot.appendChunk('text')
    expect(out).toEqual({ shouldFire: false })
    // startSession + failed append + resurrect + replay = 4 POSTs total.
    expect(api.post).toHaveBeenCalledTimes(4)
    expect(copilot.enabled.value).toBe(true)
  })

  it('appendChunk() disables the session when even resurrect fails', async () => {
    const api = await getApi()
    api.post.mockResolvedValueOnce({ data: {} }) // startSession
    const sessionGone = Object.assign(new Error('Session introuvable.'), {
      response: { status: 400, data: { message: 'Session introuvable.' } },
    })
    api.post.mockRejectedValueOnce(sessionGone)
    api.post.mockRejectedValueOnce(new Error('still down'))

    const { copilot } = mountHost()
    await copilot.startSession('sess-1')
    const out = await copilot.appendChunk('text')
    expect(out).toEqual({ shouldFire: false })
    expect(copilot.enabled.value).toBe(false)
  })

  it('fire() POSTs with force when requested, silently on failure', async () => {
    const api = await getApi()
    api.post.mockResolvedValueOnce({ data: {} }) // startSession
    api.post.mockRejectedValueOnce(new Error('boom')) // fire

    const { copilot } = mountHost()
    await copilot.startSession('sess-1')
    await expect(copilot.fire({ force: true })).resolves.toBeUndefined()
    expect(api.post).toHaveBeenCalledWith(
      '/pm/projects/proj-1/meetings/live/copilot/fire',
      { liveSessionId: 'sess-1', force: true },
    )
  })

  it('askItem() optimistically patches userAction=asked and rolls back on POST failure', async () => {
    const api = await getApi()
    api.post.mockResolvedValueOnce({ data: {} }) // startSession
    const { copilot } = mountHost()
    await copilot.startSession('sess-1')

    // Seed checklist via the meeting-state socket event.
    mockSocketRef.current!._fire('copilot:meeting-state', {
      checklist: [
        {
          id: 'i1', topic: 't', question: 'q', category: 'context',
          section: 'contexte', status: 'missing', evidence: null,
          suggestion: null, userAction: null,
        },
      ],
      hint: null,
      readyForCahier: false,
    })

    api.post.mockRejectedValueOnce(new Error('500'))
    await copilot.askItem('i1')
    // Rolled back.
    expect(copilot.checklist.value[0].userAction).toBeNull()
  })

  it('dismissItem() optimistically patches userAction=dismissed', async () => {
    const api = await getApi()
    api.post.mockResolvedValueOnce({ data: {} }) // startSession
    api.post.mockResolvedValueOnce({ data: {} }) // dismiss
    const { copilot } = mountHost()
    await copilot.startSession('sess-1')
    mockSocketRef.current!._fire('copilot:meeting-state', {
      checklist: [
        {
          id: 'i1', topic: 't', question: 'q', category: 'context',
          section: 'contexte', status: 'missing', evidence: null,
          suggestion: null, userAction: null,
        },
      ],
      hint: null,
      readyForCahier: false,
    })
    await copilot.dismissItem('i1')
    expect(copilot.checklist.value[0].userAction).toBe('dismissed')
  })

  it('socket payloads update checklist, fire-skipped reason, and agentCoverage', async () => {
    const api = await getApi()
    api.post.mockResolvedValueOnce({ data: {} })
    const { copilot } = mountHost()
    await copilot.startSession('sess-1')

    mockSocketRef.current!._fire('copilot:meeting-state', {
      checklist: [
        { id: 'a', topic: 'x', question: 'y', category: 'context', section: 'contexte',
          status: 'covered', evidence: 'evidence', suggestion: null, userAction: null },
      ],
      hint: 'rappel',
      readyForCahier: true,
    })
    expect(copilot.totalCount.value).toBe(1)
    expect(copilot.coveredCount.value).toBe(1)
    expect(copilot.hint.value).toBe('rappel')
    expect(copilot.readyForCahier.value).toBe(true)

    mockSocketRef.current!._fire('copilot:fire-skipped', { reason: 'cooldown' })
    expect(copilot.lastSkipReason.value).toBe('cooldown')

    mockSocketRef.current!._fire('copilot:coverage', { sections: ['contexte', 'objectifProjet'] })
    expect(copilot.agentCoverage.value).toEqual(expect.arrayContaining(['contexte', 'objectifProjet']))
  })

  it('endSession() clears all reactive state and DELETEs the server session', async () => {
    const api = await getApi()
    api.post.mockResolvedValueOnce({ data: {} })
    api.delete.mockResolvedValueOnce({ data: {} })
    const { copilot } = mountHost()
    await copilot.startSession('sess-1')
    mockSocketRef.current!._fire('copilot:meeting-state', {
      checklist: [{ id: 'a', topic: 't', question: 'q', category: 'context', section: 'contexte',
                    status: 'covered', evidence: null, suggestion: null, userAction: null }],
      hint: 'x', readyForCahier: true,
    })

    await copilot.endSession('transcript-7')

    expect(api.delete).toHaveBeenCalledWith(
      '/pm/projects/proj-1/meetings/live/copilot/session',
      { data: { liveSessionId: 'sess-1', meetingTranscriptId: 'transcript-7' } },
    )
    expect(copilot.enabled.value).toBe(false)
    expect(copilot.liveSessionId.value).toBeNull()
    expect(copilot.checklist.value).toEqual([])
    expect(copilot.hint.value).toBeNull()
    expect(copilot.readyForCahier.value).toBe(false)
    expect(copilot.agentCoverage.value).toEqual([])
  })

  it('pendingSuggestions filters to items with a non-null suggestion and null userAction', async () => {
    const api = await getApi()
    api.post.mockResolvedValueOnce({ data: {} })
    const { copilot } = mountHost()
    await copilot.startSession('sess-1')
    mockSocketRef.current!._fire('copilot:meeting-state', {
      checklist: [
        { id: 'a', topic: '', question: '', category: 'context', section: 'contexte',
          status: 'missing', evidence: null,
          suggestion: { question: 'q?', rationale: 'r', urgency: 'high' }, userAction: null },
        { id: 'b', topic: '', question: '', category: 'context', section: 'contexte',
          status: 'missing', evidence: null,
          suggestion: { question: 'q2?', rationale: 'r', urgency: 'low' }, userAction: 'asked' },
        { id: 'c', topic: '', question: '', category: 'context', section: 'contexte',
          status: 'covered', evidence: 'e', suggestion: null, userAction: null },
      ],
      hint: null,
      readyForCahier: false,
    })
    expect(copilot.pendingSuggestions.value).toHaveLength(1)
    expect(copilot.pendingSuggestions.value[0].id).toBe('a')
  })
})
