/**
 * @file stubs.ts — shared global-stub registry for admin component tests.
 *
 * NeoLibrary components are not in the unit-test dependency graph (they
 * mount real PrimeVue, which needs full app context); each spec stubs
 * them globally via this exported map. RouterLink and Teleport are
 * stubbed too so we don't need a real router or DOM portal during tests.
 */
import { defineComponent, h } from 'vue'

/** Quick passthrough stub: renders default slot, forwards click as `click`
 *  event so tests can `wrapper.find(...).trigger('click')`. */
function passthrough(name: string, tag = 'div'): ReturnType<typeof defineComponent> {
  return defineComponent({
    name,
    inheritAttrs: false,
    emits: ['click', 'update:modelValue', 'update:visible', 'change', 'input'],
    props: { label: { type: String, default: '' } },
    setup(props, { slots, attrs, emit }) {
      return () =>
        h(
          tag,
          {
            ...attrs,
            class: `stub-${name.toLowerCase()}`,
            onClick: (e: MouseEvent) => emit('click', e),
          },
          slots.default ? slots.default() : props.label,
        )
    },
  })
}

/** v-model-aware stub for input-like components. */
function inputStub(name: string, type = 'text') {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: {
      modelValue: { type: [String, Number, Boolean, Object, Array], default: '' },
      label: { type: String, default: '' },
      placeholder: { type: String, default: '' },
      error: { type: String, default: '' },
      options: { type: Array, default: () => [] },
    },
    emits: ['update:modelValue', 'change', 'input'],
    setup(props, { emit, attrs }) {
      return () =>
        h('div', { class: `stub-${name.toLowerCase()}` }, [
          h('label', {}, props.label || ''),
          h('input', {
            ...attrs,
            type,
            value: props.modelValue,
            placeholder: props.placeholder,
            onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value),
          }),
          props.error ? h('span', { class: 'error' }, props.error) : null,
        ])
    },
  })
}

export const NEO_LIBRARY_STUBS = {
  NeoButton: passthrough('NeoButton', 'button'),
  NeoTag: passthrough('NeoTag', 'span'),
  NeoMessage: passthrough('NeoMessage', 'div'),
  NeoCheckbox: inputStub('NeoCheckbox', 'checkbox'),
  NeoDropdown: inputStub('NeoDropdown'),
  NeoMultiSelect: inputStub('NeoMultiSelect'),
  NeoSelect: inputStub('NeoSelect'),
  NeoCalendar: inputStub('NeoCalendar', 'date'),
  NeoDatePicker: inputStub('NeoDatePicker', 'date'),
  NeoChips: inputStub('NeoChips'),
  NeoInputText: inputStub('NeoInputText'),
  NeoInputNumber: inputStub('NeoInputNumber', 'number'),
  NeoInputIcon: inputStub('NeoInputIcon'),
  NeoPassword: inputStub('NeoPassword', 'password'),
  NeoTextarea: inputStub('NeoTextarea'),
  NeoDialog: passthrough('NeoDialog'),
  NeoTabPanel: passthrough('NeoTabPanel'),
  NeoTabView: passthrough('NeoTabView'),
  NeoSplitButton: passthrough('NeoSplitButton', 'button'),
  NeoToolbar: passthrough('NeoToolbar'),
  NeoChip: passthrough('NeoChip', 'span'),
  NeoConfirmDialog: passthrough('NeoConfirmDialog'),
  NeoToast: passthrough('NeoToast'),
  NeoDataTable: passthrough('NeoDataTable', 'table'),
  NeoDataView: passthrough('NeoDataView'),
  NeoColumn: passthrough('NeoColumn'),
  AppModal: defineComponent({
    name: 'AppModal',
    props: { visible: Boolean, header: String, width: String },
    emits: ['update:visible'],
    setup(props, { slots }) {
      return () =>
        props.visible
          ? h('div', { class: 'stub-appmodal' }, [
              h('header', {}, props.header || ''),
              h('main', {}, slots.default ? slots.default() : []),
              h('footer', {}, slots.footer ? slots.footer() : []),
            ])
          : null
    },
  }),
  RouterLink: defineComponent({
    name: 'RouterLink',
    props: { to: { type: [String, Object], required: true } },
    setup(props, { slots }) {
      const href = typeof props.to === 'string' ? props.to : JSON.stringify(props.to)
      return () => h('a', { href, class: 'stub-routerlink' }, slots.default ? slots.default() : [])
    },
  }),
  RouterView: passthrough('RouterView'),
  Teleport: defineComponent({
    name: 'TeleportStub',
    props: { to: { type: String, default: 'body' } },
    setup(_, { slots }) {
      // Render inline instead of teleporting so tests can find content.
      return () => h('div', { class: 'stub-teleport' }, slots.default ? slots.default() : [])
    },
  }),
  Transition: defineComponent({
    name: 'TransitionStub',
    setup(_, { slots }) {
      return () => (slots.default ? slots.default() : null)
    },
  }),
}

export const NEO_TOAST_MOCK = { add: () => undefined }
export const NEO_CONFIRM_MOCK = {
  require: (cfg: { accept?: () => unknown }) => {
    if (typeof cfg.accept === 'function') void cfg.accept()
  },
}
