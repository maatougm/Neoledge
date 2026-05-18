import { Module } from '@nestjs/common'
import { AiService } from './ai.service.js'
import { AiProviderFactory } from './ai-provider.factory.js'
import { OpenAiProvider } from './providers/openai.provider.js'
import { GeminiProvider } from './providers/gemini.provider.js'
import { ZaiFallbackProvider } from './providers/zai-fallback.provider.js'
import { BacklogService } from './backlog.service.js'
import { BacklogController } from './backlog.controller.js'
import { AgentRunnerService } from './agent/agent-runner.service.js'
import { EmbeddingsModule } from './embeddings/embeddings.module.js'
import { EvalRetrievalController } from './eval-retrieval.controller.js'
import { NotificationsModule } from '../notifications/notifications.module.js'

@Module({
  imports: [NotificationsModule, EmbeddingsModule],
  controllers: [BacklogController, EvalRetrievalController],
  providers: [
    AiService,
    AiProviderFactory,
    OpenAiProvider,
    GeminiProvider,
    ZaiFallbackProvider,
    BacklogService,
    AgentRunnerService,
  ],
  exports: [AiService, ZaiFallbackProvider, BacklogService, AgentRunnerService, EmbeddingsModule],
})
export class AiModule {}
