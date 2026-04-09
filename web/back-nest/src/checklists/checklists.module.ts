import { Module } from '@nestjs/common';
import { ChecklistsService } from './checklists.service.js';
import { ChecklistsController } from './checklists.controller.js';

@Module({
  controllers: [ChecklistsController],
  providers: [ChecklistsService],
  exports: [ChecklistsService],
})
export class ChecklistsModule {}
