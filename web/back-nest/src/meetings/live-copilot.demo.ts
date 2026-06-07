/* ============================================================================
 * FILE: live-copilot.demo.ts  —  Deterministic copilot demo-mode (DEMO ONLY)
 *                                 Mode démo déterministe du copilote (DÉMO UNIQUEMENT)
 * ============================================================================
 * EN — TEMPORARY demo helper. When `DEMO_COPILOT_MODE=on` AND the live session
 *   belongs to the "Rapido" demo project, the copilot stops calling the AI and
 *   instead replays a fixed, hand-authored checklist whose items flip from
 *   `missing` → `covered` as the recorded reunion script is spoken. This makes
 *   the on-camera live-meeting moment 100% deterministic and free (no tokens, no
 *   provider, no latency) while still reacting to the real transcript buffer.
 *
 *   It is gated entirely behind env vars and a project-id match — when the flag
 *   is off (the default) NOTHING here runs and the real AI path is untouched.
 *   To revert: unset DEMO_COPILOT_MODE. This file can then be deleted.
 *
 * FR — Aide de démo TEMPORAIRE. Quand `DEMO_COPILOT_MODE=on` ET que la session
 *   appartient au projet démo « Rapido », le copilote n'appelle plus l'IA et
 *   rejoue une checklist fixe, écrite à la main, dont les items passent de
 *   `missing` à `covered` au fur et à mesure que le script de la réunion est
 *   prononcé. Le moment « réunion en direct » filmé devient 100% déterministe
 *   et gratuit (aucun token, aucun fournisseur, aucune latence) tout en réagissant
 *   au vrai buffer de transcription.
 *
 *   Entièrement protégé par des variables d'environnement + correspondance d'id
 *   de projet — quand le flag est éteint (par défaut), RIEN ici ne s'exécute et
 *   le vrai chemin IA n'est pas touché. Pour annuler : retirer DEMO_COPILOT_MODE.
 * ========================================================================== */

import type {
  CahierSection,
  ChecklistCategory,
  ChecklistItem,
  ChecklistStatus,
  LiveCopilotFireResult,
  LiveSessionState,
  SuggestionUrgency,
} from './live-copilot.types.js';

/**
 * Fixed UUID of the Rapido demo project. MUST stay in sync with
 * `prisma/seed-demo-rapido.mjs` (RAPIDO_PROJECT_ID). Overridable at runtime via
 * the `DEMO_COPILOT_PROJECT_ID` env var (e.g. if the seed id is changed).
 */
export const RAPIDO_DEMO_PROJECT_ID = 'f00d0000-0000-4000-8000-000000000001';

/** Max active suggestion cards at once — mirrors the real sanitizeEmit cap. */
const MAX_ACTIVE_SUGGESTIONS = 4;

// One scripted checklist row. `triggers` are accent-insensitive substrings —
// when ANY of them appears in the (normalised) transcript buffer, the row is
// considered `covered`. Tuned to short, distinctive fragments so imperfect
// browser SpeechRecognition still catches them.
interface DemoItemSpec {
  id: string;
  topic: string;
  question: string;
  category: ChecklistCategory;
  section: CahierSection;
  triggers: string[];
  evidence: string;
  suggestion?: {
    question: string;
    rationale: string;
    urgency: SuggestionUrgency;
  };
}

// The Rapido restaurant-platform checklist, ordered to match the reunion script.
// Each row covers a topic the client/PM actually says, so the list fills in
// roughly top-to-bottom as the meeting is read aloud.
const DEMO_CHECKLIST: ReadonlyArray<DemoItemSpec> = [
  {
    id: 'objectif',
    topic: 'Objectif du projet',
    question: 'Quel est l’objectif principal de la plateforme ?',
    category: 'context',
    section: 'objectifProjet',
    triggers: [
      'developper une solution',
      'ameliorer la gestion',
      'gestion de notre restaurant',
      'digitaliser',
    ],
    evidence:
      '« développer une solution pour améliorer la gestion de notre restaurant »',
    suggestion: {
      question:
        'Quel est l’objectif principal que la plateforme doit atteindre ?',
      rationale:
        'Cadrer l’objectif dès le départ oriente tout le cahier des charges.',
      urgency: 'high',
    },
  },
  {
    id: 'contexte',
    topic: 'Problèmes actuels (processus manuels)',
    question: 'Quels problèmes rencontrez-vous aujourd’hui ?',
    category: 'context',
    section: 'contexte',
    triggers: [
      'methodes manuelles',
      'manuelle',
      'des erreurs',
      'des retards',
      'forte activite',
    ],
    evidence:
      '« plusieurs méthodes manuelles… des erreurs et des retards… heures de forte activité »',
    suggestion: {
      question:
        'Quels processus posent le plus de problèmes en période de forte activité ?',
      rationale:
        'Comprendre la douleur actuelle justifie le périmètre fonctionnel.',
      urgency: 'medium',
    },
  },
  {
    id: 'plats-stocks',
    topic: 'Suivi des plats & des stocks',
    question: 'Comment est suivie la disponibilité des plats ?',
    category: 'features',
    section: 'exigencesFonctionnelles',
    triggers: [
      'suivi des plats',
      'stock',
      'plus disponibles',
      'disponibilite',
      'temps reel',
      'mise a jour',
    ],
    evidence:
      '« certains plats ne sont plus disponibles mais l’information n’est pas mise à jour rapidement »',
    suggestion: {
      question:
        'Le suivi des plats et des stocks doit-il se mettre à jour en temps réel ?',
      rationale:
        'Le temps réel impacte directement l’architecture et le sizing.',
      urgency: 'medium',
    },
  },
  {
    id: 'commandes',
    topic: 'Gestion des commandes',
    question: 'Comment les commandes doivent-elles être gérées ?',
    category: 'features',
    section: 'exigencesFonctionnelles',
    triggers: ['commande'],
    evidence: '« gérer les commandes, les réservations, les menus »',
  },
  {
    id: 'reservations',
    topic: 'Gestion des réservations',
    question: 'Comment les réservations sont-elles prises ?',
    category: 'features',
    section: 'perimetreInclus',
    triggers: ['reservation'],
    evidence: '« gérer les commandes et les réservations »',
  },
  {
    id: 'menus',
    topic: 'Gestion des menus & des plats',
    question: 'Qui gère le catalogue des menus et des plats ?',
    category: 'features',
    section: 'perimetreInclus',
    triggers: ['menu', 'les plats'],
    evidence: '« les menus et le suivi des disponibilités en temps réel »',
  },
  {
    id: 'admin',
    topic: 'Espace administrateur & tableau de bord',
    question: 'De quoi l’administrateur a-t-il besoin ?',
    category: 'users',
    section: 'exigencesFonctionnelles',
    triggers: [
      'administrateur',
      'tableau de bord',
      'espace admin',
      'gerer les utilisateurs',
    ],
    evidence:
      '« l’administrateur pourra gérer les utilisateurs… à travers un tableau de bord »',
    suggestion: {
      question: 'Quelles actions l’administrateur doit-il pouvoir réaliser ?',
      rationale: 'Détailler le rôle admin alimente le périmètre et le backlog.',
      urgency: 'medium',
    },
  },
  {
    id: 'stack',
    topic: 'Stack technique (React / Node / MySQL)',
    question: 'Quelles technologies sont retenues ?',
    category: 'integrations',
    section: 'architectureTechnique',
    triggers: ['react', 'node', 'express', 'mysql', 'base de donnees'],
    evidence:
      '« React JS pour le front-end, Node.js avec Express pour le back-end et MySQL »',
    suggestion: {
      question:
        'Quelles technologies front, back et base de données souhaitez-vous ?',
      rationale:
        'La stack conditionne la section architecture technique du cahier.',
      urgency: 'high',
    },
  },
  {
    id: 'delai',
    topic: 'Délai & réunions de suivi',
    question: 'Quel est le délai cible du projet ?',
    category: 'timeline',
    section: 'livrables',
    triggers: [
      'quatre mois',
      '4 mois',
      'reunions de suivi',
      'periode de quatre',
      'delai',
    ],
    evidence:
      '« une période de quatre mois avec des réunions de suivi régulières »',
    suggestion: {
      question: 'Quel est le délai cible et le rythme des points de suivi ?',
      rationale: 'Le planning structure les jalons et les livrables du projet.',
      urgency: 'low',
    },
  },
];

// Lower-case + strip diacritics so "Réservations", "reservation" and
// "RESERVATION" all match the same trigger. (NFD splits accented letters into
// base + combining mark; we drop the combining marks.)
function normalize(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase().normalize('NFD')) {
    const code = ch.codePointAt(0) ?? 0;
    // Skip Unicode combining diacritical marks (U+0300..U+036F).
    if (code >= 0x300 && code <= 0x36f) continue;
    out += ch;
  }
  return out;
}

/**
 * Is this live session running in deterministic demo mode?
 * True when `DEMO_COPILOT_MODE=on`. By default (DEMO_COPILOT_PROJECT_ID unset)
 * it applies to EVERY project, so a project created live on camera also gets
 * the scripted checklist. Set DEMO_COPILOT_PROJECT_ID to scope it to one id.
 */
export function isCopilotDemoSession(state: LiveSessionState): boolean {
  if ((process.env.DEMO_COPILOT_MODE ?? 'off').toLowerCase() !== 'on')
    return false;
  const configured = (process.env.DEMO_COPILOT_PROJECT_ID ?? '').trim();
  // Empty → all projects; otherwise scope to the configured id.
  return configured.length === 0 || state.projectId === configured;
}

/**
 * Run one deterministic demo fire. Builds the checklist from the current
 * transcript buffer, mutates the session state in place (so covered status and
 * PM ask/dismiss clicks survive across fires, exactly like the real path), and
 * returns the full meeting state. Never calls the AI and never spends tokens.
 */
export function runDemoFire(state: LiveSessionState): LiveCopilotFireResult {
  const hay = normalize(state.transcriptBuffer);
  let activeSuggestions = 0;

  const checklist: ChecklistItem[] = DEMO_CHECKLIST.map((spec) => {
    const matched = spec.triggers.some((t) => hay.includes(normalize(t)));
    // Sticky covered: once an item was covered in a previous fire, keep it
    // covered even if the buffer later truncates past the trigger phrase.
    const wasCovered =
      state.checklist.find((i) => i.id === spec.id)?.status === 'covered';
    const status: ChecklistStatus =
      matched || wasCovered ? 'covered' : 'missing';

    let suggestion: ChecklistItem['suggestion'] = null;
    if (
      status !== 'covered' &&
      spec.suggestion &&
      activeSuggestions < MAX_ACTIVE_SUGGESTIONS
    ) {
      suggestion = { ...spec.suggestion };
      activeSuggestions += 1;
    }

    return {
      id: spec.id,
      topic: spec.topic,
      question: spec.question,
      category: spec.category,
      section: spec.section,
      status,
      evidence: status === 'covered' ? spec.evidence : null,
      suggestion,
      // Restore the PM's ask/dismiss click — survives the rewrite.
      userAction: state.userActions.get(spec.id) ?? null,
    };
  });

  const coveredCount = checklist.filter((i) => i.status === 'covered').length;
  const ratio = checklist.length === 0 ? 0 : coveredCount / checklist.length;
  const readyForCahier =
    checklist.every((i) => i.status !== 'missing') && ratio >= 0.75;

  const hint = readyForCahier
    ? 'Toutes les informations clés sont couvertes — vous pouvez générer le cahier des charges.'
    : coveredCount === 0
      ? 'Laissez le client décrire son besoin — la checklist se remplit automatiquement.'
      : 'Continuez : il reste quelques sujets à aborder (stack technique, délais…).';

  // Persist into session state so subsequent fires are sticky, ask/dismiss
  // clicks land on a real row, and the agent-coverage gauge keeps filling.
  for (const i of checklist) {
    if (i.status === 'covered' || i.status === 'partial')
      state.agentTaggedCoverage.add(i.section);
  }
  state.checklist = checklist;
  state.hint = hint;
  state.readyForCahier = readyForCahier;

  // Clone so the caller can't mutate the live session checklist.
  return {
    checklist: checklist.map((i) => ({
      ...i,
      suggestion: i.suggestion ? { ...i.suggestion } : null,
    })),
    hint,
    readyForCahier,
    summary: state.summary,
  };
}
