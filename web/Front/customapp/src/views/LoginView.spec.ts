/**
 * @file LoginView.spec.ts — login form + TOTP challenge + invalid creds.
 *
 * The view delegates auth to `useAuthStore().login()` and `.loginTotp()`;
 * we mock those rather than the underlying axios so we exercise the
 * view's branching logic (totp required vs not, error message
 * rendering) without re-testing the store.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { makePinia, makeRouter, ALL_STUBS, buildApiMock } from './__test-helpers'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/lib/api', () => buildApiMock())
vi.mock('@/lib/autofillFix', () => ({ applyAutofill: vi.fn() }))

import LoginView from './LoginView.vue'

describe('LoginView', () => {
  let router = makeRouter()

  beforeEach(() => {
    makePinia()
    router = makeRouter()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const factory = () =>
    mount(LoginView, {
      global: {
        plugins: [router],
        stubs: ALL_STUBS,
      },
    })

  it('mounts without throwing', async () => {
    const wrapper = factory()
    await flushPromises()
    expect(wrapper.exists()).toBe(true)
    // Step-1 (credentials) is rendered, not the TOTP challenge.
    expect(wrapper.html()).toContain('Connexion')
  })

  it('renders the 5 quick-access demo accounts', async () => {
    const wrapper = factory()
    await flushPromises()
    const buttons = wrapper.findAll('.qa-btn')
    // admin / pm / spec / realiz / deploy
    expect(buttons).toHaveLength(5)
  })

  it('successful login redirects to /app via router.push({ name: app-home })', async () => {
    const auth = useAuthStore()
    const loginSpy = vi.spyOn(auth, 'login').mockResolvedValue({ requiresTotp: false } as never)
    const pushSpy = vi.spyOn(router, 'push').mockResolvedValue(undefined as never)

    const wrapper = factory()
    await flushPromises()

    // Trigger via the exposed handler. We use the form's submit
    // event rather than poking the inner stub.
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(loginSpy).toHaveBeenCalled()
    expect(pushSpy).toHaveBeenCalledWith({ name: 'app-home' })
  })

  it('invalid credentials surface an error message', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'login').mockRejectedValue(new Error('401'))

    const wrapper = factory()
    await flushPromises()

    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    // The view sets errorMsg to a French generic message and binds it as
    // the NeoMessage `text` prop. The stub doesn't render its `text` prop
    // into the DOM (only modelValue/value/label flow into data-* attrs),
    // so we read the prop directly from the rendered stub component.
    const msg = wrapper.findComponent({ name: 'NeoMessage' })
    expect(msg.exists()).toBe(true)
    expect(msg.props('text')).toContain('Email ou mot de passe incorrect')
  })

  it('TOTP-required response advances to the challenge step', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'login').mockResolvedValue({
      requiresTotp: true,
      tempToken: 'tmp-token-1',
    } as never)

    const wrapper = factory()
    await flushPromises()

    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    // The TOTP step shows the shield header; step 1 disappears.
    expect(wrapper.html()).toContain('Double authentification')
    expect(wrapper.html()).not.toContain('Mot de passe oublié')
  })

  it('TOTP submit calls loginTotp with the saved tempToken + code', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'login').mockResolvedValue({
      requiresTotp: true,
      tempToken: 'tmp-token-2',
    } as never)
    const totpSpy = vi.spyOn(auth, 'loginTotp').mockResolvedValue(undefined as never)
    const pushSpy = vi.spyOn(router, 'push').mockResolvedValue(undefined as never)

    const wrapper = factory()
    await flushPromises()
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    // Now in TOTP step. Set the totp code reactively and submit.
    const vm = wrapper.vm as unknown as { totpCode: string }
    vm.totpCode = '123456'
    await flushPromises()
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(totpSpy).toHaveBeenCalledWith('tmp-token-2', '123456')
    expect(pushSpy).toHaveBeenCalledWith({ name: 'app-home' })
  })

  it('invalid TOTP code shows the totp-specific error', async () => {
    const auth = useAuthStore()
    vi.spyOn(auth, 'login').mockResolvedValue({
      requiresTotp: true,
      tempToken: 't',
    } as never)
    vi.spyOn(auth, 'loginTotp').mockRejectedValue(new Error('bad'))

    const wrapper = factory()
    await flushPromises()
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    const vm = wrapper.vm as unknown as { totpCode: string }
    vm.totpCode = '999999'
    await flushPromises()
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    // Same NeoMessage prop-read pattern as the credential-error test.
    const msg = wrapper.findComponent({ name: 'NeoMessage' })
    expect(msg.exists()).toBe(true)
    expect(msg.props('text')).toContain('Code invalide')
  })
})
