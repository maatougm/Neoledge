import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller('admin/Log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class LogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getLogs(@Query('lines') lines = '200'): Promise<string[]> {
    const limit = Math.min(Math.max(Number(lines) || 200, 1), 1000);

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
        const who = e.user
          ? `${e.user.firstName} ${e.user.lastName} <${e.user.email}>`
          : 'system';
        return `[${ts}] [INFO] ${e.action} | ${e.entityType}:${e.entityId} | by ${who}`;
      });
  }
}
