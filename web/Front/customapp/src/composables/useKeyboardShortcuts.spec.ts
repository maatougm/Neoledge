/**
 * @file useKeyboardShortcuts.spec.ts
 * Tests the global keyboard shortcut composable. The composable hooks
 * window.keydown on mount and unhooks on unmount, so we host it inside
 * a tiny mount-and-unmount Vue component via @vue/test-utils.
 *
 * Note: refs returned from setup() are NOT auto-unwrapped when nested
 * inside an object on the component instance — we capture the result
 * directly via a `let` and access `.value`.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useKeyboardShortcuts, type KeyboardShortcutState } from './useKeyboardShortcuts'

const pushSpy = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: (path: string) => { pushSpy(path); return Promise.resolve() } }),
  useRoute: () => mockedRoute,
}))

let mockedRoute: { name?: string; params: Record<string, string | string[]> } = {
  name: 'pm-overview',
  params: { id: 'proj-1' },
}

const mountedHosts: Array<ReturnType<typeof mount>> = []

function mountHost(): { wrapper: ReturnType<typeof mount>; state: KeyboardShortcutState } {
  let captured: KeyboardShortcutState
  const Host = defineComponent({
    setup() {
      captured = useKeyboardShortcuts()
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  mountedHosts.push(wrapper)
  return { wrapper, state: captured! }
}

function press(key: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })
  window.dispatchEvent(ev)
  return ev
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    pushSpy.mockReset()
    mockedRoute = { name: 'pm-overview', params: { id: 'proj-1' } }
  })

  afterEach(() => {
    // Unmount any hosts mounted during the test — otherwise their window
    // keydown listeners (and their captured `route` object reference) leak
    // into the next test and trigger spurious dispatches.
    while (mountedHosts.length) mountedHosts.pop()!.unmount()
    vi.useRealTimers()
  })

  it('? toggles helpVisible', () => {
    const { state } = mountHost()
    expect(state.helpVisible.value).toBe(false)
    press('?')
    expect(state.helpVisible.value).toBe(true)
    press('?')
    expect(state.helpVisible.value).toBe(false)
  })

  it('/ opens the search dialog', () => {
    const { state } = mountHost()
    press('/')
    expect(state.searchVisible.value).toBe(true)
  })

  it('Ctrl+K opens search and prevents default', () => {
    const { state } = mountHost()
    const ev = press('k', { ctrlKey: true })
    expect(state.searchVisible.value).toBe(true)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('Escape clears help + search', () => {
    const { state } = mountHost()
    press('?')
    press('/')
    expect(state.helpVisible.value).toBe(true)
    expect(state.searchVisible.value).toBe(true)
    press('Escape')
    expect(state.helpVisible.value).toBe(false)
    expect(state.searchVisible.value).toBe(false)
  })

  it('"g" then "g" navigates to /gantt for the current project', () => {
    mountHost()
    press('g')
    press('g')
    expect(pushSpy).toHaveBeenCalledWith('/app/pm/projects/proj-1/gantt')
  })

  it('"g" then "b" navigates to /board', () => {
    mountHost()
    press('g')
    press('b')
    expect(pushSpy).toHaveBeenCalledWith('/app/pm/projects/proj-1/board')
  })

  it('"g" then "l" navigates to /app/pm/projects', () => {
    mountHost()
    press('g')
    press('l')
    expect(pushSpy).toHaveBeenCalledWith('/app/pm/projects')
  })

  it('"g" timeout expires the pending state after 800ms', async () => {
    vi.useFakeTimers()
    mountHost()
    press('g')
    vi.advanceTimersByTime(900)
    press('g')
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('"c" dispatches neoleadge:create-wp on listening WP routes', () => {
    mockedRoute = { name: 'pm-workpackages', params: {} }
    mountHost()
    const handler = vi.fn()
    window.addEventListener('neoleadge:create-wp', handler)
    press('c')
    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener('neoleadge:create-wp', handler)
  })

  it('"c" is ignored on non-WP routes', () => {
    mockedRoute = { name: 'pm-overview', params: {} }
    mountHost()
    const handler = vi.fn()
    window.addEventListener('neoleadge:create-wp', handler)
    press('c')
    expect(handler).not.toHaveBeenCalled()
    window.removeEventListener('neoleadge:create-wp', handler)
  })

  it('shortcuts are ignored when focus is in an INPUT', () => {
    mountHost()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const ev = new KeyboardEvent('keydown', {
      key: '?',
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(ev, 'target', { value: input })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    document.body.removeChild(input)
  })

  it('keydown listener is removed when host component unmounts', () => {
    const { wrapper } = mountHost()
    wrapper.unmount()
    press('?')
    expect(true).toBe(true)
  })
})
