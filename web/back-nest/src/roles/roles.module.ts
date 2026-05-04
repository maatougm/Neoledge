import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';

@Module({
  controllers: [RolesController],
  providers: [RolesService, ProjectAccessGuard],
  exports: [RolesService],
})
export class RolesModule {}
