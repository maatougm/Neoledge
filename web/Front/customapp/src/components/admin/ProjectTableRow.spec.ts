/**
 * @file ProjectTableRow.spec.ts — single row in the admin projects table.
 * Pure component (props in / emits out), no store. Covers: name click,
 * checkbox toggle, action menu emits, status-badge mapping, progress bar
 * style, initials, missing-PM "Assigner" button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectTableRow from './ProjectTableRow.vue'
import type { ProjectSummary, ProjectStatus } from '@/types/project.types'

vi.mock('@neolibrary/components', async () => {
  const { defineComponent, h } = await import('vue')
  const pass = (name: string, tag = 'button') =>
    defineComponent({
      name, inheritAttrs: false, emits: ['click'],
      props: { label: String, icon: String, title: String },
      setup(props, { slots, attrs, emit }) {
        return () => h(tag, {
          ...attrs,
          'data-stub': name,
          title: props.title,
          onClick: (e: MouseEvent) => emit('click', e),
        }, slots.default ? slots.default() : (props.label ?? props.title ?? ''))
      },
    })
  return { NeoButton: pass('NeoButton') }
})

function makeProject(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'p1',
    name: 'Projet Alpha',
    clientName: 'ACME',
    projectManagerName: 'Marie Curie',
    projectManagerEmail: 'marie@example.com',
    status: 'Kickoff' as ProjectStatus,
    startDate: '2026-04-01',
    endDate: '2026-06-01',
    createdAt: '2026-03-01T00:00:00Z',
    ...over,
  }
}

function mountRow(over: Partial<{ project: ProjectSummary; selected: boolean; progress: number }> = {}) {
  return mount(ProjectTableRow, {
    props: { project: makeProject(over.project ?? {}), selected: over.selected ?? false, progress: over.progress ?? 0 },
  })
}

describe('ProjectTableRow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the project name + client', () => {
    const w = mountRow({ project: makeProject({ name: 'X', clientName: 'Y' }) })
    expect(w.text()).toContain('X')
    expect(w.text()).toContain('Y')
  })

  it('emits toggle-select when checkbox changes', async () => {
    const w = mountRow()
    await w.find('input[type=checkbox]').trigger('change')
    expect(w.emitted('toggle-select')).toBeTruthy()
  })

  it('emits view when the name cell is clicked', async () => {
    const w = mountRow()
    const nameCell = w.findAll('td').find((td) => td.classes('ptr__name'))
    await nameCell?.trigger('click')
    expect(w.emitted('view')).toBeTruthy()
  })

  it('shows "Assigner" button when projectManagerName is missing', () => {
    const w = mountRow({ project: makeProject({ projectManagerName: null as unknown as string }) })
    expect(w.text()).toContain('Assigner')
  })

  it('shows PM initials when projectManagerName is set', () => {
    const w = mountRow({ project: makeProject({ projectManagerName: 'Jane Doe' }) })
    expect(w.text()).toContain('JD')
  })

  it('shows em-dash when progress is 0', () => {
    const w = mountRow({ progress: 0 })
    expect(w.text()).toContain('—')
  })

  it('shows progress bar + label when progress > 0', () => {
    const w = mountRow({ progress: 65 })
    expect(w.text()).toContain('65%')
    expect(w.find('.ptr__progress-fill').exists()).toBe(true)
  })

  it('applies the right CSS class per status', () => {
    const draft = mountRow({ project: makeProject({ status: 'Draft' as ProjectStatus }) })
    expect(draft.find('.ptr__badge--draft').exists()).toBe(true)
    const cloture = mountRow({ project: makeProject({ status: 'Cloture' as ProjectStatus }) })
    expect(cloture.find('.ptr__badge--completed').exists()).toBe(true)
  })

  it('applies the selected modifier when selected', () => {
    const w = mountRow({ selected: true })
    expect(w.find('tr').classes()).toContain('ptr--selected')
  })

  it('formats date as fr-FR locale string', () => {
    const w = mountRow({ project: makeProject({ startDate: '2026-06-15' }) })
    expect(w.text()).toMatch(/(juin|juin)/i)
  })
})
