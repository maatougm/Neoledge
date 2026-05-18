/**
 * @file transcript-agent.ts — tool-using agent that analyzes a meeting
 * transcript and emits THREE terminal tool calls:
 *   - emit_summary       (markdown summary of the meeting)
 *   - emit_action_items  (list of action items)
 *   - emit_decisions     (list of decisions / risks)
 *
 * Multi-emit terminal mode: the runner waits until all three have fired
 * (in any order) before returning. If only some fire by maxIterations,
 * the runner throws AgentEmitMissedError and the caller falls back to
 * the existing single-shot path.
 */

import { Logger } from '@nestjs/common'
import type { AgentRunnerService } from './agent/agent-runner.service.js'
import type { ToolDefinition } from './agent/agent-types.js'
import { obj, str, arr } from './agent/json-schema.js'
import type { AiAnalysisResult, AiActionItemInput, AiDecisionInput } from './ai.types.js'
import { buildTranscriptTools, readOtherMeetingsTool } from './agent/tools/transcript-tools.js'
import { readGlossaryTool } from './agent/tools/glossary-tools.js'

const SYSTEM_PROMPT = `Tu es un assistant expert en gestion de projet. Tu analyses la transcription d'une réunion pour produire trois sorties :
1. Un compte-rendu en markdown.
2. Une liste d'actions à mener (avec assigné si mentionné, échéance si mentionnée).
3. Une liste de décisions ou de risques.

Méthode :
- Commence TOUJOURS par read_transcript_metadata pour le contexte.
- Lis la transcription par chunks via read_segments — pas besoin de tout charger d'un coup.
- Si un terme métier (Elise, GED, ...) apparaît, utilise read_glossary.
- Si tu sens que la réunion fait référence à des points discutés ailleurs, regarde read_other_meeting_summaries.
- Quand tu as compris le contenu, appelle EN PARALLÈLE OU SÉQUENTIELLEMENT les trois fonctions terminales :
  emit_summary, emit_action_items, emit_decisions. Ces trois appels sont obligatoires (même si la liste est vide → tableau vide).

Règles strictes :
- Langue : français.
- Concis et factuel — n'invente rien qui ne soit pas dans la transcription.
- Pour les actions : extrait l'assignation et l'échéance UNIQUEMENT si elles sont explicitement mentionnées. Sinon assigneeName=null et dueDate=null.
- Catégorie de décision : "decision" ou "risk" uniquement.`

const emitSummaryTool: ToolDefinition<{ summary: string }, { summary: string }> = {
  name: 'emit_summary',
  description: 'Emit the markdown meeting summary. Call this exactly once.',
  parameters: obj(
    { summary: str({ description: 'Compte-rendu en markdown — # titres, ## sections, - listes.', maxLength: 8000 }) },
    { required: ['summary'] },
  ),
  handler: async () => ({ summary: '' }),
}

const emitActionItemsTool: ToolDefinition<{ items: AiActionItemInput[] }, { items: AiActionItemInput[] }> = {
  name: 'emit_action_items',
  description: 'Emit the list of action items extracted from the meeting. Call this exactly once. Pass an empty array if there are none.',
  parameters: obj(
    {
      items: arr(
        obj(
          {
            description: str({ description: 'What needs to be done', maxLength: 1000 }),
            assigneeName: str({ description: 'Name of the assignee if explicitly mentioned, else null. Use null literal, not the string "null".' }),
            dueDate: str({ description: 'Due date YYYY-MM-DD if mentioned, else null.' }),
          },
          { required: ['description'] },
        ),
        { maxItems: 50 },
      ),
    },
    { required: ['items'] },
  ),
  handler: async () => ({ items: [] }),
}

const emitDecisionsTool: ToolDefinition<{ items: AiDecisionInput[] }, { items: AiDecisionInput[] }> = {
  name: 'emit_decisions',
  description: 'Emit the list of decisions and risks. Call this exactly once. Pass an empty array if there are none.',
  parameters: obj(
    {
      items: arr(
        obj(
          {
            description: str({ description: 'The decision or risk', maxLength: 1000 }),
            category: str({ enum: ['decision', 'risk'] }),
          },
          { required: ['description', 'category'] },
        ),
        { maxItems: 50 },
      ),
    },
    { required: ['items'] },
  ),
  handler: async () => ({ items: [] }),
}

/**
 * Run the transcript agent. Returns the same shape as the existing
 * single-shot AiAnalysisResult so the caller can persist it identically.
 */
export async function runTranscriptAgent(
  runner: AgentRunnerService,
  logger: Logger,
  projectId: string,
  transcriptId: string,
): Promise<AiAnalysisResult> {
  const result = await runner.run<AiAnalysisResult>({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `Analyse la transcription dont l'identifiant est "${transcriptId}".`,
    tools: [
      ...buildTranscriptTools(transcriptId),
      readOtherMeetingsTool,
      readGlossaryTool,
    ],
    emitTools: [emitSummaryTool, emitActionItemsTool, emitDecisionsTool],
    maxIterations: 8,
    feature: 'meeting-analysis',
    projectId,
    combineEmits: (calls) => {
      const summaryCall = calls.find((c) => c.name === 'emit_summary')
      const actionCall = calls.find((c) => c.name === 'emit_action_items')
      const decisionCall = calls.find((c) => c.name === 'emit_decisions')
      const summary = (summaryCall?.args as { summary?: string } | undefined)?.summary ?? ''
      const actionItems: AiActionItemInput[] = ((actionCall?.args as { items?: unknown[] } | undefined)?.items ?? [])
        .filter((i): i is { description: string; assigneeName?: unknown; dueDate?: unknown } =>
          !!i && typeof (i as { description?: unknown }).description === 'string')
        .map((i) => {
          const out: AiActionItemInput = { description: i.description }
          if (typeof i.assigneeName === 'string' && i.assigneeName.length > 0) out.assigneeName = i.assigneeName
          if (typeof i.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.dueDate)) out.dueDate = i.dueDate
          return out
        })
      const decisions: AiDecisionInput[] = ((decisionCall?.args as { items?: unknown[] } | undefined)?.items ?? [])
        .filter((i): i is { description: string; category: unknown } =>
          !!i && typeof (i as { description?: unknown }).description === 'string')
        .map((i) => ({
          description: i.description,
          category: i.category === 'risk' ? 'risk' : 'decision',
        }))
      return { summary, actionItems, decisions }
    },
  })
  logger.log(
    `Transcript agent done — ${result.iterations} iter, ${result.toolCallsLog.length} tool calls, model=${result.model}`,
  )
  return result.output
}
