import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenAiProvider } from './providers/openai.provider.js'
import { GeminiProvider } from './providers/gemini.provider.js'
import type { AiAnalysisResult } from './ai.types.js'

export interface IAiProvider {
  modelName: string
  analyze(transcriptText: string, speakerNames: string[]): Promise<AiAnalysisResult>
}

@Injectable()
export class AiProviderFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly openAi: OpenAiProvider,
    private readonly gemini: GeminiProvider,
  ) {}

  getProvider(): IAiProvider {
    const providerName = this.config.get<string>('AI_PROVIDER', 'openai').toLowerCase()
    if (providerName === 'gemini') return this.gemini
    return this.openAi
  }
}
