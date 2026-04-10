import { Module } from '@nestjs/common'
import { AiService } from './ai.service.js'
import { AiProviderFactory } from './ai-provider.factory.js'
import { OpenAiProvider } from './providers/openai.provider.js'
import { GeminiProvider } from './providers/gemini.provider.js'

@Module({
  providers: [AiService, AiProviderFactory, OpenAiProvider, GeminiProvider],
  exports: [AiService],
})
export class AiModule {}
