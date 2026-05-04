import { Module } from '@nestjs/common';
import { AgileService } from './agile.service.js';
import { AgileController } from './agile.controller.js';
import { AutomationModule } from '../automation/automation.module.js';
import { CollaborationModule } from '../collaboration/collaboration.module.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  imports: [AutomationModule, CollaborationModule],
  controllers: [AgileController],
  providers: [AgileService, ProjectAccessGuard],
  exports: [AgileService],
})
export class AgileModule {}
