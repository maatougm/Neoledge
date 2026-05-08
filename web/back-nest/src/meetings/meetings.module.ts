import { Module } from '@nestjs/common'
import { MeetingsService } from './meetings.service.js'
import { MeetingsController } from './meetings.controller.js'
import { AgendaService } from './agenda.service.js'
import { AttendeesService } from './attendees.service.js'
import { OutcomesService } from './outcomes.service.js'
import { MeetingExtrasController } from './meeting-extras.controller.js'
import { LiveMeetingService } from './live-meeting.service.js'
import { LiveMeetingController } from './live-meeting.controller.js'
import { LiveCopilotService } from './live-copilot.service.js'
import { LiveCopilotController } from './live-copilot.controller.js'
import { LiveCopilotGateway } from './live-copilot.gateway.js'
import { AssemblyAiProvider } from './assemblyai.provider.js'
import { AiModule } from '../ai/ai.module.js'
import { AuthModule } from '../auth/auth.module.js'
import { NotificationsModule } from '../notifications/notifications.module.js'
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js'

@Module({
  imports: [AiModule, NotificationsModule, AuthModule],
  controllers: [MeetingsController, MeetingExtrasController, LiveMeetingController, LiveCopilotController],
  providers: [
    MeetingsService,
    AgendaService,
    AttendeesService,
    OutcomesService,
    LiveMeetingService,
    LiveCopilotService,
    LiveCopilotGateway,
    AssemblyAiProvider,
    ProjectAccessGuard,
  ],
  exports: [LiveCopilotService],
})
export class MeetingsModule {}
