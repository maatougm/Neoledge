/**
 * @file CahierReviewActions.spec.ts — Approve/Reject buttons for the
 * SpecificationTeam. Tests the canReview gate (Admin always allowed,
 * SpecTeam needs project-member status, others denied) and the two
 * submit paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const toastAdd = vi.fn()

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  extractErrorMessage: (err: unknown) =>
    (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? null,
}))

vi.mock('@neolibrary/components', async () => {
  const { defineComponent, h } = await import('vue')
  const pass = (name: string, tag = 'div') =>
    defineComponent({
      name,
      inheritAttrs: false,
      emits: ['click', 'update:modelValue'],
      props: {
        label: String,
        modelValue: [String, Number, Boolean, Object, Array],
        options: Array,
        disabled: Boolean,
        loading: Boolean,
      },
      setup(props, { slots, attrs, emit }) {
        return () =>
          h(
            tag,
            { ...attrs, onClick: (e: MouseEvent) => emit('click', e) },
            slots.default ? slots.default() : (props.label ?? ''),
          )
      },
    })
  return {
    NeoButton: pass('NeoButton', 'button'),
    NeoSelect: pass('NeoSelect', 'div'),
    useNeoToast: () => ({ add: toastAdd }),
  }
})

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({
    push: vi.fn(),
    getRoutes: () => [{ name: 'team-pending-reviews' }],
  }),
}))

// The auth store's userRole/userId are computeds off the JWT — easier to
// drive the test via the jwt helper module than to set a real JWT.
const jwtState = { role: 'Admin' as string | null, id: 'u1' as string | null }
vi.mock('@/lib/jwt', () => ({
  getUserRole: () => jwtState.role,
  getUserFullName: () => 'Test User',
  getUserInitials: () => 'TU',
  getUserId: () => jwtState.id,
  isTokenExpired: () => false,
}))

import CahierReviewActions from './CahierReviewActions.vue'
import api from '@/lib/api'
import { useAuthStore as _useAuthStore } from '@/stores/authStore'

/** Set up an authenticated store. Without a non-empty jwt.value, the
 *  computeds short-circuit to null. */
function authenticate(role: string, userId = 'u1'): void {
  jwtState.role = role
  jwtState.id = userId
  const auth = _useAuthStore()
  auth.jwt = 'mock-token'
}

const AppModalStub = {
  name: 'AppModal',
  props: ['visible', 'header', 'width'],
  emits: ['update:visible'],
  template: `<div v-if="visible" data-stub="AppModal"><slot /><slot name="footer" /></div>`,
}

function mountIt(props: { projectId?: string; status?: 'none' | 'pending' | 'approved' | 'rejected' } = {}) {
  return mount(CahierReviewActions, {
    props: { projectId: 'p1', ...props },
    global: { stubs: { AppModal: AppModalStub } },
  })
}

describe('CahierReviewActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('hides the banner entirely when status is approved', async () => {
    authenticate('Admin')
    const w = mountIt({ status: 'approved' })
    await flushPromises()
    expect(w.text()).not.toContain('en attente de votre validation')
    expect(w.text()).not.toContain('Approuver')
  })

  it('hides the buttons for non-reviewer roles', async () => {
    authenticate('Member')
    const w = mountIt({ status: 'pending' })
    await flushPromises()
    expect(w.find('button').exists()).toBe(false)
  })

  it('shows the approve/reject buttons for Admin regardless of membership', async () => {
    authenticate('Admin')
    const w = mountIt({ status: 'pending' })
    await flushPromises()
    expect(w.text()).toContain('Approuver')
    expect(w.text()).toContain('Rejeter')
  })

  it('SpecTeam without membership cannot review', async () => {
    authenticate('SpecificationTeam', 'u1')
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { members: [{ userId: 'someone-else' }] } })
    const w = mountIt({ status: 'pending' })
    await flushPromises()
    expect(w.find('button').exists()).toBe(false)
  })

  it('SpecTeam WITH membership can review', async () => {
    authenticate('SpecificationTeam', 'u1')
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { members: [{ userId: 'u1' }] } })
    const w = mountIt({ status: 'pending' })
    await flushPromises()
    expect(w.text()).toContain('Approuver')
  })

  it('approve POSTs the right payload + emits reviewed', async () => {
    authenticate('Admin')
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValue({})
    const w = mountIt({ status: 'pending' })
    await flushPromises()

    // Open the modal
    const approveBtn = w.findAll('button').find((b) => b.text() === 'Approuver')!
    await approveBtn.trigger('click')
    // Confirm
    const confirmBtn = w.findAll('button').find((b) => b.text() === "Confirmer l'approbation")!
    await confirmBtn.trigger('click')
    await flushPromises()

    expect(api.post).toHaveBeenCalledWith(
      '/pm/projects/p1/cahier-des-charges/feedback',
      expect.objectContaining({ status: 'approved' }),
    )
    expect(w.emitted('reviewed')).toBeTruthy()
  })

  it('rejected status renders the "you rejected" banner without action buttons', async () => {
    authenticate('Admin')
    const w = mountIt({ status: 'rejected' })
    await flushPromises()
    expect(w.text()).toContain('Vous avez rejeté')
    expect(w.findAll('button').find((b) => b.text() === 'Approuver')).toBeUndefined()
  })
})
