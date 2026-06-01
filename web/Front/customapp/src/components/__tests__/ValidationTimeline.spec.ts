import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ValidationTimeline from '@/components/pm/ValidationTimeline.vue'
import type { ProjectValidation } from '@/types/pm.types'

// Mock @/lib/api directly — bypasses axios entirely. Cleaner than mocking
// the axios module because api.ts mutates `axios.defaults` at module load,
// and replicating the defaults shape on a vi.mock is fragile.
vi.mock('@/lib/api', () => {
  const apiMock = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }
  return {
    default: apiMock,
    extractErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown'),
  }
})

// Mock the useApp store so it doesn't need a real Pinia setup with real JWT
vi.mock('@/stores/useApp', () => ({
  useApp: () => ({
    jwt: 'mock-jwt-token',
    apiUrl: 'http://localhost:3000',
  }),
}))

// Mock NeoTag to avoid NeoLibrary setup overhead
vi.mock('@neolibrary/components', () => ({
  NeoTag: {
    name: 'NeoTag',
    props: ['value', 'severity'],
    template: '<span class="neo-tag" :data-severity="severity">{{ value }}</span>',
  },
}))

const makeValidation = (overrides: Partial<ProjectValidation> = {}): ProjectValidation => ({
  id: 'v1',
  projectId: 'p1',
  validatedByRole: 'Admin',
  validatedByName: 'Alice Dupont',
  phase: 'Kickoff',
  isApproved: true,
  comment: null,
  validatedAt: '2026-04-09T14:30:00.000Z',
  ...overrides,
})

describe('ValidationTimeline', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders the correct number of timeline entries', async () => {
    const apiMock = await import('@/lib/api')
    vi.mocked(apiMock.default.get).mockResolvedValueOnce({
      data: [
        makeValidation({ id: 'v1' }),
        makeValidation({ id: 'v2', isApproved: false }),
        makeValidation({ id: 'v3', phase: 'Realisation' }),
      ],
    })

    const wrapper = mount(ValidationTimeline, { props: { projectId: 'p1' } })
    await flushPromises()

    expect(wrapper.findAll('.vt-entry')).toHaveLength(3)
  })

  it('shows green dot for isApproved=true', async () => {
    const apiMock = await import('@/lib/api')
    vi.mocked(apiMock.default.get).mockResolvedValueOnce({
      data: [makeValidation({ isApproved: true })],
    })

    const wrapper = mount(ValidationTimeline, { props: { projectId: 'p1' } })
    await flushPromises()

    const dot = wrapper.find('.vt-dot')
    expect(dot.classes()).toContain('vt-dot--approved')
    expect(dot.classes()).not.toContain('vt-dot--rejected')
  })

  it('shows "Approuvé ✓" NeoTag for isApproved=true', async () => {
    const apiMock = await import('@/lib/api')
    vi.mocked(apiMock.default.get).mockResolvedValueOnce({
      data: [makeValidation({ isApproved: true })],
    })

    const wrapper = mount(ValidationTimeline, { props: { projectId: 'p1' } })
    await flushPromises()

    const tag = wrapper.find('.neo-tag')
    expect(tag.text()).toBe('Approuvé ✓')
    expect(tag.attributes('data-severity')).toBe('success')
  })

  it('shows red dot for isApproved=false', async () => {
    const apiMock = await import('@/lib/api')
    vi.mocked(apiMock.default.get).mockResolvedValueOnce({
      data: [makeValidation({ isApproved: false })],
    })

    const wrapper = mount(ValidationTimeline, { props: { projectId: 'p1' } })
    await flushPromises()

    const dot = wrapper.find('.vt-dot')
    expect(dot.classes()).toContain('vt-dot--rejected')
    expect(dot.classes()).not.toContain('vt-dot--approved')
  })

  it('shows "Rejeté ✗" NeoTag for isApproved=false', async () => {
    const apiMock = await import('@/lib/api')
    vi.mocked(apiMock.default.get).mockResolvedValueOnce({
      data: [makeValidation({ isApproved: false })],
    })

    const wrapper = mount(ValidationTimeline, { props: { projectId: 'p1' } })
    await flushPromises()

    const tag = wrapper.find('.neo-tag')
    expect(tag.text()).toBe('Rejeté ✗')
    expect(tag.attributes('data-severity')).toBe('danger')
  })

  it('shows empty state when validations array is empty', async () => {
    const apiMock = await import('@/lib/api')
    vi.mocked(apiMock.default.get).mockResolvedValueOnce({ data: [] })

    const wrapper = mount(ValidationTimeline, { props: { projectId: 'p1' } })
    await flushPromises()

    expect(wrapper.find('.vt-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('Aucune validation enregistrée pour ce projet')
    expect(wrapper.find('.vt-timeline').exists()).toBe(false)
  })

  it('shows comment in italic when comment is present', async () => {
    const apiMock = await import('@/lib/api')
    vi.mocked(apiMock.default.get).mockResolvedValueOnce({
      data: [makeValidation({ comment: 'Besoin de révision' })],
    })

    const wrapper = mount(ValidationTimeline, { props: { projectId: 'p1' } })
    await flushPromises()

    const comment = wrapper.find('.vt-comment')
    expect(comment.exists()).toBe(true)
    expect(comment.text()).toBe('Besoin de révision')
  })

  it('does not render comment element when comment is null', async () => {
    const apiMock = await import('@/lib/api')
    vi.mocked(apiMock.default.get).mockResolvedValueOnce({
      data: [makeValidation({ comment: null })],
    })

    const wrapper = mount(ValidationTimeline, { props: { projectId: 'p1' } })
    await flushPromises()

    expect(wrapper.find('.vt-comment').exists()).toBe(false)
  })

  it('calls API with correct projectId', async () => {
    const apiMock = await import('@/lib/api')
    const getSpy = vi.mocked(apiMock.default.get).mockResolvedValueOnce({ data: [] })

    mount(ValidationTimeline, { props: { projectId: 'project-abc' } })
    await flushPromises()

    expect(getSpy).toHaveBeenCalledWith(
      expect.stringContaining('/pm/projects/project-abc/validations'),
    )
  })
})
