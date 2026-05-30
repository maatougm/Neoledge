/**
 * @file MagicLoginView.spec.ts — token consumption, TOTP branch, error states.
 *
 * The view reads ?token= from the URL and delegates to
 * `useAuthStore().magicLogin()` on mount. We mock the store actions to drive
 * each branch (success → redirect, requiresTotp → challenge, reject → error)
 * without re-testing the store or hitting axios.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { makePinia, makeRouter, ALL_STUBS } from './__test-helpers'
import { useAuthStore } from '@/stores/authStore'

import MagicLoginView from './MagicLoginView.vue'

describe('MagicLoginView', () => {
  let router = makeRouter()

  beforeEach(() => {
    makePinia()
    router = makeRouter()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function factory(token?: string) {
    await router.push(token ? { path: '/login', query: { token } } : { path: '/login' })
    await router.isReady()
    return mount(MagicLoginView, {
      global: { plugins: [router], stubs: ALL_STUBS },
    })
  }

  it('a valid token logs in and redirects to app-home', async () => {
    const auth = useAuthStore()
    const magicSpy = vi.spyOn(auth, 'magicLogin').mockResolvedValue({ requiresTotp: false } as never)

    // The redirect fires from onMounted before a post-mount spy could attach,
    // so assert the real resulting route instead of spying router.push.
    await factory('rawtoken')
    await flushPromises()

    expect(magicSpy).toHaveBeenCalledWith('rawtoken')
    expect(router.currentRoute.value.name).toBe('app-home')
  })

  it('shows an error state (no store call) when the token is missing', async () => {
    const auth = useAuthStore()
    const magicSpy = vi.spyOn(auth, 'magicLogin')

    const wrapper = await factory(undefined)
    await flushPromises()

    expect(magicSpy).not.toHaveBeenCalled()
    expect(wrapper.html()).toContain('invalide')
  })

  it('shows an error state when the link is invalid / expired (store rejects)', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'magicLogin').mockRejectedValue(new Error('401'))

    const wrapper = await factory('expiredtoken')
    await flushPromises()

    expect(wrapper.html()).toContain('expiré')
  })

  it('advances to the TOTP challenge when the account has 2FA', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'magicLogin').mockResolvedValue({ requiresTotp: true, tempToken: 'tmp' } as never)

    const wrapper = await factory('rawtoken')
    await flushPromises()

    expect(wrapper.html()).toContain("application d'authentification")
  })

  it('TOTP submit calls loginTotp with the saved tempToken + code, then redirects (via replace)', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'magicLogin').mockResolvedValue({ requiresTotp: true, tempToken: 'tmp-9' } as never)
    const totpSpy = vi.spyOn(auth, 'loginTotp').mockResolvedValue(undefined as never)

    const wrapper = await factory('rawtoken')
    // Redirect uses router.replace (not push) so the token URL isn't kept in history.
    const replaceSpy = vi.spyOn(router, 'replace').mockResolvedValue(undefined as never)
    await flushPromises()

    const vm = wrapper.vm as unknown as { totpCode: string }
    vm.totpCode = '123456'
    await flushPromises()
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(totpSpy).toHaveBeenCalledWith('tmp-9', '123456')
    expect(replaceSpy).toHaveBeenCalledWith({ name: 'app-home' })
  })

  it('strips the token from the URL on mount (no token left in history)', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'magicLogin').mockResolvedValue({ requiresTotp: true, tempToken: 'x' } as never)
    const histSpy = vi.spyOn(window.history, 'replaceState')

    await factory('secret-token')
    await flushPromises()

    // The token must not remain in any URL passed to replaceState.
    expect(histSpy).toHaveBeenCalled()
    for (const call of histSpy.mock.calls) {
      expect(String(call[2])).not.toContain('secret-token')
    }
  })
})
