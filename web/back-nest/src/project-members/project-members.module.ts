import { Module } from '@nestjs/common';
import { ProjectMembersService } from './project-members.service.js';
import { ProjectMembersController } from './project-members.controller.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [ProjectMembersController],
  providers: [ProjectMembersService],
  exports: [ProjectMembersService],
})
export class ProjectMembersModule {}
