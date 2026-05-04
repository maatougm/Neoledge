import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';

/** Deletes AutomationLog rows older than 90 days — runs daily at 03:00. */
@Injectable()
export class AutomationCleanupService {
  private readonly logger = new Logger(AutomationCleanupService.name);
  private static readonly RETENTION_DAYS = 90;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 3 * * *')
  async purgeOldLogs(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - AutomationCleanupService.RETENTION_DAYS);

    try {
      const result = await this.prisma.automationLog.deleteMany({
        where: { executedAt: { lt: cutoff } },
      });
      this.logger.log(`AutomationLog purge: deleted ${result.count} rows older than ${AutomationCleanupService.RETENTION_DAYS} days`);
    } catch (e) {
      this.logger.error('AutomationLog purge failed', e);
    }
  }
}
