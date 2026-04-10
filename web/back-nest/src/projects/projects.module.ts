import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { PmController } from './pm.controller.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PhaseGateService } from './phase-gate.service.js';
import { AutomationModule } from '../automation/automation.module.js';

@Module({
  imports: [NotificationsModule, AutomationModule],
  controllers: [ProjectsController, PmController],
  providers: [ProjectsService, PhaseGateService],
  exports: [ProjectsService, PhaseGateService],
})
export class ProjectsModule {}
