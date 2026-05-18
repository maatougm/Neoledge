import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EmbeddingsService } from './embeddings.service.js'
import { EmbeddingIndexerService } from './embedding-indexer.service.js'

/**
 * @Global isn't necessary — only the cahier / agent-tools / meetings /
 * questionnaire modules import this. Keeping the dependency surface
 * explicit makes ownership clear.
 *
 * AiUsageModule is @Global so no re-import; PrismaModule is also @Global.
 */
@Module({
  imports: [ConfigModule],
  providers: [EmbeddingsService, EmbeddingIndexerService],
  exports: [EmbeddingsService, EmbeddingIndexerService],
})
export class EmbeddingsModule {}
