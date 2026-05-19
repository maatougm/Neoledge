/**
 * @file useNotificationSocket.spec.ts
 * Tests the singleton notification-socket composable. socket.io-client
 * is fully mocked so the spec exercises the connect / disconnect /
 * updateAuth / token-switch wiring without any real network activity.
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
  // Helpers our tests use to drive callbacks:
  _fire: (event: string, payload?: unknown) => void
}

const mockSocketRef: { current: MockSocket | null } = { current: null }
const ioSpy = vi.fn()

vi.mock('socket.io-client', () => {
  return {
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
        _fire(event: string, payload?: unknown) {
          const h = handlers.get(event) ?? ioHandlers.get(event)
          h?.(payload)
        },
      }
      mockSocketRef.current = mock
      ioSpy(...args)
      return mock
    },
  }
})

async function loadComposable() {
  vi.resetModules()
  // Stores are imported dynamically inside the composable; ensure pinia is active.
  setActivePinia(createPinia())
  return (await import('./useNotificationSocket')).useNotificationSocket()
}

describe('useNotificationSocket', () => {
  beforeEach(() => {
    ioSpy.mockClear()
    mockSocketRef.current = null
  })

  it('connect() opens a /notifications namespace socket with the given token', async () => {
    const { connect } = await loadComposable()
    connect('https://api.example.com/', 'JWT-1')
    expect(ioSpy).toHaveBeenCalledTimes(1)
    expect(ioSpy.mock.calls[0][0]).toBe('https://api.example.com/notifications')
    const opts = ioSpy.mock.calls[0][1] as { auth: { token: string }; transports: string[] }
    expect(opts.auth).toEqual({ token: 'JWT-1' })
    expect(opts.transports).toEqual(['websocket'])
  })

  it('connect() is a no-op when already connected with the same token', async () => {
    const { connect } = await loadComposable()
    connect('https://api', 'JWT-1')
    if (mockSocketRef.current) mockSocketRef.current.connected = true
    connect('https://api', 'JWT-1')
    expect(ioSpy).toHaveBeenCalledTimes(1)
  })

  it('connect() with a NEW token disconnects the old socket and opens a fresh one', async () => {
    const { connect } = await loadComposable()
    connect('https://api', 'JWT-1')
    const first = mockSocketRef.current!
    // Caller switched users.
    connect('https://api', 'JWT-2')
    expect(first.disconnect).toHaveBeenCalled()
    expect(ioSpy).toHaveBeenCalledTimes(2)
    const second = ioSpy.mock.calls[1][1] as { auth: { token: string } }
    expect(second.auth.token).toBe('JWT-2')
  })

  it('on connect, `connected` ref flips to true', async () => {
    const { connect, connected } = await loadComposable()
    connect('https://api', 'JWT-1')
    expect(connected.value).toBe(false)
    mockSocketRef.current!._fire('connect')
    expect(connected.value).toBe(true)
  })

  it('on disconnect, `connected` ref flips to false', async () => {
    const { connect, connected } = await loadComposable()
    connect('https://api', 'JWT-1')
    mockSocketRef.current!._fire('connect')
    expect(connected.value).toBe(true)
    mockSocketRef.current!._fire('disconnect')
    expect(connected.value).toBe(false)
  })

  it('disconnect() closes the socket and resets state', async () => {
    const { connect, disconnect, connected } = await loadComposable()
    connect('https://api', 'JWT-1')
    mockSocketRef.current!._fire('connect')
    expect(connected.value).toBe(true)

    disconnect()
    expect(mockSocketRef.current!.disconnect).toHaveBeenCalled()
    expect(connected.value).toBe(false)
  })

  it('updateAuth() rewrites the live socket auth token', async () => {
    const { connect, updateAuth } = await loadComposable()
    connect('https://api', 'JWT-1')
    updateAuth('JWT-NEW')
    expect(mockSocketRef.current!.auth.token).toBe('JWT-NEW')
  })

  it('updateAuth() is a no-op when no socket is open', async () => {
    const { updateAuth } = await loadComposable()
    expect(() => updateAuth('JWT-NEW')).not.toThrow()
  })

  it('strips trailing slash from apiUrl before building the namespace URL', async () => {
    const { connect } = await loadComposable()
    connect('https://api///', 'JWT-1')
    expect(ioSpy.mock.calls[0][0]).toBe('https://api///notifications'.replace('////', '///'))
    // The substantive contract is "trailing slash stripped exactly once":
    expect(ioSpy.mock.calls[0][0]).toMatch(/\/notifications$/)
  })

  it('on receiving a malformed notification payload, it does not throw', async () => {
    const { connect } = await loadComposable()
    connect('https://api', 'JWT-1')
    expect(() => mockSocketRef.current!._fire('notification', { bad: 'data' })).not.toThrow()
  })
})
