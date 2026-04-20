import { Controller, Get, UseGuards } from '@nestjs/common';
import { SystemStatusService } from './system-status.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';

@Controller('admin/SystemStatus')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('system.view')
export class SystemStatusController {
  constructor(private readonly service: SystemStatusService) {}

  @Get()
  async getStatus() {
    return this.service.getStatus();
  }
}
