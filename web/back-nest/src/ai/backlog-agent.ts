/**
 * @file backlog-agent.ts — tool-using agent that proposes a backlog
 * (epics + tasks) from project data. The model decides which tools
 * to call: typically read_questionnaire(driverOnly=true), then
 * read_validated_cahier, then read_meeting_summaries, then emit_backlog.
 */

import { Logger } from '@nestjs/common'
import type { AgentRunnerService } from './agent/agent-runner.service.js'
import type { ToolDefinition } from './agent/agent-types.js'
import { obj, str, num, arr } from './agent/json-schema.js'
import { sanitizeBacklog, type ProposedBacklog } from './backlog-generator.js'
import {
  readProjectSummaryTool,
  readQuestionnaireTool,
  readValidatedCahierTool,
  readMeetingSummariesTool,
  readPastBacklogsTool,
} from './agent/tools/project-tools.js'
import { readGlossaryTool } from './agent/tools/glossary-tools.js'

const SYSTEM_PROMPT = `Tu es un chef de projet senior qui prépare un backlog de développement pour une équipe IT.

Ta démarche :
1. Appelle read_project_summary pour comprendre le contexte (projet, client, statut, dates).
2. Appelle read_questionnaire avec driverOnly=true pour récupérer les exigences clés du PM.
3. Appelle read_validated_cahier pour le périmètre fonctionnel et technique. Si saved=false, ne fabrique PAS d'epics imaginaires.
4. Appelle read_meeting_summaries pour les décisions/contraintes émergées en réunion.
5. Si le projet a déjà des WPs, appelle read_past_backlogs pour ne pas dupliquer.
6. Si tu rencontres un terme métier (Elise, GED, Neoform...), utilise read_glossary.
7. Quand tu as collecté assez de contexte, appelle emit_backlog avec ta proposition finale.

Règles strictes pour la proposition :
- 3 à 8 Epics fonctionnels.
- 2 à 8 tâches par Epic (concrètes, implémentables).
- Estimations en heures réalistes (1-80h par tâche, 8-200h par Epic).
- Priorité dans : Low, Normal, High, Critical.
- Type tâche dans : Task, Feature, Bug.
- Langue : français. Concis, factuel, orienté livrable.

NE répète PAS d'epics qui existent déjà dans read_past_backlogs.
NE fabrique PAS d'exigences qui ne sont ni dans le questionnaire ni dans le cahier ni dans les réunions.

RÈGLE ANTI-HALLUCINATION CRITIQUE : si une zone fonctionnelle est mentionnée mais sans détails (ex: "module IA" sans cas d'usage explicite), émets un epic minimal "Investigation: <topic>" avec une tâche "Définir <topic> avec le client" — n'invente PAS de tâches qui parlent de fonctionnalités jamais discutées.`

const PRIORITY_ENUM = ['Low', 'Normal', 'High', 'Critical']
const TYPE_ENUM = ['Task', 'Feature', 'Bug']

const emitBacklogTool: ToolDefinition<ProposedBacklog, ProposedBacklog> = {
  name: 'emit_backlog',
  description: 'Final tool. Call this exactly once with your full backlog proposal. After this call, the loop ends.',
  parameters: obj(
    {
      epics: arr(
        obj(
          {
            title: str({ description: 'Epic title — short, action-oriented' }),
            description: str({ description: 'Epic description, 1-3 sentences', maxLength: 2000 }),
            priority: str({ enum: PRIORITY_ENUM }),
            estimatedHours: num({ minimum: 0, maximum: 1000 }),
            children: arr(
              obj(
                {
                  title: str({ description: 'Task title' }),
                  description: str({ description: 'Task description', maxLength: 2000 }),
                  type: str({ enum: TYPE_ENUM }),
                  priority: str({ enum: PRIORITY_ENUM }),
                  estimatedHours: num({ minimum: 0, maximum: 200 }),
                },
                { required: ['title', 'type', 'priority', 'estimatedHours'] },
              ),
              { maxItems: 30 },
            ),
          },
          { required: ['title', 'priority', 'estimatedHours', 'children'] },
        ),
        { maxItems: 20 },
      ),
    },
    { required: ['epics'] },
  ),
  handler: async () => ({ epics: [] }), // unused for emit tools
}

export async function runBacklogAgent(
  runner: AgentRunnerService,
  logger: Logger,
  projectId: string,
): Promise<ProposedBacklog> {
  const result = await runner.run<ProposedBacklog>({
    systemPrompt: SYSTEM_PROMPT,
    tools: [
      readProjectSummaryTool,
      readQuestionnaireTool,
      readValidatedCahierTool,
      readMeetingSummariesTool,
      readPastBacklogsTool,
      readGlossaryTool,
    ],
    emitTools: [emitBacklogTool],
    maxIterations: 8,
    feature: 'backlog',
    projectId,
  })
  logger.log(
    `Backlog agent done — ${result.iterations} iter, ${result.toolCallsLog.length} tool calls, model=${result.model}`,
  )
  // Defensive sanitize even though the JSON Schema is enforced — the agent
  // may sometimes emit an over-sized epic count or out-of-range hours.
  return sanitizeBacklog(result.output)
}
