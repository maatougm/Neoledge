/**
 * @file PMProjectDetail.spec.ts — smoke test for the tabbed project
 * detail panel. The component is tightly coupled to pmStore + many child
 * components — we just verify it imports + exposes the right Vue
 * component shape.
 */
import { describe, it, expect } from 'vitest'
import PMProjectDetail from './PMProjectDetail.vue'

describe('PMProjectDetail', () => {
  it('is a defined Vue component', () => {
    expect(PMProjectDetail).toBeTruthy()
    expect(typeof PMProjectDetail).toBe('object')
  })

  it('exposes a render function', () => {
    const comp = PMProjectDetail as { render?: unknown; setup?: unknown; __name?: string }
    expect(comp.render ?? comp.setup ?? comp.__name).toBeDefined()
  })
})
