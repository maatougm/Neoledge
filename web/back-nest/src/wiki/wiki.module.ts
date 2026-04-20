import { Module } from '@nestjs/common';
import { WikiService } from './wiki.service.js';
import { WikiController } from './wiki.controller.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { PermissionsModule } from '../permissions/permissions.module.js';

@Module({
  imports: [PermissionsModule],
  controllers: [WikiController],
  providers: [WikiService, ProjectAccessGuard, PermissionsGuard],
  exports: [WikiService],
})
export class WikiModule {}
