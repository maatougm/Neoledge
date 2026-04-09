import { Module } from '@nestjs/common';
import { SystemStatusController } from './system-status.controller.js';
import { SystemStatusService } from './system-status.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [SystemStatusController],
  providers: [SystemStatusService],
})
export class SystemStatusModule {}
