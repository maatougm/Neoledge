import { Module } from '@nestjs/common'
import { CahierDesChargesController } from './cahier-des-charges.controller.js'
import { CahierDesChargesService } from './cahier-des-charges.service.js'
import { AiModule } from '../ai/ai.module.js'

@Module({
  imports: [AiModule],
  controllers: [CahierDesChargesController],
  providers: [CahierDesChargesService],
  exports: [CahierDesChargesService],
})
export class CahierDesChargesModule {}
