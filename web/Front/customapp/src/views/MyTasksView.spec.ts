/**
 * @file MyTasksView.spec.ts — smoke import test. Full render requires router +
 * many store mocks; verifying the module parses + exposes a Vue component
 * is the minimum useful coverage.
 */
import { describe, it, expect } from 'vitest'
import View from './MyTasksView.vue'

describe('MyTasksView', () => {
  it('is a defined Vue component', () => {
    expect(View).toBeTruthy()
    expect(typeof View).toBe('object')
  })

  it('exposes a render/setup function', () => {
    const comp = View as { render?: unknown; setup?: unknown; __name?: string }
    expect(comp.render ?? comp.setup ?? comp.__name).toBeDefined()
  })
})
