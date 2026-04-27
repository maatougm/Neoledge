import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AiAnalysisResult } from '../ai.types.js'

// Shared fallback provider that targets Z.AI's OpenAI-compatible endpoint.
// Used when the primary AI provider (OpenAI or Gemini) errors out. Configured
// by AI_FALLBACK_* env vars so operators can override without touching the
// primary AI_PROVIDER wiring.
const SYSTEM_PROMPT = `Tu es un assistant expert en gestion de projet. Analyse la transcription de réunion suivante et retourne un JSON structuré (sans markdown, juste le JSON brut) avec exactement ce format:
{
  "summary": "compte-rendu en markdown (# titres, ## sections, - listes)",
  "actionItems": [{ "description": "...", "assigneeName": "nom ou null", "dueDate": "YYYY-MM-DD ou null" }],
  "decisions": [{ "description": "...", "category": "decision" | "risk" }]
}
Langue: français. Sois concis et factuel.`

@Injectable()
export class ZaiFallbackProvider {
  private readonly logger = new Logger(ZaiFallbackProvider.name)

  constructor(private readonly config: ConfigService) {}

  get modelName(): string {
    return this.config.get<string>('AI_FALLBACK_MODEL') ?? 'glm-4.5-air'
  }

  /** True when a fallback API key is configured. Callers gate on this. */
  isConfigured(): boolean {
    return Boolean(this.config.get<string>('AI_FALLBACK_API_KEY'))
  }

  async analyze(transcriptText: string, _speakerNames: string[]): Promise<AiAnalysisResult> {
    const apiKey = this.config.get<string>('AI_FALLBACK_API_KEY')
    if (!apiKey) throw new Error('AI_FALLBACK_API_KEY not configured')

    const baseUrl =
      this.config.get<string>('AI_FALLBACK_BASE_URL') ?? 'https://api.z.ai/api/coding/paas/v4'

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(180_000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: transcriptText },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      this.logger.error(`Z.AI fallback error: ${response.status} ${text.slice(0, 200)}`)
      throw new Error(`Z.AI fallback error ${response.status}`)
    }

    const data: unknown = await response.json()
    const content =
      ((data as Record<string, unknown[]>)?.['choices']?.[0] as Record<string, Record<string, string>>)
        ?.['message']?.['content'] ?? ''

    return this.parseResult(content)
  }

  /** Plain chat-completion for the cahier-des-charges generator. */
  async chat(systemPrompt: string, userPrompt: string, opts?: { maxTokens?: number; temperature?: number }): Promise<string> {
    const apiKey = this.config.get<string>('AI_FALLBACK_API_KEY')
    if (!apiKey) throw new Error('AI_FALLBACK_API_KEY not configured')

    const baseUrl =
      this.config.get<string>('AI_FALLBACK_BASE_URL') ?? 'https://api.z.ai/api/coding/paas/v4'

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(180_000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: opts?.temperature ?? 0.4,
        max_tokens: opts?.maxTokens ?? 8192,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      this.logger.error(`Z.AI fallback chat error: ${response.status} ${text.slice(0, 200)}`)
      throw new Error(`Z.AI fallback chat error ${response.status}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return data?.choices?.[0]?.message?.content ?? ''
  }

  private parseResult(content: string): AiAnalysisResult {
    const cleaned = content
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
    try {
      const parsed = JSON.parse(cleaned) as AiAnalysisResult
      return {
        summary: parsed.summary ?? '',
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      }
    } catch (e) {
      throw new Error(`Invalid JSON from Z.AI fallback: ${(e as Error).message}`)
    }
  }
}
