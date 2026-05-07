import { Module } from '@nestjs/common'
import { AiService } from './ai.service.js'
import { AiProviderFactory } from './ai-provider.factory.js'
import { OpenAiProvider } from './providers/openai.provider.js'
import { GeminiProvider } from './providers/gemini.provider.js'
import { ZaiFallbackProvider } from './providers/zai-fallback.provider.js'
import { BacklogService } from './backlog.service.js'
import { BacklogController } from './backlog.controller.js'
import { AgentRunnerService } from './agent/agent-runner.service.js'

@Module({
  controllers: [BacklogController],
  providers: [
    AiService,
    AiProviderFactory,
    OpenAiProvider,
    GeminiProvider,
    ZaiFallbackProvider,
    BacklogService,
    AgentRunnerService,
  ],
  exports: [AiService, ZaiFallbackProvider, BacklogService, AgentRunnerService],
})
export class AiModule {}
