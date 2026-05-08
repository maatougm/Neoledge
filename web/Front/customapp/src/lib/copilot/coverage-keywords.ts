/**
 * @file coverage-keywords.ts — keyword dictionaries for the live coverage
 * gauge. Each cahier section gets a small set of French keyword groups
 * that, when found in the transcript, mark that section "touched."
 *
 * Pure data — ships entirely client-side, costs zero LLM tokens.
 */

import type { CahierSection } from '@/composables/useLiveCopilot'

export const COVERAGE_KEYWORDS: Record<Exclude<CahierSection, 'backlog_driver'>, string[]> = {
  objectifDocument: [
    'objectif du document',
    'pourquoi ce document',
    'cadre',
  ],
  contexte: [
    'contexte',
    'situation actuelle',
    'historique',
    'origine du projet',
  ],
  objectifProjet: [
    'objectif du projet',
    'but du projet',
    'finalité',
    'résultat attendu',
    'goal',
  ],
  perimetreInclus: [
    'inclus',
    'fait partie',
    'dans le périmètre',
    'in scope',
    'on doit faire',
    'on va faire',
  ],
  perimetreExclus: [
    'exclus',
    'pas dans le périmètre',
    'hors scope',
    'pas concerné',
    'on ne fera pas',
    'out of scope',
  ],
  exigencesFonctionnelles: [
    'fonctionnalité',
    'fonctionnalités',
    'feature',
    'cas d\'usage',
    'use case',
    'workflow',
    'écran',
    'module',
  ],
  architectureTechnique: [
    'architecture',
    'frontend',
    'backend',
    'base de données',
    'api',
    'rest',
    'graphql',
    'docker',
    'cloud',
    'on-premise',
    'sécurité',
  ],
  livrables: [
    'livrable',
    'livrables',
    'deliverable',
    'documentation technique',
    'guide utilisateur',
    'rapport de projet',
  ],
  conclusion: [
    'conclusion',
    'synthèse',
    'pour conclure',
    'en résumé',
  ],
}

/** Threshold of distinct keywords needed to flag a section "touched". */
export const COVERAGE_KEYWORD_THRESHOLD = 2
