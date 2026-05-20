import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountOptions, initPinia } from '../__test-utils'
import ActivityFeed from './ActivityFeed.vue'

beforeEach(() => initPinia())

function activity(over: Partial<{ id: string; action: string; detail: string | null; userName: string | null; timestamp: string }> = {}) {
  return {
    id: 'a1',
    action: 'ProjectCreated',
    detail: null,
    userName: 'Marie Martin',
    timestamp: '2026-05-19T10:00:00Z',
    ...over,
  }
}

describe('ActivityFeed', () => {
  it('renders the empty state when no activities', () => {
    const w = mount(ActivityFeed, mountOptions({ props: { activities: [] } }))
    expect(w.text()).toContain('Aucune activité enregistrée.')
  })

  it('renders one timeline-item per activity', () => {
    const w = mount(ActivityFeed, mountOptions({
      props: { activities: [activity(), activity({ id: 'a2', action: 'StatusChanged' })] },
    }))
    expect(w.findAll('.timeline-item')).toHaveLength(2)
  })

  it('falls back to "Système" when userName is null', () => {
    const w = mount(ActivityFeed, mountOptions({
      props: { activities: [activity({ userName: null })] },
    }))
    expect(w.text()).toContain('Système')
  })

  it('renders the detail line when provided', () => {
    const w = mount(ActivityFeed, mountOptions({
      props: { activities: [activity({ detail: 'Status now Cloture' })] },
    }))
    expect(w.text()).toContain('Status now Cloture')
  })

  it('applies dot variants based on action', () => {
    const w = mount(ActivityFeed, mountOptions({
      props: {
        activities: [
          activity({ id: 'c', action: 'ProjectCreated' }),
          activity({ id: 's', action: 'StatusChanged' }),
          activity({ id: 'm', action: 'ManagerAssigned' }),
          activity({ id: 'f', action: 'FieldUpdated' }),
          activity({ id: 'v', action: 'ValidationSubmitted' }),
          activity({ id: 'u', action: 'Unknown' }),
        ],
      },
    }))
    const html = w.html()
    expect(html).toContain('dot--created')
    expect(html).toContain('dot--status')
    expect(html).toContain('dot--manager')
    expect(html).toContain('dot--field')
    expect(html).toContain('dot--validation')
    expect(html).toContain('dot--default')
  })
})
