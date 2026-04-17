import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Public health endpoint for uptime monitoring + readiness probes.
 * No authentication required so external monitoring can hit it freely.
 */
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async healthCheck() {
    const checks = {
      db: false,
      api: true,
    };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = true;
    } catch {
      checks.db = false;
    }
    const healthy = checks.db && checks.api;
    return {
      status: healthy ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? 'dev',
      uptime_seconds: Math.round((Date.now() - this.startedAt) / 1000),
      node: process.version,
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
