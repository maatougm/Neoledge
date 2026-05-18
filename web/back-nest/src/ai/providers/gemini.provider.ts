import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AiAnalysisResult } from '../ai.types.js'
import { redactPii } from '../../common/pii-redact.js'
import { wrapTranscriptForLlm, TRANSCRIPT_ANALYSIS_SYSTEM_PROMPT } from '../prompts/transcript-prompt.js'

const SYSTEM_PROMPT = TRANSCRIPT_ANALYSIS_SYSTEM_PROMPT

@Injectable()
export class GeminiProvider {
  private readonly logger = new Logger(GeminiProvider.name)

  constructor(private readonly config: ConfigService) {}

  readonly modelName = 'gemini-1.5-flash'

  async analyze(transcriptText: string, _speakerNames: string[]): Promise<AiAnalysisResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

    const { text: redacted } = redactPii(transcriptText)
    const safeUserMessage = wrapTranscriptForLlm(redacted)

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${SYSTEM_PROMPT}\n\n${safeUserMessage}` }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
        },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      this.logger.error(`Gemini API error: ${response.status} ${text}`)
      throw new Error(`Gemini API error ${response.status}: ${text}`)
    }

    const data: unknown = await response.json()
    if (
      typeof data !== 'object' || data === null ||
      !Array.isArray((data as Record<string, unknown>)['candidates']) ||
      (data as Record<string, unknown[]>)['candidates'].length === 0
    ) {
      throw new Error(`Unexpected Gemini response shape: ${JSON.stringify(data).slice(0, 200)}`)
    }
    const content: string =
      (((data as Record<string, unknown[]>)['candidates'][0] as Record<string, Record<string, unknown[]>>)
        ?.['content']?.['parts']?.[0] as Record<string, string>)?.['text'] ?? ''

    return this.parseResult(content)
  }

  private parseResult(content: string): AiAnalysisResult {
    const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '')
    try {
      const parsed = JSON.parse(cleaned) as AiAnalysisResult
      return {
        summary: parsed.summary ?? '',
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      }
    } catch (e) {
      this.logger.error(`Failed to parse Gemini response: ${content}`)
      throw new Error(`Invalid JSON from Gemini: ${(e as Error).message}`)
    }
  }
}
