/**
 * @file cahier-agent.ts — tool-using agent that produces the 9-key
 * cahier des charges JSON. Reads questionnaire + meeting summaries
 * + past feedback + previously saved cahier on demand, then emits
 * the final structure via the forced `emit_cahier` terminal tool.
 *
 * Falls back to single-shot generation in CahierDesChargesService
 * when the agent throws AgentEmitMissedError.
 */

import { Logger } from '@nestjs/common'
import type { AgentRunnerService } from '../ai/agent/agent-runner.service.js'
import type { ToolContext, ToolDefinition } from '../ai/agent/agent-types.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { obj, str, arr } from '../ai/agent/json-schema.js'
import type { CahierAiResult } from './cahier-des-charges.types.js'
import {
  readProjectSummaryTool,
  readQuestionnaireTool,
  readValidatedCahierTool,
  readMeetingSummariesTool,
  readValidationFeedbackTool,
} from '../ai/agent/tools/project-tools.js'
import { readMeetingSegmentsTool } from '../ai/agent/tools/cahier-tools.js'
import { readGlossaryTool } from '../ai/agent/tools/glossary-tools.js'

const SYSTEM_PROMPT = `Tu es expert NeoLedge / Archimed en rédaction de cahiers des charges contractuels (modèle Elise). Tu dois produire un cahier complet en 9 sections.

Méthode :
1. read_project_summary — comprends le projet (nom, client, statut, dates, équipe).
2. read_questionnaire (driverOnly=false) — lis TOUTES les réponses. Le questionnaire complet est ta source primaire.
3. read_validated_cahier — si saved=true, c'est la version corrigée par l'équipe de validation : NE LA RÉÉCRIS PAS, conserve ses phrases telles qu'elles sont, ne touche qu'aux sections qui doivent être ajustées.
4. read_validation_feedback — corrige UNIQUEMENT ce qui est explicitement signalé dans les rejets précédents.
5. read_meeting_summaries — décisions / contraintes émergées en réunion.
6. read_meeting_segments — quand tu as besoin d'une citation précise (deadline, techno nommée, chiffre contractuel) qui n'est pas dans les résumés.
7. read_glossary — pour tout terme métier (Elise, GED, Neoform, Elise.Automate...).
8. Quand tu as collecté assez de matière, appelle emit_cahier avec les 9 clés.

Règles strictes pour la sortie :
- Langue : français, ton contractuel professionnel, exhaustif.
- Markdown autorisé À L'INTÉRIEUR des strings uniquement (\`**gras**\`, listes \`- \`, sauts de ligne \\n).
- "À définir" si une info manque vraiment.
- exigencesFonctionnelles : 4–6 modules, chacun = phrase d'intro + bullets. Exemples : "Gestion des projets", "Gestion des tâches", "Visualisation et suivi", "Alertes et notifications", "Module IA générative".
- architectureTechnique : 3–4 composants. Exemples : "Frontend" (Neoform / Vue 3), "Backend" (NestJS / .NET Core / Elise.Automate), "Module IA" (provider d'orchestration), "Base de données" (PostgreSQL / SQL Server).
- livrables : module intégré, base de données + scripts, doc technique + guide utilisateur, rapport projet.
- Conclusion : paragraphe synthétique sans liste.

PRIORITÉ DES SOURCES (du plus prioritaire au moins prioritaire) :
A. read_validated_cahier (si saved=true) — version corrigée qui fait foi.
B. read_validation_feedback — corrige UNIQUEMENT ce qui est signalé.
C. read_questionnaire + read_meeting_summaries + read_meeting_segments — sources brutes pour combler.
Tu n'es PAS autorisé à reformuler une section déjà corrigée juste pour "améliorer le style".`

const cahierSectionSchema = obj(
  {
    title: str({ description: 'Section title — short, e.g. "Gestion des projets" or "Frontend".', maxLength: 200 }),
    content: str({ description: 'Section body in markdown — phrase d\'intro puis bullets `-`.', maxLength: 4000 }),
  },
  { required: ['title', 'content'] },
)

const emitCahierTool: ToolDefinition<CahierAiResult, CahierAiResult> = {
  name: 'emit_cahier',
  description: 'Final tool. Call this exactly once with the complete cahier structure (9 keys). After this call, the loop ends.',
  parameters: obj(
    {
      objectifDocument:        str({ description: '1.1 Objectif du document', maxLength: 2000 }),
      contexte:                str({ description: '1.2 Contexte', maxLength: 4000 }),
      objectifProjet:          str({ description: '2.1 Objectif du projet — bullets markdown', maxLength: 4000 }),
      perimetreInclus:         str({ description: '2.2.1 Éléments inclus — bullets markdown', maxLength: 4000 }),
      perimetreExclus:         str({ description: '2.2.2 Éléments exclus — bullets markdown', maxLength: 2000 }),
      exigencesFonctionnelles: arr(cahierSectionSchema, { description: '2.3 Exigences fonctionnelles — 4 à 6 modules', maxItems: 12 }),
      architectureTechnique:   arr(cahierSectionSchema, { description: '2.4 Architecture technique — 3 à 4 composants', maxItems: 8 }),
      livrables:               str({ description: '2.5 Livrables — bullets markdown', maxLength: 2000 }),
      conclusion:              str({ description: '3 Conclusion — paragraphe synthétique', maxLength: 3000 }),
    },
    {
      required: [
        'objectifDocument', 'contexte', 'objectifProjet', 'perimetreInclus',
        'perimetreExclus', 'exigencesFonctionnelles', 'architectureTechnique',
        'livrables', 'conclusion',
      ],
    },
  ),
  handler: async () => ({} as CahierAiResult),
}

export async function runCahierAgent(
  runner: AgentRunnerService,
  logger: Logger,
  projectId: string,
): Promise<CahierAiResult> {
  const result = await runner.run<CahierAiResult>({
    systemPrompt: SYSTEM_PROMPT,
    tools: [
      readProjectSummaryTool,
      readQuestionnaireTool,
      readValidatedCahierTool,
      readValidationFeedbackTool,
      readMeetingSummariesTool,
      readMeetingSegmentsTool,
      readGlossaryTool,
    ],
    emitTools: [emitCahierTool],
    maxIterations: 10,
    feature: 'cahier',
    projectId,
  })
  logger.log(
    `Cahier agent done — ${result.iterations} iter, ${result.toolCallsLog.length} tool calls, model=${result.model}`,
  )
  return result.output
}

// ─── Phase 5 — Planner / Worker variant ─────────────────────────────────────
//
// For the cahier, the SET of reads is deterministic — we always want the same
// six tools (project summary, full questionnaire, validated cahier, validation
// feedback, meeting summaries, glossary). The "planner" decision is therefore
// constant; no extra LLM call needed.
//
// Pattern:
//   1. Execute every read in parallel (Promise.all).
//   2. Concatenate the results into a single user-message context blob.
//   3. Single LLM call: pass the blob, force `emit_cahier`. No loop.
//
// Round-trip count drops from N (3–10 today) to ONE. Worth a side-by-side
// measurement against the loop because the worker has to digest a bigger
// context upfront — net win depends on (loop overhead) vs (worker context
// cost). Wired behind `CAHIER_USE_PLANNER` env flag, default OFF.
//
// `read_meeting_segments` (keyword-driven, query-specific) is intentionally
// excluded — its job is "find a specific quote I'm missing", which the
// single-shot worker cannot decide it needs on the fly. If we later add
// pgvector semantic retrieval (Phase 4), it slots in here as a deterministic
// "top-K excerpts" call.
const WORKER_SYSTEM_PROMPT = `Tu es expert NeoLedge / Archimed en rédaction de cahiers des charges contractuels (modèle Elise). Tu dois produire un cahier complet en 9 sections.

Tu reçois EN ENTRÉE un contexte projet déjà rassemblé par le système (questionnaire, cahier validé précédent, retours de validation, résumés de réunions, glossaire). Tu n'as PAS d'outils de lecture. Appelle directement \`emit_cahier\` avec les 9 clés en t'appuyant uniquement sur le contexte fourni.

Règles strictes pour la sortie :
- Langue : français, ton contractuel professionnel, exhaustif.
- Markdown autorisé À L'INTÉRIEUR des strings uniquement (\`**gras**\`, listes \`- \`, sauts de ligne \\n).
- "À définir" ou "INFO_MANQUANTE: <topic>" si une info manque vraiment dans le contexte. Ne jamais inventer.
- exigencesFonctionnelles : 4–6 modules, chacun = phrase d'intro + bullets.
- architectureTechnique : 3–4 composants UNIQUEMENT si le contexte les mentionne. Sinon INFO_MANQUANTE.
- livrables : ne liste que ce que le contexte ou le questionnaire indique. INFO_MANQUANTE sinon.
- Conclusion : paragraphe synthétique sans liste.

PRIORITÉ DES SOURCES (du plus prioritaire au moins prioritaire) :
A. CAHIER VALIDÉ (si présent dans le contexte) — version corrigée qui fait foi. Préserve les phrases existantes.
B. RETOURS DE VALIDATION — corrige UNIQUEMENT ce qui est explicitement signalé.
C. QUESTIONNAIRE + RÉUNIONS — sources brutes pour combler.

Tu n'es PAS autorisé à reformuler une section déjà corrigée juste pour "améliorer le style".`

interface ReadOutcome {
  label: string
  ok: boolean
  data: unknown
}

async function runReadSafely(
  label: string,
  tool: ToolDefinition,
  args: unknown,
  ctx: ToolContext,
  logger: Logger,
): Promise<ReadOutcome> {
  try {
    const data = await tool.handler(args, ctx)
    return { label, ok: true, data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.warn(`planner-worker: read "${label}" failed — ${msg.slice(0, 200)}`)
    return { label, ok: false, data: { error: msg.slice(0, 300) } }
  }
}

function formatContextBlob(outcomes: ReadOutcome[]): string {
  const TRUNCATE_PER_SECTION = 6000
  return outcomes
    .map((o) => {
      const body = JSON.stringify(o.data)
      const trimmed = body.length > TRUNCATE_PER_SECTION
        ? body.slice(0, TRUNCATE_PER_SECTION) + ' [trunc]'
        : body
      return `## ${o.label}\n${trimmed}`
    })
    .join('\n\n---\n\n')
}

export async function runCahierPlannerWorker(
  runner: AgentRunnerService,
  prisma: PrismaService,
  logger: Logger,
  projectId: string,
): Promise<CahierAiResult> {
  const startedAt = Date.now()
  const toolCtx: ToolContext = {
    projectId,
    logger,
    prisma,
    maxResultChars: 12_000,
  }

  // 1. Parallel reads — the "executor" step. No planner LLM call needed
  //    because the cahier read set is deterministic. If one read fails
  //    the others continue; the worker sees an `{error: ...}` payload
  //    for that section and degrades gracefully.
  const reads = await Promise.all([
    runReadSafely('PROJET', readProjectSummaryTool, {}, toolCtx, logger),
    runReadSafely('QUESTIONNAIRE', readQuestionnaireTool, { driverOnly: false }, toolCtx, logger),
    runReadSafely('CAHIER_VALIDE', readValidatedCahierTool, {}, toolCtx, logger),
    runReadSafely('REUNIONS', readMeetingSummariesTool, {}, toolCtx, logger),
    runReadSafely('RETOURS_VALIDATION', readValidationFeedbackTool, {}, toolCtx, logger),
    runReadSafely('GLOSSAIRE', readGlossaryTool, {}, toolCtx, logger),
  ])
  const readsMs = Date.now() - startedAt

  // 2. Single-shot worker call — maxIterations=1 with one emit tool forces
  //    the agent runtime to call emit_cahier immediately. No reads needed
  //    (empty `tools: []`); all context is already in the user message.
  const contextBlob = formatContextBlob(reads)
  const result = await runner.run<CahierAiResult>({
    systemPrompt: WORKER_SYSTEM_PROMPT,
    userMessage: `Voici le contexte projet rassemblé par le système :\n\n${contextBlob}\n\nAppelle MAINTENANT \`emit_cahier\` avec les 9 clés en utilisant uniquement ce contexte.`,
    tools: [],
    emitTools: [emitCahierTool],
    maxIterations: 1,
    feature: 'cahier',
    projectId,
  })

  logger.log(
    `Cahier planner-worker done — reads=${readsMs}ms total=${Date.now() - startedAt}ms model=${result.model}`,
  )
  return result.output
}
