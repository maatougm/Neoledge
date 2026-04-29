import { Module } from '@nestjs/common'
import { CahierDesChargesController } from './cahier-des-charges.controller.js'
import { CahierDesChargesService } from './cahier-des-charges.service.js'
import { AiModule } from '../ai/ai.module.js'
import { AutomationModule } from '../automation/automation.module.js'

@Module({
  imports: [AiModule, AutomationModule],
  controllers: [CahierDesChargesController],
  providers: [CahierDesChargesService],
  exports: [CahierDesChargesService],
})
export class CahierDesChargesModule {}
