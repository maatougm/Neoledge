import { Module } from '@nestjs/common';
import { GanttService } from './gantt.service.js';
import { GanttController } from './gantt.controller.js';
import { AutomationModule } from '../automation/automation.module.js';

@Module({
  imports: [AutomationModule],
  controllers: [GanttController],
  providers: [GanttService],
  exports: [GanttService],
})
export class GanttModule {}
