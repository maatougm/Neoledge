/**
 * @file ProjectBulkToolbar.spec.ts — toolbar shown when 1+ projects are
 * selected. Pure-emit component (no store, no API). Coverage focuses on
 * the conditional plural string + the emit guards on the two confirm
 * buttons (don't fire when local select is empty).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectBulkToolbar from './ProjectBulkToolbar.vue'
import { NEO_LIBRARY_STUBS } from './__test-helpers__/stubs'

vi.mock('@neolibrary/components', async () => {
  const { defineComponent, h } = await import('vue')
  const pass = (name: string, tag = 'div') =>
    defineComponent({
      name,
      inheritAttrs: false,
      emits: ['click', 'update:modelValue'],
      props: { label: String, modelValue: [String, Number, Boolean, Object, Array] },
      setup(props, { slots, attrs, emit }) {
        return () =>
          h(tag, { ...attrs, onClick: (e: MouseEvent) => emit('click', e) },
            slots.default ? slots.default() : (props.label ?? ''))
      },
    })
  return {
    NeoButton: pass('NeoButton', 'button'),
    NeoSelect: pass('NeoSelect', 'div'),
    NeoTag: pass('NeoTag', 'span'),
    NeoMessage: pass('NeoMessage', 'div'),
    NeoInputText: pass('NeoInputText', 'input'),
    NeoInputIcon: pass('NeoInputIcon', 'input'),
    NeoInputNumber: pass('NeoInputNumber', 'input'),
    NeoPassword: pass('NeoPassword', 'input'),
    NeoDatePicker: pass('NeoDatePicker', 'input'),
    NeoCalendar: pass('NeoCalendar', 'input'),
    NeoCheckbox: pass('NeoCheckbox', 'input'),
    NeoDropdown: pass('NeoDropdown', 'div'),
    NeoMultiSelect: pass('NeoMultiSelect', 'div'),
    NeoChips: pass('NeoChips', 'div'),
    NeoTextarea: pass('NeoTextarea', 'textarea'),
    NeoDialog: pass('NeoDialog', 'div'),
    NeoTabPanel: pass('NeoTabPanel', 'div'),
    NeoTabView: pass('NeoTabView', 'div'),
    NeoSplitButton: pass('NeoSplitButton', 'button'),
    NeoToolbar: pass('NeoToolbar', 'div'),
    NeoChip: pass('NeoChip', 'span'),
    NeoConfirmDialog: pass('NeoConfirmDialog', 'div'),
    NeoToast: pass('NeoToast', 'div'),
    NeoDataTable: pass('NeoDataTable', 'table'),
    NeoDataView: pass('NeoDataView', 'div'),
    NeoColumn: pass('NeoColumn', 'th'),
    useNeoToast: () => ({ add: () => undefined }),
    useNeoConfirm: () => ({ require: (cfg: { accept?: () => void }) => cfg.accept?.() }),
  }
})

const baseProps = {
  selectedCount: 3,
  loading: false,
  statusOptions: [{ label: 'Brouillon', value: 'Draft' }],
  pmOptions: [{ label: 'Alice', value: 'u-1' }],
}

function mountTb(overrides: Partial<typeof baseProps> = {}) {
  return mount(ProjectBulkToolbar, {
    props: { ...baseProps, ...overrides },
    global: { stubs: NEO_LIBRARY_STUBS },
  })
}

describe('ProjectBulkToolbar', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the count with French plural', () => {
    const w = mountTb({ selectedCount: 3 })
    expect(w.text()).toContain('3 projets sélectionnés')
  })

  it('renders singular when exactly 1 selected', () => {
    const w = mountTb({ selectedCount: 1 })
    expect(w.text()).toContain('1 projet sélectionné')
    expect(w.text()).not.toContain('projets sélectionnés')
  })

  it('emits archive when Archiver is clicked', async () => {
    const w = mountTb()
    const archiveBtn = w.findAll('button').find((b) => b.text().includes('Archiver'))
    await archiveBtn?.trigger('click')
    expect(w.emitted('archive')).toBeTruthy()
  })

  it('emits clear when Désélectionner is clicked', async () => {
    const w = mountTb()
    const clearBtn = w.findAll('button').find((b) => b.text().includes('Désélectionner'))
    await clearBtn?.trigger('click')
    expect(w.emitted('clear')).toBeTruthy()
  })

  it('does NOT emit set-status when local status is empty', async () => {
    const w = mountTb()
    // localStatus starts as '' → calling emitStatus() should bail.
    // Simulate by invoking the component method directly through the
    // confirm button; with no value selected, no emit fires.
    const w2 = w as unknown as { vm: { emitStatus: () => void } }
    w2.vm.emitStatus()
    expect(w.emitted('set-status')).toBeUndefined()
  })

  it('emits set-status with the selected status when confirmed', async () => {
    const w = mountTb()
    const w2 = w as unknown as {
      vm: { localStatus: string; emitStatus: () => void }
    }
    w2.vm.localStatus = 'Draft'
    w2.vm.emitStatus()
    expect(w.emitted('set-status')).toEqual([['Draft']])
    // Local state cleared after emit.
    expect(w2.vm.localStatus).toBe('')
  })

  it('emits assign-manager with the selected manager when confirmed', async () => {
    const w = mountTb()
    const w2 = w as unknown as {
      vm: { localManager: string; emitManager: () => void }
    }
    w2.vm.localManager = 'u-1'
    w2.vm.emitManager()
    expect(w.emitted('assign-manager')).toEqual([['u-1']])
    expect(w2.vm.localManager).toBe('')
  })
})
