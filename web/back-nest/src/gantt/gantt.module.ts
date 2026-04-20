import { Module } from '@nestjs/common';
import { GanttService } from './gantt.service.js';
import { GanttController } from './gantt.controller.js';
import { AutomationModule } from '../automation/automation.module.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  imports: [AutomationModule],
  controllers: [GanttController],
  providers: [GanttService, ProjectAccessGuard],
  exports: [GanttService],
})
export class GanttModule {}
