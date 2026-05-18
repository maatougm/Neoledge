/**
 * @file coverage-engine.ts — pure-frontend coverage computation.
 * Runs entirely client-side; zero LLM tokens.
 *
 *   - cahierCoverage: 0..1 — fraction of the 9 sections "touched"
 *     either by keyword matches in the transcript OR by an emitted
 *     suggestion card targeting that section.
 *   - driversAnswered: count of driver fields that are either already
 *     filled in the questionnaire OR mentioned by label in the transcript.
 */

import { COVERAGE_KEYWORDS, COVERAGE_KEYWORD_THRESHOLD } from './coverage-keywords'
import type { CahierSection } from '@/composables/useLiveCopilot'

export interface DriverField {
  label: string
  value: string | null
}

export interface CoverageResult {
  cahierCoveragePct: number
  sectionsTouched: Exclude<CahierSection, 'backlog_driver'>[]
  driversAnswered: number
  driversTotal: number
}

const ALL_SECTIONS = Object.keys(COVERAGE_KEYWORDS) as Exclude<CahierSection, 'backlog_driver'>[]

export function computeCoverage(
  transcript: string,
  drivers: DriverField[],
  emittedSections: Iterable<CahierSection>,
): CoverageResult {
  const lowered = (transcript || '').toLowerCase()
  const emittedSet = new Set(emittedSections)
  const touched: Exclude<CahierSection, 'backlog_driver'>[] = []

  for (const section of ALL_SECTIONS) {
    if (emittedSet.has(section)) {
      touched.push(section)
      continue
    }
    if (!lowered) continue
    let hits = 0
    for (const kw of COVERAGE_KEYWORDS[section]) {
      if (lowered.includes(kw.toLowerCase())) hits += 1
      if (hits >= COVERAGE_KEYWORD_THRESHOLD) break
    }
    if (hits >= COVERAGE_KEYWORD_THRESHOLD) touched.push(section)
  }

  const driversAnswered = drivers.filter((f) => {
    if (typeof f.value === 'string' && f.value.trim().length > 0) return true
    const label = f.label.trim().toLowerCase()
    if (label.length < 3) return false
    return lowered.includes(label)
  }).length

  return {
    cahierCoveragePct: Math.round((touched.length / ALL_SECTIONS.length) * 100),
    sectionsTouched: touched,
    driversAnswered,
    driversTotal: drivers.length,
  }
}
