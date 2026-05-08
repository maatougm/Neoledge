/**
 * @file assignment-agent.ts — tool-using agent that recommends an assignee
 * for each of N candidate work packages on a project. Fires one agent
 * loop, emits a structured list of {wpId, suggestions[]}, where each
 * suggestion carries a `userId`, `confidence` (0..1), and `rationale`.
 *
 * The suggestions are advisory only — the PM still confirms in the UI.
 */

import { Logger } from '@nestjs/common'
import type { AgentRunnerService } from './agent/agent-runner.service.js'
import type { ToolDefinition } from './agent/agent-types.js'
import { obj, str, num, arr } from './agent/json-schema.js'
import { buildAssignmentTools } from './agent/tools/assignment-tools.js'
import { readGlossaryTool } from './agent/tools/glossary-tools.js'
import { readProjectSummaryTool } from './agent/tools/project-tools.js'

export interface AssignmentSuggestion {
  userId: string
  confidence: number
  rationale: string
}

export interface AssignmentSuggestionForWp {
  wpId: string
  suggestions: AssignmentSuggestion[]
}

const SYSTEM_PROMPT = `Tu es un manager IT expérimenté. Tu aides un chef de projet à assigner intelligemment des tâches aux membres de son équipe.

Méthode :
1. read_project_summary — comprends le contexte du projet.
2. read_candidate_tasks — récupère la liste des tâches à assigner.
3. read_project_members — liste les membres avec leurs labels (compétences) et leur charge actuelle.
4. Pour chaque membre pertinent, read_member_history pour voir leurs tâches résolues récentes.
5. read_glossary si un terme métier est ambigu.
6. emit_assignments — émets pour CHAQUE tâche candidate exactement une entrée avec un tableau de 1 à 3 suggestions classées par confiance décroissante.

Critères de classement (du plus important au moins important) :
- **Adéquation compétence** : le \`label\` du membre correspond-il au type/contenu de la tâche ? (ex. "Backend lead" pour une tâche API, "QA" pour un Bug.)
- **Antécédents** : le membre a-t-il déjà résolu des tâches similaires (read_member_history) ?
- **Charge actuelle** : éviter de surcharger un membre déjà à 5+ tâches en cours. Préférer un membre à charge légère si compétences équivalentes.
- **Diversité** : ne pas assigner toutes les tâches au même membre si plusieurs ont les compétences requises.

Format de chaque suggestion :
- \`userId\` : l'ID du membre (champ \`userId\` retourné par read_project_members, PAS \`memberId\`).
- \`confidence\` : nombre entre 0.5 et 1.0. >= 0.85 = très confiant, 0.7-0.85 = bon match, 0.5-0.7 = match correct.
- \`rationale\` : 1 phrase courte (max 140 caractères) en français expliquant le choix.

NE PAS inventer de \`userId\` qui n'est pas dans read_project_members.
SI aucun membre ne convient, émets quand même une entrée pour la tâche avec un tableau \`suggestions\` vide.`

const emitAssignmentsTool: ToolDefinition<{ items: AssignmentSuggestionForWp[] }, { items: AssignmentSuggestionForWp[] }> = {
  name: 'emit_assignments',
  description: 'Final tool. Call this exactly once with one entry per candidate task. Each entry has 0..3 ranked suggestions. After this call, the loop ends.',
  parameters: obj(
    {
      items: arr(
        obj(
          {
            wpId: str({ description: 'The WorkPackage ID from read_candidate_tasks.' }),
            suggestions: arr(
              obj(
                {
                  userId:     str({ description: 'A userId from read_project_members.' }),
                  confidence: num({ description: 'Confidence between 0.5 and 1.0.', minimum: 0, maximum: 1 }),
                  rationale:  str({ description: 'Short French explanation, max 140 chars.', maxLength: 200 }),
                },
                { required: ['userId', 'confidence', 'rationale'] },
              ),
              { maxItems: 3 },
            ),
          },
          { required: ['wpId', 'suggestions'] },
        ),
        { maxItems: 50 },
      ),
    },
    { required: ['items'] },
  ),
  handler: async () => ({ items: [] }),
}

export async function runAssignmentAgent(
  runner: AgentRunnerService,
  logger: Logger,
  projectId: string,
  candidateWpIds: string[],
): Promise<AssignmentSuggestionForWp[]> {
  if (candidateWpIds.length === 0) return []

  const tools = [
    readProjectSummaryTool,
    ...buildAssignmentTools(projectId, candidateWpIds),
    readGlossaryTool,
  ]

  const result = await runner.run<{ items: AssignmentSuggestionForWp[] }>({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `Propose des affectations pour ces ${candidateWpIds.length} tâche(s). Commence par read_candidate_tasks puis read_project_members.`,
    tools,
    emitTools: [emitAssignmentsTool],
    maxIterations: 8,
    feature: 'backlog', // closest existing feature label; AiUsage stays consistent
    projectId,
  })

  logger.log(
    `Assignment agent done — ${result.iterations} iter, ${result.toolCallsLog.length} tool calls, ${result.output.items.length} suggestions emitted`,
  )

  // Defensive validation — drop entries for unknown wpIds and clamp confidence.
  const candidateSet = new Set(candidateWpIds)
  return (result.output.items ?? [])
    .filter((it) => candidateSet.has(it.wpId))
    .map((it) => ({
      wpId: it.wpId,
      suggestions: (it.suggestions ?? [])
        .filter((s) => typeof s.userId === 'string' && s.userId.length > 0)
        .map((s) => ({
          userId: s.userId,
          confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0)),
          rationale: (s.rationale ?? '').slice(0, 200),
        })),
    }))
}
