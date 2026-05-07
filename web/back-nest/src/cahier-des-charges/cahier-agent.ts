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
import type { ToolDefinition } from '../ai/agent/agent-types.js'
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
