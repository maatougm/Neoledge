import { Global, Module } from '@nestjs/common'
import { AiUsageService } from './ai-usage.service.js'
import { AiUsageController } from './ai-usage.controller.js'

/**
 * Global so any feature module (cahier, meetings, backlog, ai) can inject
 * AiUsageService without re-registering.
 */
@Global()
@Module({
  providers: [AiUsageService],
  controllers: [AiUsageController],
  exports: [AiUsageService],
})
export class AiUsageModule {}
