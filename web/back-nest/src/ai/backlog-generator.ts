import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/** Shape returned by the AI for a proposed backlog. */
export interface ProposedEpic {
  title: string;
  description: string;
  priority: 'Low' | 'Normal' | 'High' | 'Critical';
  estimatedHours: number;
  children: ProposedTask[];
}

interface ProposedTask {
  title: string;
  description: string;
  type: 'Task' | 'Bug' | 'Feature';
  priority: 'Low' | 'Normal' | 'High' | 'Critical';
  estimatedHours: number;
}

export interface ProposedBacklog {
  epics: ProposedEpic[];
}

const SYSTEM_PROMPT = `Tu es un chef de projet senior. À partir du contexte fourni (réponses questionnaire + cahier des charges résumé + extraits de réunions), propose un backlog structuré en Epics et tâches.

Règles strictes :
- 3 à 8 Epics fonctionnels maximum.
- Chaque Epic contient 2 à 8 tâches concrètes et implémentables.
- Estimation en heures réaliste (1-80h par tâche).
- Priorité parmi : Low, Normal, High, Critical.
- Type tâche parmi : Task, Feature, Bug.
- Langue : français. Sois concis, factuel, orienté livrable.

RÈGLE ANTI-HALLUCINATION CRITIQUE : N'invente AUCUNE exigence qui ne soit ni dans le questionnaire, ni dans le cahier, ni dans les réunions. Si une zone fonctionnelle est mentionnée mais sans détails, émets un epic minimal "Investigation: <topic>" avec une seule tâche "Définir <topic> avec le client" plutôt que de fabriquer du périmètre. Mieux vaut un backlog plus court et honnête qu'un backlog enflé de tâches inventées.

Réponds UNIQUEMENT en JSON brut (pas de markdown, pas de code-fence), au format exact :
{
  "epics": [
    {
      "title": "...",
      "description": "...",
      "priority": "Normal",
      "estimatedHours": 40,
      "children": [
        { "title": "...", "description": "...", "type": "Task", "priority": "Normal", "estimatedHours": 8 }
      ]
    }
  ]
}`;

const VALID_PRIORITIES = new Set(['Low', 'Normal', 'High', 'Critical']);
const VALID_TYPES = new Set(['Task', 'Bug', 'Feature']);

/**
 * Call OpenAI (shared pattern with OpenAiProvider.analyze) to generate a
 * structured backlog from the project context. Throws on network/parse error
 * so the caller can return a clean HTTP 502.
 */
export async function generateBacklogViaOpenAi(
  config: ConfigService,
  logger: Logger,
  userContext: string,
): Promise<ProposedBacklog> {
  const apiKey = config.get<string>('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const baseUrl = config.get<string>('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1';
  const model = config.get<string>('AI_MODEL') ?? 'gpt-4o-mini';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(90_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContext },
      ],
      temperature: 0.4,
      max_tokens: 6000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error(`OpenAI backlog error ${response.status}: ${text.slice(0, 200)}`);
    throw new Error(`OpenAI API ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    logger.error(`OpenAI backlog response was not valid JSON: ${cleaned.slice(0, 200)}`);
    throw new Error(`Réponse IA invalide : ${(e as Error).message}`);
  }
  return sanitizeBacklog(parsed);
}

/** Trust-no-one sanitizer. Strips unknown keys, clamps numbers, drops invalid rows. */
export function sanitizeBacklog(input: unknown): ProposedBacklog {
  if (!input || typeof input !== 'object') return { epics: [] };
  const raw = input as { epics?: unknown };
  if (!Array.isArray(raw.epics)) return { epics: [] };

  const epics: ProposedEpic[] = [];
  // Hard caps to prevent DoS / accidental DB bloat from a crafted payload
  // or a hallucinated AI response.
  const MAX_EPICS = 20;
  const MAX_TASKS_PER_EPIC = 30;
  for (const rawEpic of raw.epics.slice(0, MAX_EPICS)) {
    if (!rawEpic || typeof rawEpic !== 'object') continue;
    const e = rawEpic as Record<string, unknown>;
    const title = typeof e.title === 'string' ? e.title.trim().slice(0, 255) : '';
    if (!title) continue;

    const childrenRaw = Array.isArray(e.children) ? e.children.slice(0, MAX_TASKS_PER_EPIC) : [];
    const children: ProposedTask[] = [];
    for (const rawChild of childrenRaw) {
      if (!rawChild || typeof rawChild !== 'object') continue;
      const c = rawChild as Record<string, unknown>;
      const cTitle = typeof c.title === 'string' ? c.title.trim().slice(0, 255) : '';
      if (!cTitle) continue;
      children.push({
        title: cTitle,
        description: typeof c.description === 'string' ? c.description.slice(0, 2000) : '',
        type: VALID_TYPES.has(c.type as string) ? (c.type as ProposedTask['type']) : 'Task',
        priority: VALID_PRIORITIES.has(c.priority as string)
          ? (c.priority as ProposedTask['priority'])
          : 'Normal',
        estimatedHours: clampHours(c.estimatedHours),
      });
    }

    epics.push({
      title,
      description: typeof e.description === 'string' ? e.description.slice(0, 2000) : '',
      priority: VALID_PRIORITIES.has(e.priority as string)
        ? (e.priority as ProposedEpic['priority'])
        : 'Normal',
      estimatedHours: clampHours(e.estimatedHours),
      children,
    });
  }
  return { epics };
}

function clampHours(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(1000, Math.round(n * 100) / 100);
}
