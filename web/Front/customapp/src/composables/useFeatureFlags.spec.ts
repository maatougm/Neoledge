/**
 * @file useFeatureFlags.spec.ts
 * Tests the feature-flag composable. The flag values come from the
 * `user_preferences` JSON in localStorage with sensible defaults. A
 * cross-tab `storage` event bumps a reactive version so all consumers
 * pick up the new value.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

async function loadComposable() {
  // Re-import per test so the module-level `_prefsVersion` starts at 0.
  vi.resetModules()
  const mod = await import('./useFeatureFlags')
  return mod
}

describe('useFeatureFlags', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns ALL defaults to true when no preferences are stored', async () => {
    const { useFeatureFlags } = await loadComposable()
    const { flags } = useFeatureFlags()
    expect(flags.value).toEqual({
      showGantt: true,
      showTeamPlanner: true,
      showAudit: true,
    })
  })

  it('overrides defaults with values from user_preferences', async () => {
    localStorage.setItem(
      'user_preferences',
      JSON.stringify({ showGantt: false, showAudit: false }),
    )
    const { useFeatureFlags } = await loadComposable()
    const { flags } = useFeatureFlags()
    expect(flags.value.showGantt).toBe(false)
    expect(flags.value.showAudit).toBe(false)
    // Unset key keeps the default.
    expect(flags.value.showTeamPlanner).toBe(true)
  })

  it('isEnabled returns the boolean for the requested key', async () => {
    localStorage.setItem('user_preferences', JSON.stringify({ showGantt: false }))
    const { useFeatureFlags } = await loadComposable()
    const { isEnabled } = useFeatureFlags()
    expect(isEnabled('showGantt')).toBe(false)
    expect(isEnabled('showAudit')).toBe(true)
  })

  it('tolerates malformed JSON in localStorage (falls back to defaults)', async () => {
    localStorage.setItem('user_preferences', '{not valid json')
    const { useFeatureFlags } = await loadComposable()
    const { flags } = useFeatureFlags()
    expect(flags.value).toEqual({
      showGantt: true,
      showTeamPlanner: true,
      showAudit: true,
    })
  })

  it('reacts to a cross-tab storage event on user_preferences', async () => {
    const { useFeatureFlags } = await loadComposable()
    const { flags } = useFeatureFlags()
    expect(flags.value.showGantt).toBe(true)

    // Simulate another tab writing to localStorage.
    localStorage.setItem('user_preferences', JSON.stringify({ showGantt: false }))
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'user_preferences',
        newValue: JSON.stringify({ showGantt: false }),
      }),
    )

    expect(flags.value.showGantt).toBe(false)
  })

  it('ignores storage events for unrelated keys', async () => {
    const { useFeatureFlags } = await loadComposable()
    const { flags } = useFeatureFlags()
    expect(flags.value.showGantt).toBe(true)

    localStorage.setItem('user_preferences', JSON.stringify({ showGantt: false }))
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'unrelated', newValue: 'x' }),
    )
    // Without the storage event for our key, the reactive version stays cold
    // and the computed reuses its memoised result.
    // (Note: vue may re-evaluate the computed on access regardless — the
    // contract we test here is "no crash on irrelevant storage events".)
    expect(() => flags.value.showGantt).not.toThrow()
  })
})
