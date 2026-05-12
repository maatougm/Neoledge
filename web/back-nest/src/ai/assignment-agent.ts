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

const SYSTEM_PROMPT = `Tu es un manager IT expérimenté qui aide un chef de projet à choisir le meilleur assigné pour chaque tâche IT.

Méthode (ORDRE OBLIGATOIRE) :
1. read_project_summary — contexte du projet.
2. read_candidate_tasks — toutes les tâches à assigner. Pour chaque tâche, identifie les compétences requises (frontend / backend / data / mobile / QA / DevOps / sécurité / design / business analyst / ...).
3. read_project_members — liste complète des candidats. Ce payload contient déjà : \`jobTitle\`, \`department\`, \`recentResolvedTitles\` (3 dernières tâches livrées), \`inProgressCount\`, \`totalAssignedThisProject\`. C'est la source PRIMAIRE.
4. read_member_history UNIQUEMENT si \`recentResolvedTitles\` est vide pour un candidat sérieux ET que \`jobTitle\` ne tranche pas. Évite les appels inutiles.
5. read_glossary si un terme de la tâche est ambigu (acronyme client, jargon métier).
6. emit_assignments — une entrée par tâche candidate, 1 à 3 suggestions classées par confiance décroissante.

Hiérarchie des signaux (du plus fort au plus faible) :
1. **\`jobTitle\`** : signal le plus fort. "Backend Engineer" → API/DB/serveur. "Frontend Engineer" / "UI Developer" → UI, écrans. "QA" / "Tester" → Bug, validation. "DevOps" / "SRE" → infra, CI, déploiement. "Data Engineer" → ETL, pipelines. "Designer" → maquettes, UX. Si \`jobTitle\` est null, descends d'un cran.
2. **\`recentResolvedTitles\`** : ce que le candidat livre réellement sur CE projet. Plus fiable que \`jobTitle\` quand les deux divergent.
3. **\`department\`** : signal secondaire utile si \`jobTitle\` est ambigu (ex. "Mobile" / "Plateforme").
4. **\`label\` (rôle plateforme)** : COARSE. Ne jamais utiliser SEUL pour trancher — "Member" couvre toutes les spécialités. Sert juste à exclure les "SpecificationTeam" pour des tâches techniques pures, sauf si leur jobTitle ou historique dit le contraire.
5. **Charge actuelle (\`inProgressCount\`)** : tie-breaker. Si deux candidats ont des compétences équivalentes, prends le moins chargé. Pénalise sérieusement au-delà de 5 WPs en cours.
6. **Familiarité projet (\`totalAssignedThisProject\`)** : tie-breaker secondaire — un membre déjà productif sur le projet a un avantage léger.

Règles de confiance :
- **0.90+** : \`jobTitle\` colle parfaitement ET \`recentResolvedTitles\` contient au moins une tâche similaire.
- **0.75 – 0.89** : \`jobTitle\` colle OU l'historique colle, mais pas les deux.
- **0.60 – 0.74** : signal indirect (department, type de tâche générique).
- **< 0.60** : ne propose pas — exclure du tableau \`suggestions\` plutôt qu'émettre du bruit.

Règles supplémentaires :
- **Diversité** : ne pas assigner toutes les tâches au même candidat si plusieurs sont qualifiés. Répartis sauf si la tâche exige une expertise rare.
- **Désigner un seul "champion"** : pour chaque tâche, la suggestion #1 doit être le candidat clair. Les #2/#3 sont des fallbacks.
- **Pas d'invention** : \`userId\` DOIT venir de read_project_members.
- **Aucun match crédible (>= 0.60)** → émets une entrée avec \`suggestions: []\`. Mieux vaut rien que du bruit.
- **\`rationale\` en français, max 140 caractères**, doit citer le signal concret utilisé : "Senior Frontend (jobTitle) — a déjà livré 'Page profil utilisateur'". Pas de phrases creuses.

Format de chaque suggestion :
- \`userId\` : exactement la valeur \`userId\` retournée par read_project_members.
- \`confidence\` : 0.60 à 1.0.
- \`rationale\` : 1 phrase courte référant à \`jobTitle\` / \`recentResolvedTitles\` / \`department\`.`

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
