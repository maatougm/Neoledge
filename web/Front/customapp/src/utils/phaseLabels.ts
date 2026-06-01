/** @file src/utils/phaseLabels.ts — French display labels for phase / status enums */

export const PHASE_LABELS: Record<string, string> = {
  Draft: 'Brouillon',
  Kickoff: 'Lancement',
  Realisation: 'Réalisation',
  Cloture: 'Clôture',
  Archived: 'Archivé',
}

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase
}
