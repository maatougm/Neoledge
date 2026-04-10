import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AiAnalysisResult } from '../ai.types.js'

const SYSTEM_PROMPT = `Tu es un assistant expert en gestion de projet. Analyse la transcription de réunion suivante et retourne un JSON structuré (sans markdown, juste le JSON brut) avec exactement ce format:
{
  "summary": "compte-rendu en markdown (# titres, ## sections, - listes)",
  "actionItems": [{ "description": "...", "assigneeName": "nom ou null", "dueDate": "YYYY-MM-DD ou null" }],
  "decisions": [{ "description": "...", "category": "decision" | "risk" }]
}
Langue: français. Sois concis et factuel.`

@Injectable()
export class OpenAiProvider {
  private readonly logger = new Logger(OpenAiProvider.name)

  constructor(private readonly config: ConfigService) {}

  readonly modelName = 'gpt-4o-mini'

  async analyze(transcriptText: string, _speakerNames: string[]): Promise<AiAnalysisResult> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
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
      this.logger.error(`OpenAI API error: ${response.status} ${text}`)
      throw new Error(`OpenAI API error ${response.status}: ${text}`)
    }

    const data: unknown = await response.json()
    if (
      typeof data !== 'object' || data === null ||
      !Array.isArray((data as Record<string, unknown>)['choices']) ||
      (data as Record<string, unknown>)['choices'].length === 0
    ) {
      throw new Error(`Unexpected OpenAI response shape: ${JSON.stringify(data).slice(0, 200)}`)
    }
    const content: string =
      ((data as Record<string, unknown[]>)['choices'][0] as Record<string, Record<string, string>>)
        ?.['message']?.['content'] ?? ''

    return this.parseResult(content)
  }

  private parseResult(content: string): AiAnalysisResult {
    // Strip possible markdown code fences
    const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '')
    try {
      const parsed = JSON.parse(cleaned) as AiAnalysisResult
      return {
        summary: parsed.summary ?? '',
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      }
    } catch (e) {
      this.logger.error(`Failed to parse OpenAI response: ${content}`)
      throw new Error(`Invalid JSON from OpenAI: ${(e as Error).message}`)
    }
  }
}
