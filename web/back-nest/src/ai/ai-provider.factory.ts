import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenAiProvider } from './providers/openai.provider.js'
import { GeminiProvider } from './providers/gemini.provider.js'
import { ZaiFallbackProvider } from './providers/zai-fallback.provider.js'
import type { AiAnalysisResult } from './ai.types.js'

export interface IAiProvider {
  modelName: string
  analyze(transcriptText: string, speakerNames: string[]): Promise<AiAnalysisResult>
}

export type ProviderName = 'zai' | 'openai' | 'gemini'

const VALID_PROVIDERS: ReadonlySet<ProviderName> = new Set(['zai', 'openai', 'gemini'])

/**
 * Resolves AI providers by name. AI_PROVIDER controls the primary;
 * AI_FALLBACK_PROVIDER is tried automatically when the primary throws.
 *
 * Defaults: primary=zai, fallback=openai. Z.AI's glm-4.5-air supports
 * OpenAI-compatible tool-use and is significantly cheaper than gpt-4o,
 * so it's the team's default starting point.
 */
@Injectable()
export class AiProviderFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly openAi: OpenAiProvider,
    private readonly gemini: GeminiProvider,
    private readonly zai: ZaiFallbackProvider,
  ) {}

  primaryName(): ProviderName {
    return this.normalizeName(this.config.get<string>('AI_PROVIDER'), 'zai')
  }

  fallbackName(): ProviderName | null {
    const raw = this.config.get<string>('AI_FALLBACK_PROVIDER')
    if (raw && raw.toLowerCase() === 'none') return null
    const candidate = this.normalizeName(raw, 'openai')
    // Never fall back to the same provider that just failed.
    if (candidate === this.primaryName()) return null
    return candidate
  }

  getPrimary(): IAiProvider {
    return this.byName(this.primaryName())
  }

  getFallback(): IAiProvider | null {
    const name = this.fallbackName()
    if (!name) return null
    const provider = this.byName(name)
    // Z.AI fallback also gates on the API key being present.
    if (name === 'zai' && !this.zai.isConfigured()) return null
    return provider
  }

  byName(name: ProviderName): IAiProvider {
    switch (name) {
      case 'zai':    return this.zai
      case 'gemini': return this.gemini
      case 'openai': return this.openAi
    }
  }

  private normalizeName(raw: string | undefined, fallback: ProviderName): ProviderName {
    const lower = (raw ?? '').toLowerCase()
    return VALID_PROVIDERS.has(lower as ProviderName) ? (lower as ProviderName) : fallback
  }
}
