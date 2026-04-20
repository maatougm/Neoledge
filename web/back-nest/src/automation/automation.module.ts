import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AutomationService } from './automation.service.js';
import { AutomationController } from './automation.controller.js';
import { AutomationCleanupService } from './automation-cleanup.service.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AutomationController],
  providers: [AutomationService, AutomationCleanupService, ProjectAccessGuard],
  exports: [AutomationService],
})
export class AutomationModule {}
