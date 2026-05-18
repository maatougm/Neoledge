import { describe, it, expect, beforeEach, vi } from 'vitest'
import { onLogout, offLogout, fireLogout, _clearHandlers } from './logoutBus'

beforeEach(() => {
  _clearHandlers()
})

describe('logoutBus', () => {
  it('fires every registered handler', () => {
    const a = vi.fn()
    const b = vi.fn()
    onLogout(a)
    onLogout(b)
    fireLogout()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('dedupes by Set identity — registering the same fn twice keeps it once', () => {
    const fn = vi.fn()
    onLogout(fn)
    onLogout(fn)
    fireLogout()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('offLogout removes a registered handler', () => {
    const fn = vi.fn()
    onLogout(fn)
    offLogout(fn)
    fireLogout()
    expect(fn).not.toHaveBeenCalled()
  })

  it('swallows a thrown handler so the rest still fire', () => {
    const a = vi.fn(() => { throw new Error('boom') })
    const b = vi.fn()
    onLogout(a)
    onLogout(b)
    expect(() => fireLogout()).not.toThrow()
    expect(b).toHaveBeenCalled()
  })

  it('_clearHandlers wipes the registry', () => {
    const fn = vi.fn()
    onLogout(fn)
    _clearHandlers()
    fireLogout()
    expect(fn).not.toHaveBeenCalled()
  })
})
