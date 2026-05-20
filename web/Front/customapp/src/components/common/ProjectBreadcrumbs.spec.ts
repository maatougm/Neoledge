/**
 * @file ProjectBreadcrumbs.spec.ts
 * Tests the role-aware breadcrumb trail. ProjectBreadcrumbs uses `useRoute()`
 * (Composition API), not `$route` — so we mock the vue-router module rather
 * than passing `mocks: { $route }`. `userRole` is derived from the JWT on
 * the auth store, so we mock `@/stores/authStore` directly to control the
 * role per test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// ─── Mocks (declared BEFORE the SUT import so module hoisting catches them) ──

let mockedRouteName: string | undefined = 'pm-members'
let mockedUserRole: string | null = 'ProjectManager'

vi.mock('vue-router', () => ({
  useRoute: () => ({ get name() { return mockedRouteName }, params: {} }),
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    get userRole() { return mockedUserRole },
  }),
}))

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}))

import ProjectBreadcrumbs from './ProjectBreadcrumbs.vue'
import api from '@/lib/api'

const RouterLinkStub = {
  template: '<a :data-to="JSON.stringify(to)" class="rl"><slot /></a>',
  props: ['to'],
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(api.get).mockReset()
  mockedRouteName = 'pm-members'
  mockedUserRole = 'ProjectManager'
})

describe('ProjectBreadcrumbs', () => {
  it('fetches the project name on mount and renders it', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { name: 'Project Alpha' } } as never)
    const wrapper = mount(ProjectBreadcrumbs, {
      props: { projectId: 'p1' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()
    expect(api.get).toHaveBeenCalledWith('/pm/projects/p1')
    expect(wrapper.text()).toContain('Project Alpha')
  })

  it('renders the module label for known route names', async () => {
    mockedRouteName = 'pm-gantt'
    vi.mocked(api.get).mockResolvedValueOnce({ data: { name: 'X' } } as never)
    const wrapper = mount(ProjectBreadcrumbs, {
      props: { projectId: 'p1' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Gantt')
  })

  it('falls back to "Projet" when the name is missing', async () => {
    mockedRouteName = 'pm-board'
    vi.mocked(api.get).mockRejectedValueOnce(new Error('404'))
    const wrapper = mount(ProjectBreadcrumbs, {
      props: { projectId: 'p1' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Projet')
  })

  it('routes "Projets" link to admin list for Admin role', async () => {
    mockedUserRole = 'Admin'
    vi.mocked(api.get).mockResolvedValueOnce({ data: { name: 'X' } } as never)
    const wrapper = mount(ProjectBreadcrumbs, {
      props: { projectId: 'p1' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()
    const firstLink = wrapper.findAll('.rl')[0]
    expect(firstLink.attributes('data-to')).toBe(JSON.stringify('/app/admin/projects'))
  })

  it('routes "Projets" link to PM list for non-Admin roles', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { name: 'X' } } as never)
    const wrapper = mount(ProjectBreadcrumbs, {
      props: { projectId: 'p1' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()
    const firstLink = wrapper.findAll('.rl')[0]
    expect(firstLink.attributes('data-to')).toBe(JSON.stringify('/app/pm/projects'))
  })

  it('omits the trailing label for the bare pm-project-detail route', async () => {
    mockedRouteName = 'pm-project-detail'
    vi.mocked(api.get).mockResolvedValueOnce({ data: { name: 'X' } } as never)
    const wrapper = mount(ProjectBreadcrumbs, {
      props: { projectId: 'p1' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()
    expect(wrapper.findAll('.breadcrumbs__item--current')).toHaveLength(0)
  })
})
