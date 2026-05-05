import { Module } from '@nestjs/common'
import { MeetingsService } from './meetings.service.js'
import { MeetingsController } from './meetings.controller.js'
import { AgendaService } from './agenda.service.js'
import { AttendeesService } from './attendees.service.js'
import { OutcomesService } from './outcomes.service.js'
import { MeetingExtrasController } from './meeting-extras.controller.js'
import { LiveMeetingService } from './live-meeting.service.js'
import { LiveMeetingController } from './live-meeting.controller.js'
import { AssemblyAiProvider } from './assemblyai.provider.js'
import { AiModule } from '../ai/ai.module.js'
import { NotificationsModule } from '../notifications/notifications.module.js'
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js'

@Module({
  imports: [AiModule, NotificationsModule],
  controllers: [MeetingsController, MeetingExtrasController, LiveMeetingController],
  providers: [
    MeetingsService,
    AgendaService,
    AttendeesService,
    OutcomesService,
    LiveMeetingService,
    AssemblyAiProvider,
    ProjectAccessGuard,
  ],
})
export class MeetingsModule {}
