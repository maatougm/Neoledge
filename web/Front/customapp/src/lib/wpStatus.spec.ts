/**
 * @file wpStatus.spec.ts — unit tests for the WP terminal-status check.
 */

import { describe, it, expect } from 'vitest'
import { TERMINAL_WP_STATUSES, isTerminal } from './wpStatus'

describe('TERMINAL_WP_STATUSES', () => {
  it('is a frozen tuple of the canonical terminal statuses', () => {
    expect([...TERMINAL_WP_STATUSES]).toEqual(['Resolved', 'Closed'])
  })
})

describe('isTerminal', () => {
  it('returns true for Resolved', () => {
    expect(isTerminal('Resolved')).toBe(true)
  })

  it('returns true for Closed', () => {
    expect(isTerminal('Closed')).toBe(true)
  })

  it('returns false for non-terminal statuses', () => {
    for (const s of ['New', 'InProgress', 'AwaitingReview', 'OnHold', 'Blocked', 'Rejected']) {
      expect(isTerminal(s)).toBe(false)
    }
  })

  it('returns false for null / undefined / empty', () => {
    expect(isTerminal(null)).toBe(false)
    expect(isTerminal(undefined)).toBe(false)
    expect(isTerminal('')).toBe(false)
  })

  it('is case-sensitive (does NOT treat "closed" as terminal)', () => {
    expect(isTerminal('closed')).toBe(false)
    expect(isTerminal('RESOLVED')).toBe(false)
  })
})
