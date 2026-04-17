import { Module } from '@nestjs/common'
import { MeetingsService } from './meetings.service.js'
import { MeetingsController } from './meetings.controller.js'
import { AgendaService } from './agenda.service.js'
import { AttendeesService } from './attendees.service.js'
import { OutcomesService } from './outcomes.service.js'
import { MeetingExtrasController } from './meeting-extras.controller.js'
import { AiModule } from '../ai/ai.module.js'

@Module({
  imports: [AiModule],
  controllers: [MeetingsController, MeetingExtrasController],
  providers: [MeetingsService, AgendaService, AttendeesService, OutcomesService],
})
export class MeetingsModule {}
