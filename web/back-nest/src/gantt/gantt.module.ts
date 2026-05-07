import { Module } from '@nestjs/common';
import { GanttService } from './gantt.service.js';
import { GanttController } from './gantt.controller.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  imports: [],
  controllers: [GanttController],
  providers: [GanttService, ProjectAccessGuard],
  exports: [GanttService],
})
export class GanttModule {}
