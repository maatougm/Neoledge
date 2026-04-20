import { Module } from '@nestjs/common';
import { ChecklistsService } from './checklists.service.js';
import { ChecklistsController } from './checklists.controller.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  controllers: [ChecklistsController],
  providers: [ChecklistsService, ProjectAccessGuard],
  exports: [ChecklistsService],
})
export class ChecklistsModule {}
