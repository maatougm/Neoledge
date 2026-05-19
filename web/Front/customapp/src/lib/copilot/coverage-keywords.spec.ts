/**
 * @file coverage-keywords.spec.ts — sanity tests for the keyword dictionary
 *  that drives the live-copilot coverage engine.
 *
 *  Pure data; tests lock in the 9-section shape and a few sentinel keywords
 *  so an accidental rename / deletion gets caught by CI.
 */

import { describe, it, expect } from 'vitest'
import { COVERAGE_KEYWORDS, COVERAGE_KEYWORD_THRESHOLD } from './coverage-keywords'

const REQUIRED_SECTIONS = [
  'objectifDocument', 'contexte', 'objectifProjet',
  'perimetreInclus', 'perimetreExclus', 'exigencesFonctionnelles',
  'architectureTechnique', 'livrables', 'conclusion',
] as const

describe('COVERAGE_KEYWORDS', () => {
  it('defines exactly the 9 cahier sections', () => {
    expect(Object.keys(COVERAGE_KEYWORDS).sort()).toEqual([...REQUIRED_SECTIONS].sort())
  })

  it('every section has at least COVERAGE_KEYWORD_THRESHOLD keywords (otherwise it can never be flagged)', () => {
    for (const section of REQUIRED_SECTIONS) {
      const kws = COVERAGE_KEYWORDS[section]
      expect(kws.length, section).toBeGreaterThanOrEqual(COVERAGE_KEYWORD_THRESHOLD)
    }
  })

  it('contains expected sentinel French keywords', () => {
    expect(COVERAGE_KEYWORDS.contexte).toContain('contexte')
    expect(COVERAGE_KEYWORDS.perimetreInclus).toContain('inclus')
    expect(COVERAGE_KEYWORDS.perimetreExclus).toContain('exclus')
    expect(COVERAGE_KEYWORDS.livrables).toContain('livrable')
    expect(COVERAGE_KEYWORDS.architectureTechnique).toContain('architecture')
  })

  it('every keyword is a non-empty lowercase string', () => {
    for (const section of REQUIRED_SECTIONS) {
      for (const kw of COVERAGE_KEYWORDS[section]) {
        expect(typeof kw, section).toBe('string')
        expect(kw.length, section).toBeGreaterThan(0)
        expect(kw.toLowerCase(), section).toBe(kw)
      }
    }
  })
})

describe('COVERAGE_KEYWORD_THRESHOLD', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(COVERAGE_KEYWORD_THRESHOLD)).toBe(true)
    expect(COVERAGE_KEYWORD_THRESHOLD).toBeGreaterThan(0)
  })

  it('is exactly 2 (current contract)', () => {
    // If we change this, also update the engine spec.
    expect(COVERAGE_KEYWORD_THRESHOLD).toBe(2)
  })
})
