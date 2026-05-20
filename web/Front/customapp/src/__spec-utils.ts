/**
 * @file __spec-utils.ts — shared mocks + stubs for the fast smoke specs
 * written during the frontend coverage push.
 *
 * NOT used by the existing specs in `components/admin/__test-helpers__/`
 * or `views/__test-helpers.ts` — those each have their own factories.
 * This file is for the simple smoke specs that just need a passable
 * NeoLibrary stub + axios mock so the component can mount.
 *
 * Usage:
 *   vi.mock('@/lib/api', () => ({ default: makeApiMock(), extractErrorMessage: (e: unknown) => null }))
 *   vi.mock('@neolibrary/components', () => makeNeolibMock())
 *
 *   // In each it/beforeEach:
 *   setupAuth('Admin')
 */

import { defineComponent, h, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { vi } from 'vitest'

export function makeApiMock(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  }
}

function pass(name: string, tag = 'div'): Component {
  return defineComponent({
    name,
    inheritAttrs: false,
    emits: ['click', 'update:modelValue', 'update:visible', 'change', 'input'],
    props: {
      label: String,
      modelValue: [String, Number, Boolean, Object, Array],
      options: { type: Array, default: () => [] },
      disabled: Boolean,
      loading: Boolean,
      visible: Boolean,
      severity: String,
      icon: String,
      outlined: Boolean,
      placeholder: String,
      header: String,
      title: String,
      value: { type: [String, Number, Boolean, Object], default: '' },
    },
    setup(props, { slots, attrs, emit }) {
      return () => {
        if (name === 'NeoDialog' || name === 'AppModal') {
          if (!props.visible) return null
        }
        return h(
          tag,
          {
            ...attrs,
            'data-stub': name,
            onClick: (e: MouseEvent) => emit('click', e),
          },
          [
            slots.default ? slots.default() : (props.label ?? ''),
            slots.footer ? h('div', { 'data-slot': 'footer' }, slots.footer()) : null,
          ],
        )
      }
    },
  })
}

const neoToastAdd = vi.fn()
const neoConfirmRequire = vi.fn((cfg: { accept?: () => void }) => cfg.accept?.())

export function makeNeolibMock(): Record<string, unknown> {
  return {
    NeoButton: pass('NeoButton', 'button'),
    NeoTag: pass('NeoTag', 'span'),
    NeoMessage: pass('NeoMessage'),
    NeoCheckbox: pass('NeoCheckbox', 'input'),
    NeoDropdown: pass('NeoDropdown'),
    NeoMultiSelect: pass('NeoMultiSelect'),
    NeoSelect: pass('NeoSelect'),
    NeoCalendar: pass('NeoCalendar', 'input'),
    NeoDatePicker: pass('NeoDatePicker', 'input'),
    NeoChips: pass('NeoChips'),
    NeoInputText: pass('NeoInputText', 'input'),
    NeoInputNumber: pass('NeoInputNumber', 'input'),
    NeoInputIcon: pass('NeoInputIcon', 'input'),
    NeoPassword: pass('NeoPassword', 'input'),
    NeoTextarea: pass('NeoTextarea', 'textarea'),
    NeoDialog: pass('NeoDialog'),
    NeoTabPanel: pass('NeoTabPanel'),
    NeoTabView: pass('NeoTabView'),
    NeoSplitButton: pass('NeoSplitButton', 'button'),
    NeoToolbar: pass('NeoToolbar'),
    NeoChip: pass('NeoChip', 'span'),
    NeoConfirmDialog: pass('NeoConfirmDialog'),
    NeoToast: pass('NeoToast'),
    NeoDataTable: pass('NeoDataTable', 'table'),
    NeoDataView: pass('NeoDataView'),
    NeoColumn: pass('NeoColumn'),
    NeoCard: pass('NeoCard'),
    NeoSkeleton: pass('NeoSkeleton'),
    NeoSlider: pass('NeoSlider', 'input'),
    NeoSwitch: pass('NeoSwitch', 'input'),
    NeoFileUpload: pass('NeoFileUpload'),
    NeoProgressBar: pass('NeoProgressBar'),
    NeoMenu: pass('NeoMenu'),
    NeoTabs: pass('NeoTabs'),
    NeoTab: pass('NeoTab'),
    NeoTooltip: pass('NeoTooltip'),
    useNeoToast: () => ({ add: neoToastAdd }),
    useNeoConfirm: () => ({ require: neoConfirmRequire }),
  }
}

export const stubs: Record<string, Component> = {
  AppModal: defineComponent({
    name: 'AppModal',
    props: ['visible', 'header', 'width'],
    emits: ['update:visible'],
    setup(props, { slots }) {
      return () =>
        props.visible
          ? h('div', { 'data-stub': 'AppModal' }, [
              h('header', {}, props.header || ''),
              slots.default ? slots.default() : null,
              slots.footer ? h('footer', {}, slots.footer()) : null,
            ])
          : null
    },
  }),
  AppSkeleton: { template: '<div data-stub="AppSkeleton"></div>' },
  AppSearchModal: { props: ['visible'], template: '<div v-if="visible" data-stub="AppSearchModal"></div>' },
  RouterLink: {
    name: 'RouterLink',
    props: { to: { type: [String, Object], required: false, default: '' } },
    template: '<a><slot /></a>',
  },
  RouterView: { template: '<div data-stub="RouterView"></div>' },
  Teleport: { props: { to: { default: 'body' } }, template: '<div><slot /></div>' },
}

export const allStubs = stubs

/** Initialise Pinia. Call inside beforeEach. */
export function initPinia(): void {
  setActivePinia(createPinia())
}

/** Drive the auth store via the JWT helper module (the store's userRole/userId
 *  are computeds off the JWT). Tests must `vi.mock('@/lib/jwt', ...)` first
 *  using `makeJwtMock()` below. */
export interface JwtState {
  role: string | null
  id: string | null
  fullName: string
  initials: string
  expired: boolean
}

export function makeJwtMock(state: JwtState) {
  return {
    getUserRole: () => state.role,
    getUserFullName: () => state.fullName,
    getUserInitials: () => state.initials,
    getUserId: () => state.id,
    isTokenExpired: () => state.expired,
  }
}

export const toastAdd = neoToastAdd
export const confirmRequire = neoConfirmRequire
