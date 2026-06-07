/* ============================================================================
 * FILE: demo-mode.ts  —  Master demo switch (TEMPORARY, DEMO ONLY)
 * ============================================================================
 * EN — When DEMO_COPILOT_MODE=on the AI features (live meeting copilot, cahier
 *   des charges generation, AI backlog generation) return fixed, perfect
 *   "Rapido" demo answers instead of calling the provider — deterministic,
 *   free, instant. This lets a brand-new project created live on camera produce
 *   the same polished outputs every time. Off by default; flipping it off
 *   reverts EVERY AI feature to its normal behaviour.
 *
 * FR — Quand DEMO_COPILOT_MODE=on, les fonctions IA (copilote de réunion,
 *   génération du cahier des charges, génération du backlog IA) renvoient des
 *   réponses « Rapido » fixes et parfaites au lieu d'appeler le fournisseur —
 *   déterministe, gratuit, instantané. Désactivé par défaut.
 * ========================================================================== */

/** True when the demo master switch is on (env DEMO_COPILOT_MODE=on). */
export function isAiDemoMode(): boolean {
  return (process.env.DEMO_COPILOT_MODE ?? 'off').toLowerCase() === 'on'
}
