/**
 * @file useCollaborationSocket.spec.ts
 * Tests the singleton collaboration-socket composable: connect/disconnect,
 * pendingJoins buffering when offline, presence/field-changed/card-moved
 * payload handling, and per-room emit helpers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

type Handler = (payload: unknown) => void

interface MockSocket {
  connected: boolean
  auth: { token: string }
  on: ReturnType<typeof vi.fn>
  emit: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  io: { on: ReturnType<typeof vi.fn> }
  _fire: (event: string, payload?: unknown) => void
  _fireIo: (event: string, payload?: unknown) => void
}

const mockSocketRef: { current: MockSocket | null } = { current: null }
const ioSpy = vi.fn()

vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => {
    const handlers = new Map<string, Handler>()
    const ioHandlers = new Map<string, Handler>()
    const mock: MockSocket = {
      connected: false,
      auth: { token: '' },
      on: vi.fn((event: string, cb: Handler) => { handlers.set(event, cb) }),
      emit: vi.fn(),
      disconnect: vi.fn(() => { mock.connected = false }),
      io: { on: vi.fn((event: string, cb: Handler) => { ioHandlers.set(event, cb) }) },
      _fire(event: string, payload?: unknown) { handlers.get(event)?.(payload) },
      _fireIo(event: string, payload?: unknown) { ioHandlers.get(event)?.(payload) },
    }
    mockSocketRef.current = mock
    ioSpy(...args)
    return mock
  },
}))

async function loadComposable() {
  vi.resetModules()
  setActivePinia(createPinia())
  return (await import('./useCollaborationSocket')).useCollaborationSocket()
}

describe('useCollaborationSocket', () => {
  beforeEach(() => {
    ioSpy.mockClear()
    mockSocketRef.current = null
  })

  it('connect() opens a /collaboration namespace socket', async () => {
    const { connect } = await loadComposable()
    connect('https://api', 'JWT-1')
    expect(ioSpy).toHaveBeenCalledTimes(1)
    expect(ioSpy.mock.calls[0][0]).toBe('https://api/collaboration')
    const opts = ioSpy.mock.calls[0][1] as { auth: { token: string }; transports: string[] }
    expect(opts.auth).toEqual({ token: 'JWT-1' })
    expect(opts.transports).toEqual(['websocket'])
  })

  it('connect() is idempotent while the existing socket is connected', async () => {
    const { connect } = await loadComposable()
    connect('https://api', 'JWT-1')
    if (mockSocketRef.current) mockSocketRef.current.connected = true
    connect('https://api', 'JWT-1')
    expect(ioSpy).toHaveBeenCalledTimes(1)
  })

  it('joinProject buffers when offline and flushes on connect', async () => {
    const { connect, joinProject } = await loadComposable()
    // No socket yet → first joinProject buffers.
    joinProject('proj-1')
    // Now connect; pendingJoins is flushed in the connect handler.
    connect('https://api', 'JWT-1')
    expect(mockSocketRef.current!.emit).not.toHaveBeenCalledWith('join-project', 'proj-1')

    // Fire the connect event to trigger the flush.
    mockSocketRef.current!.connected = true
    mockSocketRef.current!._fire('connect')
    expect(mockSocketRef.current!.emit).toHaveBeenCalledWith('join-project', 'proj-1')
  })

  it('joinProject emits directly when socket is already connected', async () => {
    const { connect, joinProject } = await loadComposable()
    connect('https://api', 'JWT-1')
    mockSocketRef.current!.connected = true
    joinProject('proj-2')
    expect(mockSocketRef.current!.emit).toHaveBeenCalledWith('join-project', 'proj-2')
  })

  it('leaveProject removes from pendingJoins AND emits when connected', async () => {
    const { connect, joinProject, leaveProject } = await loadComposable()
    connect('https://api', 'JWT-1')
    mockSocketRef.current!.connected = true
    joinProject('p1')
    leaveProject('p1')
    expect(mockSocketRef.current!.emit).toHaveBeenCalledWith('leave-project', 'p1')
  })

  it('presence-update sets the reactive presenceList', async () => {
    const { connect, presenceList } = await loadComposable()
    connect('https://api', 'JWT-1')
    mockSocketRef.current!._fire('presence-update', [
      { userId: 'u1', name: 'Alice', color: '#aaa' },
      { userId: 'u2', name: 'Bob', color: '#bbb', editingFieldId: 'f1' },
    ])
    expect(presenceList.value).toHaveLength(2)
    expect(presenceList.value[0].userId).toBe('u1')
  })

  it('presence-update with malformed payload is ignored', async () => {
    const { connect, presenceList } = await loadComposable()
    connect('https://api', 'JWT-1')
    mockSocketRef.current!._fire('presence-update', [{ wrong: 'shape' }])
    expect(presenceList.value).toEqual([])
  })

  it('field-changed sets remoteFieldChange when the payload type-guard passes', async () => {
    const { connect, remoteFieldChange } = await loadComposable()
    connect('https://api', 'JWT-1')
    mockSocketRef.current!._fire('field-changed', {
      projectFieldId: 'f1',
      value: 'hello',
      updatedBy: 'u1',
      updatedByName: 'Alice',
    })
    expect(remoteFieldChange.value).toMatchObject({ projectFieldId: 'f1', value: 'hello' })
  })

  it('card-moved sets remoteCardMove', async () => {
    const { connect, remoteCardMove } = await loadComposable()
    connect('https://api', 'JWT-1')
    mockSocketRef.current!._fire('card-moved', {
      workPackageId: 'wp1',
      boardColumnId: null,
      status: 'InProgress',
    })
    expect(remoteCardMove.value).toEqual({
      workPackageId: 'wp1',
      boardColumnId: null,
      status: 'InProgress',
    })
  })

  it('disconnect() closes socket, clears presenceList + remoteFieldChange', async () => {
    const { connect, disconnect, presenceList, remoteFieldChange } = await loadComposable()
    connect('https://api', 'JWT-1')
    mockSocketRef.current!._fire('presence-update', [
      { userId: 'u1', name: 'A', color: '#000' },
    ])
    disconnect()
    expect(presenceList.value).toEqual([])
    expect(remoteFieldChange.value).toBeNull()
  })

  it('updateAuth() rewrites the live socket token', async () => {
    const { connect, updateAuth } = await loadComposable()
    connect('https://api', 'JWT-1')
    updateAuth('JWT-NEW')
    expect(mockSocketRef.current!.auth.token).toBe('JWT-NEW')
  })

  it('sendFieldUpdate / sendFieldFocus / sendFieldBlur emit only when connected', async () => {
    const { connect, sendFieldUpdate, sendFieldFocus, sendFieldBlur } = await loadComposable()
    connect('https://api', 'JWT-1')
    // Offline first — emits should be suppressed.
    sendFieldUpdate('p1', 'f1', 'v')
    sendFieldFocus('p1', 'f1')
    sendFieldBlur('p1')
    expect(mockSocketRef.current!.emit).not.toHaveBeenCalled()

    mockSocketRef.current!.connected = true
    sendFieldUpdate('p1', 'f1', 'value')
    sendFieldFocus('p1', 'f1')
    sendFieldBlur('p1')
    expect(mockSocketRef.current!.emit).toHaveBeenCalledWith('field-update', {
      projectId: 'p1',
      projectFieldId: 'f1',
      value: 'value',
    })
    expect(mockSocketRef.current!.emit).toHaveBeenCalledWith('field-focus', {
      projectId: 'p1',
      projectFieldId: 'f1',
    })
    expect(mockSocketRef.current!.emit).toHaveBeenCalledWith('field-blur', { projectId: 'p1' })
  })
})
