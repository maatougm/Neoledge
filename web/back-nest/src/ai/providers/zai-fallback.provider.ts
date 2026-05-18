import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AiAnalysisResult } from '../ai.types.js'
import { redactPii } from '../../common/pii-redact.js'
import { wrapTranscriptForLlm, TRANSCRIPT_ANALYSIS_SYSTEM_PROMPT } from '../prompts/transcript-prompt.js'

// Shared fallback provider that targets Z.AI's OpenAI-compatible endpoint.
// Used when the primary AI provider (OpenAI or Gemini) errors out. Configured
// by AI_FALLBACK_* env vars so operators can override without touching the
// primary AI_PROVIDER wiring.
const SYSTEM_PROMPT = TRANSCRIPT_ANALYSIS_SYSTEM_PROMPT

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

    const { text: redacted } = redactPii(transcriptText)
    const safeUserMessage = wrapTranscriptForLlm(redacted)

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
          { role: 'user', content: safeUserMessage },
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

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }
    // Distinguish a real failure (rate limit, server error rendered as a 200
    // body with { error: { ... } }) from a parseable response. Without this,
    // an empty `content` parses as "Invalid JSON" and the meaningful error
    // is lost — and the upstream fallback chain stays inactive.
    if (data?.error?.message) {
      throw new Error(`Z.AI fallback error (200 body): ${data.error.message.slice(0, 200)}`)
    }
    if (!Array.isArray(data?.choices) || data.choices.length === 0) {
      throw new Error('Z.AI fallback error: empty choices in response')
    }
    const content = data.choices[0]?.message?.content ?? ''
    return this.parseResult(content)
  }

  /** Plain chat-completion for the cahier-des-charges generator. */
  async chat(systemPrompt: string, userPrompt: string, opts?: { maxTokens?: number; temperature?: number }): Promise<string> {
    const { content } = await this.chatWithUsage(systemPrompt, userPrompt, opts)
    return content
  }

  /**
   * Like `chat()` but also returns the prompt/completion token counts the
   * provider reports. Use this when accurate cost tracking matters — the
   * char-count fallback is wildly off for compressed prompts.
   */
  async chatWithUsage(
    systemPrompt: string,
    userPrompt: string,
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
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
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    if (!Array.isArray(data?.choices) || data.choices.length === 0) {
      throw new Error('Z.AI fallback chat error: empty response')
    }
    return {
      content: data.choices[0]?.message?.content ?? '',
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    }
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
