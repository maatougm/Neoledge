/**
 * @file coverage-engine.spec.ts — unit tests for computeCoverage.
 *
 * The engine is pure: input is (transcript, drivers, emittedSections),
 * output is { cahierCoveragePct, sectionsTouched, driversAnswered, driversTotal }.
 *
 * Each section becomes "touched" if either:
 *   - it appears in emittedSections, OR
 *   - the transcript contains ≥ COVERAGE_KEYWORD_THRESHOLD distinct keywords
 *     for that section (threshold = 2).
 */

import { describe, it, expect } from 'vitest'
import { computeCoverage } from './coverage-engine'

describe('computeCoverage — empty inputs', () => {
  it('returns 0% coverage when transcript empty and nothing emitted', () => {
    const r = computeCoverage('', [], [])
    expect(r.cahierCoveragePct).toBe(0)
    expect(r.sectionsTouched).toEqual([])
    expect(r.driversAnswered).toBe(0)
    expect(r.driversTotal).toBe(0)
  })

  it('handles falsy transcript', () => {
    const r = computeCoverage(null as unknown as string, [], [])
    expect(r.cahierCoveragePct).toBe(0)
  })
})

describe('computeCoverage — emitted sections', () => {
  it('any emitted section is immediately touched (no keyword needed)', () => {
    const r = computeCoverage('', [], ['contexte'])
    expect(r.sectionsTouched).toContain('contexte')
    // 1 of 9 sections → ~11%
    expect(r.cahierCoveragePct).toBe(Math.round((1 / 9) * 100))
  })

  it('multiple emitted sections add together', () => {
    const r = computeCoverage('', [], ['contexte', 'livrables', 'conclusion'])
    expect(r.sectionsTouched).toHaveLength(3)
    expect(r.cahierCoveragePct).toBe(Math.round((3 / 9) * 100))
  })

  it('emitted sections are deduped via the underlying Set', () => {
    const r = computeCoverage('', [], ['contexte', 'contexte'])
    expect(r.sectionsTouched).toHaveLength(1)
  })
})

describe('computeCoverage — keyword matching (threshold = 2)', () => {
  it('a single keyword hit is not enough', () => {
    const r = computeCoverage('parlons contexte', [], [])
    expect(r.sectionsTouched).toEqual([])
  })

  it('two distinct keywords on a section flag it touched', () => {
    // 'contexte' keyword list contains 'contexte' + 'situation actuelle'
    const r = computeCoverage('le contexte et la situation actuelle', [], [])
    expect(r.sectionsTouched).toContain('contexte')
  })

  it('keyword match is case-insensitive', () => {
    const r = computeCoverage('CONTEXTE et SITUATION ACTUELLE en majuscules', [], [])
    expect(r.sectionsTouched).toContain('contexte')
  })

  it('multiple sections can be touched in one transcript', () => {
    const transcript = `
      le contexte et la situation actuelle indiquent
      qu'on doit faire l'inclus et dans le périmètre
      le frontend et l'architecture seront en cloud
    `
    const r = computeCoverage(transcript, [], [])
    expect(r.sectionsTouched).toContain('contexte')
    expect(r.sectionsTouched).toContain('perimetreInclus')
    expect(r.sectionsTouched).toContain('architectureTechnique')
  })

  it('emitted section bypasses keyword check even when transcript is empty', () => {
    const r = computeCoverage('', [], ['exigencesFonctionnelles'])
    expect(r.sectionsTouched).toContain('exigencesFonctionnelles')
  })

  it('emitted section takes priority — keyword check is skipped for it', () => {
    // Both signals present for 'contexte'; the section is still only counted once.
    const r = computeCoverage('contexte situation actuelle', [], ['contexte'])
    expect(r.sectionsTouched.filter((s) => s === 'contexte')).toHaveLength(1)
  })
})

describe('computeCoverage — driver fields', () => {
  it('counts filled drivers (non-empty value)', () => {
    const drivers = [
      { label: 'Objectif', value: 'something' },
      { label: 'Délai', value: '' },
      { label: 'Budget', value: '  ' }, // whitespace-only → unfilled
      { label: 'Risques', value: null },
    ]
    const r = computeCoverage('', drivers, [])
    expect(r.driversAnswered).toBe(1)
    expect(r.driversTotal).toBe(4)
  })

  it('counts a driver as answered when its label is mentioned in the transcript', () => {
    const drivers = [{ label: 'Budget', value: null }]
    const r = computeCoverage('le budget total est de 50k', drivers, [])
    expect(r.driversAnswered).toBe(1)
  })

  it('does not count labels shorter than 3 chars (false-positive guard)', () => {
    const drivers = [{ label: 'IA', value: null }]
    const r = computeCoverage('ia est partout', drivers, [])
    expect(r.driversAnswered).toBe(0)
  })

  it('mentions are case-insensitive', () => {
    const drivers = [{ label: 'Budget', value: null }]
    const r = computeCoverage('le BUDGET est ouvert', drivers, [])
    expect(r.driversAnswered).toBe(1)
  })
})

describe('computeCoverage — combined coverage %', () => {
  it('rounds the percentage', () => {
    // 1 touched of 9 = 11.1...% → rounds to 11
    expect(computeCoverage('', [], ['contexte']).cahierCoveragePct).toBe(11)
    // 4 / 9 = 44.4% → 44
    expect(computeCoverage('', [], ['contexte', 'livrables', 'conclusion', 'perimetreInclus']).cahierCoveragePct).toBe(44)
    // 9 / 9 = 100
    const all: Array<Parameters<typeof computeCoverage>[2][number]> = [
      'objectifDocument', 'contexte', 'objectifProjet',
      'perimetreInclus', 'perimetreExclus', 'exigencesFonctionnelles',
      'architectureTechnique', 'livrables', 'conclusion',
    ]
    expect(computeCoverage('', [], all).cahierCoveragePct).toBe(100)
  })
})
