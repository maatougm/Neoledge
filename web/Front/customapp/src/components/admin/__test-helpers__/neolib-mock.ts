/**
 * @file neolib-mock.ts — factory used inside vi.mock('@neolibrary/components', ...)
 * Vitest's `vi.mock` is hoisted, so the factory function must be self-contained
 * (no top-level imports). This module exports the factory but each spec MUST
 * call it inline like `vi.mock('@neolibrary/components', neolibMockFactory)`.
 */

// NOTE: vitest hoists vi.mock above all imports. The factory body must
// not reference module-scope identifiers — every spec inlines the same
// factory body. This file is documentation; the actual factory is
// duplicated per-spec by design.
export const NEOLIB_MOCK_FACTORY_SOURCE = `() => {
  const { defineComponent, h } = require('vue');
  const pass = (name, tag = 'div') =>
    defineComponent({
      name, inheritAttrs: false,
      emits: ['click', 'update:modelValue', 'update:visible'],
      props: { label: String, modelValue: [String, Number, Boolean, Object, Array] },
      setup(props, { slots, attrs, emit }) {
        return () => h(tag, { ...attrs, onClick: (e) => emit('click', e) },
          slots.default ? slots.default() : (props.label ?? ''));
      },
    });
  return { /* ... see ProjectBulkToolbar.spec.ts for the full map */ };
}`
