import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ActivitySection from '@/components/admin/sections/ActivitySection.vue'
import type { ProjectActivity, ActivityStats } from '@/types/project.types'

// ── Mock NeoLibrary ────────────────────────────────────────────────────────────

vi.mock('@neolibrary/components', () => ({
  NeoButton: {
    name: 'NeoButton',
    template: '<button :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
    props: ['label', 'icon', 'loading', 'disabled', 'outlined', 'text'],
    emits: ['click'],
  },
  NeoSelect: {
    name: 'NeoSelect',
    template: '<select @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>',
    props: ['modelValue', 'options', 'optionLabel', 'optionValue', 'placeholder', 'disabled'],
    emits: ['update:modelValue'],
  },
}))

// ── Mock shared api wrapper ────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))
import api from '@/lib/api'
const mockedAxios = { get: vi.mocked(api.get) }

// ── Fixtures ───────────────────────────────────────────────────────────────────

const makeActivity = (overrides: Partial<ProjectActivity> = {}): ProjectActivity => ({
  id: 'a1',
  userName: 'Alice Martin',
  userId: 'u1',
  userRole: 'Admin',
  action: 'created',
  detail: null,
  timestamp: new Date(Date.now() - 60_000).toISOString(),
  projectId: 'p1',
  projectName: 'Projet Alpha',
  projectClientName: 'Client A',
  ...overrides,
})

const defaultStats: ActivityStats = {
  totalToday: 5,
  totalThisWeek: 23,
  mostActiveProject: { id: 'p1', name: 'Projet Alpha', count: 12 },
}

function mockSuccessfulFetch(
  activities: ProjectActivity[] = [makeActivity()],
  stats: ActivityStats = defaultStats,
) {
  mockedAxios.get
    .mockResolvedValueOnce({ data: activities })   // recent-activity
    .mockResolvedValueOnce({ data: stats })         // activity-stats
}

// ── Mount helper ───────────────────────────────────────────────────────────────

async function mountSection(activitiesOverride?: ProjectActivity[], statsOverride?: ActivityStats) {
  mockSuccessfulFetch(activitiesOverride, statsOverride)
  const wrapper = mount(ActivitySection, {
    global: { plugins: [createPinia()] },
  })
  await flushPromises()
  return wrapper
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ActivitySection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Renders activity list ──────────────────────────────────────────────────

  describe('when data is present', () => {
    it('renders an item for each activity', async () => {
      const activities = [
        makeActivity({ id: 'a1', userName: 'Alice Martin' }),
        makeActivity({ id: 'a2', userName: 'Bob Dupont', action: 'updated' }),
      ]
      const wrapper = await mountSection(activities)
      const items = wrapper.findAll('.timeline-item')
      expect(items).toHaveLength(2)
    })

    it('displays the user name in each item', async () => {
      const wrapper = await mountSection([makeActivity({ userName: 'Alice Martin' })])
      expect(wrapper.find('.item-user').text()).toBe('Alice Martin')
    })

    it('displays the project name in each item', async () => {
      const wrapper = await mountSection([makeActivity({ projectName: 'Projet Alpha' })])
      expect(wrapper.find('.item-project').text()).toContain('Projet Alpha')
    })

    it('does not show the empty state', async () => {
      const wrapper = await mountSection()
      expect(wrapper.find('.empty-state').exists()).toBe(false)
    })

    it('renders the stats strip values', async () => {
      const wrapper = await mountSection()
      const strip = wrapper.find('.stats-strip')
      expect(strip.text()).toContain('5')          // totalToday
      expect(strip.text()).toContain('23')         // totalThisWeek
      expect(strip.text()).toContain('Projet Alpha') // mostActiveProject
    })
  })

  // ── Empty state ────────────────────────────────────────────────────────────

  describe('when no activities are returned', () => {
    it('shows the empty state message', async () => {
      const wrapper = await mountSection([])
      expect(wrapper.find('.empty-state').exists()).toBe(true)
      expect(wrapper.find('.empty-state').text()).toContain('Aucune activité récente')
    })

    it('does not render any timeline items', async () => {
      const wrapper = await mountSection([])
      expect(wrapper.findAll('.timeline-item')).toHaveLength(0)
    })
  })

  // ── Filter by action type ──────────────────────────────────────────────────

  describe('filter by action type', () => {
    it('shows only items matching the selected action', async () => {
      const activities = [
        makeActivity({ id: 'a1', action: 'created' }),
        makeActivity({ id: 'a2', action: 'updated' }),
        makeActivity({ id: 'a3', action: 'created' }),
      ]
      const wrapper = await mountSection(activities)

      // Select 'created' filter — first NeoSelect is the action select
      const selects = wrapper.findAll('select')
      await selects[0].setValue('created')
      await selects[0].trigger('change')
      await wrapper.vm.$nextTick()

      expect(wrapper.findAll('.timeline-item')).toHaveLength(2)
    })

    it('shows all items after filter is reset', async () => {
      const activities = [
        makeActivity({ id: 'a1', action: 'created' }),
        makeActivity({ id: 'a2', action: 'updated' }),
      ]
      const wrapper = await mountSection(activities)

      const selects = wrapper.findAll('select')
      await selects[0].setValue('created')
      await selects[0].trigger('change')
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.timeline-item')).toHaveLength(1)

      // Click "Réinitialiser"
      const resetBtn = wrapper.findAll('button').find((b) => b.text() === 'Réinitialiser')
      expect(resetBtn).toBeDefined()
      await resetBtn!.trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.findAll('.timeline-item')).toHaveLength(2)
    })
  })

  // ── Load more ──────────────────────────────────────────────────────────────

  describe('"Charger plus" pagination', () => {
    it('shows at most 20 items initially', async () => {
      const activities = Array.from({ length: 25 }, (_, i) =>
        makeActivity({ id: `a${i}` }),
      )
      const wrapper = await mountSection(activities)
      expect(wrapper.findAll('.timeline-item')).toHaveLength(20)
    })

    it('"Charger plus" button increases visible count by 20', async () => {
      const activities = Array.from({ length: 25 }, (_, i) =>
        makeActivity({ id: `a${i}` }),
      )
      const wrapper = await mountSection(activities)

      const loadBtn = wrapper.findAll('button').find((b) => b.text() === 'Charger plus')
      expect(loadBtn).toBeDefined()
      await loadBtn!.trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.findAll('.timeline-item')).toHaveLength(25)
    })

    it('"Charger plus" button is absent when all items are visible', async () => {
      const activities = Array.from({ length: 5 }, (_, i) =>
        makeActivity({ id: `a${i}` }),
      )
      const wrapper = await mountSection(activities)
      const loadBtn = wrapper.findAll('button').find((b) => b.text() === 'Charger plus')
      expect(loadBtn).toBeUndefined()
    })
  })

  // ── Auto-refresh ───────────────────────────────────────────────────────────

  describe('auto-refresh', () => {
    it('calls the API again after 60 seconds', async () => {
      mockSuccessfulFetch()
      const wrapper = mount(ActivitySection, {
        global: { plugins: [createPinia()] },
      })
      await flushPromises()

      expect(mockedAxios.get).toHaveBeenCalledTimes(2) // initial load: activity + stats

      // Queue next responses before advancing timers
      mockSuccessfulFetch()
      vi.advanceTimersByTime(60_000)
      await flushPromises()

      expect(mockedAxios.get).toHaveBeenCalledTimes(4) // second load
      wrapper.unmount()
    })

    it('clears interval on unmount', async () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
      mockSuccessfulFetch()
      const wrapper = mount(ActivitySection, {
        global: { plugins: [createPinia()] },
      })
      await flushPromises()
      wrapper.unmount()
      expect(clearIntervalSpy).toHaveBeenCalled()
    })
  })

  // ── Error handling ─────────────────────────────────────────────────────────

  describe('when API call fails', () => {
    it('shows an error message', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'))
      const wrapper = mount(ActivitySection, {
        global: { plugins: [createPinia()] },
      })
      await flushPromises()
      expect(wrapper.find('.error-state').exists()).toBe(true)
    })
  })
})
