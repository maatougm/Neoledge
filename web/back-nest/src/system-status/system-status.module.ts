import { Module } from '@nestjs/common';
import { SystemStatusController } from './system-status.controller.js';
import { SystemStatusService } from './system-status.service.js';
import { LogController } from './log.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';

@Module({
  imports: [PrismaModule],
  controllers: [SystemStatusController, LogController],
  providers: [SystemStatusService, PermissionsGuard],
})
export class SystemStatusModule {}
