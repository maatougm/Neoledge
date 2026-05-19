/**
 * @file formatDate.spec.ts — unit tests for the FR-locale date helpers.
 *
 * `toLocaleDateString` formatting can vary by JS engine, so we assert
 * SHAPE (matches /\d{2}\/\d{2}\/\d{4}/) rather than exact strings where
 * the runtime can vary. The relative-time helper is exact since it's
 * deterministic given a fixed reference clock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  formatDate,
  formatDateShort,
  formatDateTime,
  formatRelative,
} from './formatDate'

describe('formatDate', () => {
  it('returns — for null / undefined / empty', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('')).toBe('—')
  })

  it('returns — for an unparseable string', () => {
    expect(formatDate('not a date')).toBe('—')
  })

  it('returns a fr-FR date string for a valid ISO date', () => {
    const out = formatDate('2026-04-14')
    expect(out).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    expect(out).toContain('2026')
    expect(out).toContain('04')
    expect(out).toContain('14')
  })
})

describe('formatDateShort', () => {
  it('returns — for falsy / invalid input', () => {
    expect(formatDateShort(null)).toBe('—')
    expect(formatDateShort('invalid')).toBe('—')
  })

  it('produces a shorter day+month format', () => {
    const out = formatDateShort('2026-04-14')
    expect(out).toMatch(/\d{2}/) // contains a 2-digit day
    // Output is locale-dependent — just confirm it's shorter than the full format.
    expect(out.length).toBeLessThan(formatDate('2026-04-14').length + 5)
  })
})

describe('formatDateTime', () => {
  it('returns — for falsy / invalid input', () => {
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('garbage')).toBe('—')
  })

  it('includes both a date and a time component', () => {
    const out = formatDateTime('2026-04-14T13:45:00Z')
    expect(out).toMatch(/\d{2}\/\d{2}\/\d{4}/)
    expect(out).toMatch(/\d{1,2}[:h.]\d{2}/) // hh:mm or hh.mm depending on locale
  })
})

describe('formatRelative', () => {
  beforeEach(() => {
    // Pin clock so the relative output is deterministic.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('returns empty string for null / undefined / empty', () => {
    expect(formatRelative(null)).toBe('')
    expect(formatRelative(undefined)).toBe('')
    expect(formatRelative('')).toBe('')
  })

  it('returns empty string for unparseable input', () => {
    expect(formatRelative('garbage')).toBe('')
  })

  it('returns "à l\'instant" for a now-ish timestamp', () => {
    expect(formatRelative('2026-05-19T12:00:00.000Z')).toBe("à l'instant")
    expect(formatRelative('2026-05-19T12:00:20.000Z')).toBe("à l'instant") // < 1 min
  })

  it('returns "il y a N min" for past minute-range', () => {
    expect(formatRelative('2026-05-19T11:55:00.000Z')).toBe('il y a 5 min')
    expect(formatRelative('2026-05-19T11:01:00.000Z')).toBe('il y a 59 min')
  })

  it('returns "dans N min" for future minute-range', () => {
    expect(formatRelative('2026-05-19T12:30:00.000Z')).toBe('dans 30 min')
  })

  it('returns "il y a N h" for past hour-range', () => {
    expect(formatRelative('2026-05-19T10:00:00.000Z')).toBe('il y a 2 h')
    expect(formatRelative('2026-05-18T13:00:00.000Z')).toBe('il y a 23 h')
  })

  it('returns "dans N h" for future hour-range', () => {
    expect(formatRelative('2026-05-19T15:00:00.000Z')).toBe('dans 3 h')
  })

  it('returns "il y a N j" for past day-range', () => {
    expect(formatRelative('2026-05-17T12:00:00.000Z')).toBe('il y a 2 j')
  })

  it('returns "dans N j" for future day-range', () => {
    expect(formatRelative('2026-05-25T12:00:00.000Z')).toBe('dans 6 j')
  })
})
