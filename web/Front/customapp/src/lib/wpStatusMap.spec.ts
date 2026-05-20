/**
 * @file wpStatusMap.spec.ts — unit tests for the WP status → display mapping.
 */

import { describe, it, expect } from 'vitest'
import { WP_STATUS_MAP, getWpStatus } from './wpStatusMap'

const EXPECTED_STATUSES = [
  'New', 'InProgress', 'AwaitingReview', 'Resolved',
  'Closed', 'OnHold', 'Blocked', 'Rejected',
]

describe('WP_STATUS_MAP', () => {
  it('contains every canonical status', () => {
    for (const s of EXPECTED_STATUSES) {
      expect(WP_STATUS_MAP[s]).toBeDefined()
    }
  })

  it('every entry has label, color, background, severity', () => {
    for (const [key, entry] of Object.entries(WP_STATUS_MAP)) {
      expect(entry.label, key).toBeTruthy()
      expect(entry.color, key).toMatch(/^#[0-9A-F]{6}$/i)
      expect(entry.background, key).toMatch(/^#[0-9A-F]{6}$/i)
      expect(['success', 'info', 'warn', 'danger', 'secondary', 'contrast'])
        .toContain(entry.severity)
    }
  })

  it('uses French labels', () => {
    expect(WP_STATUS_MAP.InProgress.label).toBe('En cours')
    expect(WP_STATUS_MAP.Resolved.label).toBe('Résolu')
    expect(WP_STATUS_MAP.Closed.label).toBe('Clôturé')
    expect(WP_STATUS_MAP.Blocked.label).toBe('Bloqué')
  })

  it('maps terminal statuses to success severity', () => {
    expect(WP_STATUS_MAP.Resolved.severity).toBe('success')
    expect(WP_STATUS_MAP.Closed.severity).toBe('success')
  })

  it('maps danger statuses to danger severity', () => {
    expect(WP_STATUS_MAP.Blocked.severity).toBe('danger')
    expect(WP_STATUS_MAP.Rejected.severity).toBe('danger')
  })
})

describe('getWpStatus', () => {
  it('returns the canonical entry for a known status', () => {
    const entry = getWpStatus('InProgress')
    expect(entry).toEqual(WP_STATUS_MAP.InProgress)
  })

  it('returns a fallback entry for an unknown status, with the raw status as label', () => {
    const entry = getWpStatus('TotallyNewStatus')
    expect(entry.label).toBe('TotallyNewStatus')
    expect(entry.severity).toBe('secondary')
    expect(entry.color).toMatch(/^#[0-9A-F]{6}$/i)
  })

  it('returns distinct objects for known statuses (does not mutate the map)', () => {
    const before = { ...WP_STATUS_MAP.New }
    // calling getWpStatus should not change the underlying entry
    getWpStatus('New')
    expect(WP_STATUS_MAP.New).toEqual(before)
  })
})
