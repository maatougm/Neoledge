import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

interface JwtUser {
  userId: string;
  role: string;
}

@Controller('admin/Log')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('system.logs')
export class LogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getLogs(
    @Query('lines') lines?: string,
    @CurrentUser() user?: JwtUser,
  ): Promise<string[]> {
    const parsed = parseInt(lines ?? '100', 10);
    const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
    const limit = Math.min(safe, 500);

    const isAdmin = user?.role === 'Admin';

    const entries = await this.prisma.auditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    return entries
      .reverse()
      .map((e) => {
        const ts = e.createdAt.toISOString().replace('T', ' ').substring(0, 19);
        let who: string;
        if (e.user) {
          const name = `${e.user.firstName} ${e.user.lastName}`;
          // Only expose email to Admin callers.
          who = isAdmin ? `${name} <${e.user.email}>` : name;
        } else {
          who = 'system';
        }
        return `[${ts}] [INFO] ${e.action} | ${e.entityType}:${e.entityId} | by ${who}`;
      });
  }
}
