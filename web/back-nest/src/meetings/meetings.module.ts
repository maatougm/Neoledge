import { Module } from '@nestjs/common'
import { MeetingsService } from './meetings.service.js'
import { MeetingsController } from './meetings.controller.js'
import { AiModule } from '../ai/ai.module.js'

@Module({
  imports: [AiModule],
  controllers: [MeetingsController],
  providers: [MeetingsService],
})
export class MeetingsModule {}
