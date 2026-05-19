/**
 * Smoke test only. ProjectModuleShell wraps ProjectBreadcrumbs + ModulePageHeader
 * and exposes an "actions" slot. The inner ProjectBreadcrumbs uses
 * Composition-API `useRoute()`, not `$route`, so we mock vue-router. We also
 * mock the auth store because its `userRole` computed reads the JWT.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'pm-members', params: {} }),
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ userRole: 'ProjectManager' }),
}))

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { name: 'Proj X' } }) },
}))

import ProjectModuleShell from './ProjectModuleShell.vue'

const RouterLinkStub = {
  template: '<a :href="to"><slot /></a>',
  props: ['to'],
}
const NeoTagStub = {
  template: '<span class="ntag">{{ value }}</span>',
  props: ['value', 'severity'],
}

beforeEach(() => setActivePinia(createPinia()))

describe('ProjectModuleShell', () => {
  it('renders breadcrumbs + header + body slot for a given project', async () => {
    const wrapper = mount(ProjectModuleShell, {
      props: { projectId: 'p1', title: 'Members' },
      slots: { default: '<div class="body-content">child</div>' },
      global: {
        stubs: { RouterLink: RouterLinkStub, NeoTag: NeoTagStub },
      },
    })
    await flushPromises()
    expect(wrapper.find('.pms').exists()).toBe(true)
    expect(wrapper.find('.module-header__title').text()).toBe('Members')
    expect(wrapper.find('.body-content').exists()).toBe(true)
  })

  it('forwards the actions named slot to ModulePageHeader', async () => {
    const wrapper = mount(ProjectModuleShell, {
      props: { projectId: 'p1', title: 'Members' },
      slots: {
        default: '<div>body</div>',
        actions: '<button class="action-btn">Add</button>',
      },
      global: {
        stubs: { RouterLink: RouterLinkStub, NeoTag: NeoTagStub },
      },
    })
    await flushPromises()
    expect(wrapper.find('.action-btn').exists()).toBe(true)
  })
})
