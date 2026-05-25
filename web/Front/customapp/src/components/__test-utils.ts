/**
 * @file __test-utils.ts — Shared helpers for component vitest specs.
 *
 * Provides:
 *  - `neoStubs`: a stubs object covering every NeoLibrary component this
 *    project uses. Stubs are functional Vue components that just slot
 *    their children + forward attrs to a tagged `<div>`, so `find()` /
 *    `text()` / `emit()` work consistently across specs.
 *  - `mountOptions(extra)`: merges Pinia + router-link stub + neoStubs
 *    into the default `mount()` options object.
 *
 * Designed for `@vue/test-utils` v2 + Vitest + Pinia. Specs use it like:
 *
 *   import { mount } from '@vue/test-utils'
 *   import { mountOptions } from '../__test-utils'
 *   const w = mount(MyComponent, mountOptions({ props: { foo: 'bar' } }))
 */

import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

/** Build a generic stub that emits `event` when clicked, slots its children,
 *  and re-emits any v-model'd `update:visible` etc. as a regular emit. */
function passthroughStub(tagName: string, emits: string[] = []) {
  return defineComponent({
    name: tagName,
    inheritAttrs: false,
    emits,
    setup(_, { slots, attrs, emit }) {
      return () =>
        h(
          'div',
          {
            'data-stub': tagName,
            ...attrs,
            onClick: (ev: Event) => {
              ;(attrs.onClick as ((e: Event) => void) | undefined)?.(ev)
              if (emits.includes('click')) emit('click', ev)
            },
          },
          [
            slots.default?.(),
            slots.footer?.() && h('div', { 'data-slot': 'footer' }, [slots.footer()]),
          ],
        )
    },
  })
}

const neoStubs: Record<string, unknown> = {
  // Buttons / form controls
  NeoButton:    passthroughStub('NeoButton', ['click']),
  NeoInput:     passthroughStub('NeoInput', ['update:modelValue']),
  NeoTextarea:  passthroughStub('NeoTextarea', ['update:modelValue']),
  NeoSelect:    passthroughStub('NeoSelect', ['update:modelValue']),
  NeoCheckbox:  passthroughStub('NeoCheckbox', ['update:modelValue']),
  NeoSwitch:    passthroughStub('NeoSwitch', ['update:modelValue']),
  NeoSlider:    passthroughStub('NeoSlider', ['update:modelValue']),
  NeoDatePicker: passthroughStub('NeoDatePicker', ['update:modelValue']),
  NeoFileUpload: passthroughStub('NeoFileUpload', ['upload', 'select']),

  // Display
  NeoTag:       passthroughStub('NeoTag'),
  NeoMessage:   passthroughStub('NeoMessage', ['close']),
  NeoProgressBar: passthroughStub('NeoProgressBar'),
  NeoCard:      passthroughStub('NeoCard'),
  NeoDialog:    passthroughStub('NeoDialog', ['update:visible']),
  NeoDataTable: passthroughStub('NeoDataTable'),
  NeoColumn:    passthroughStub('NeoColumn'),
  NeoMenu:      passthroughStub('NeoMenu'),
  NeoTabs:      passthroughStub('NeoTabs', ['update:activeTab']),
  NeoTab:       passthroughStub('NeoTab'),
  NeoToast:     passthroughStub('NeoToast'),
  NeoTooltip:   passthroughStub('NeoTooltip'),

  // Router stubs
  'router-link': passthroughStub('router-link'),
  'router-view': passthroughStub('router-view'),
}

export interface MountExtraOptions {
  props?: Record<string, unknown>
  attrs?: Record<string, unknown>
  slots?: Record<string, unknown>
  global?: {
    stubs?: Record<string, unknown>
    plugins?: unknown[]
    mocks?: Record<string, unknown>
    provide?: Record<string | symbol, unknown>
  }
}

/** Activate a fresh Pinia store for each test. Call from beforeEach. */
export function initPinia(): void {
  setActivePinia(createPinia())
}

/** Build mount() options with NeoLibrary stubs + router mocks merged in.
 *  Caller-supplied stubs / mocks override defaults. Note: assumes
 *  `setActivePinia(createPinia())` was already called (via `initPinia()`
 *  in a beforeEach hook) — Pinia stores resolve via the active instance. */
export function mountOptions(extra: MountExtraOptions = {}): Record<string, unknown> {
  return {
    props: extra.props ?? {},
    attrs: extra.attrs ?? {},
    slots: extra.slots ?? {},
    global: {
      plugins: [...(extra.global?.plugins ?? [])],
      stubs: { ...neoStubs, ...(extra.global?.stubs ?? {}) },
      mocks: {
        $router: { push: vi.fn(), replace: vi.fn(), getRoutes: () => [] },
        $route: { params: {}, query: {}, fullPath: '/', name: 'home' },
        ...(extra.global?.mocks ?? {}),
      },
      provide: extra.global?.provide ?? {},
    },
  }
}

import { vi } from 'vitest'
