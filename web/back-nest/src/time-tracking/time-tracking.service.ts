import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class TimeTrackingService {
  private readonly logger = new Logger(TimeTrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findMyEntries(userId: string, filters: { from?: string; to?: string; projectId?: string; workPackageId?: string } = {}) {
    try {
      const where: Record<string, unknown> = { userId };
      if (filters.projectId) where.projectId = filters.projectId;
      if (filters.workPackageId) where.workPackageId = filters.workPackageId;
      if (filters.from || filters.to) {
        const dateRange: Record<string, Date> = {};
        if (filters.from) dateRange.gte = new Date(filters.from);
        if (filters.to) dateRange.lte = new Date(filters.to);
        where.spentOn = dateRange;
      }
      const entries = await this.prisma.timeEntry.findMany({
        where,
        include: {
          project: { select: { id: true, name: true } },
          workPackage: { select: { id: true, title: true } },
        },
        orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }],
      });
      return Result.ok(entries);
    } catch (e) {
      this.logger.error('findMyEntries failed', e);
      return Result.fail('Échec du chargement.');
    }
  }

  async findProjectEntries(projectId: string, filters: { from?: string; to?: string; userId?: string } = {}) {
    try {
      const where: Record<string, unknown> = { projectId };
      if (filters.userId) where.userId = filters.userId;
      if (filters.from || filters.to) {
        const dateRange: Record<string, Date> = {};
        if (filters.from) dateRange.gte = new Date(filters.from);
        if (filters.to) dateRange.lte = new Date(filters.to);
        where.spentOn = dateRange;
      }
      const entries = await this.prisma.timeEntry.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          workPackage: { select: { id: true, title: true } },
        },
        orderBy: { spentOn: 'desc' },
      });
      return Result.ok(entries);
    } catch {
      return Result.fail('Échec du chargement.');
    }
  }

  async create(userId: string, dto: { projectId: string; workPackageId?: string; hours: number; spentOn: string; activity?: string; comment?: string; isBillable?: boolean }) {
    try {
      if (dto.hours <= 0 || dto.hours > 24) return Result.fail('Heures invalides (0-24).');
      const e = await this.prisma.timeEntry.create({
        data: {
          userId,
          projectId: dto.projectId,
          workPackageId: dto.workPackageId ?? null,
          hours: dto.hours,
          spentOn: new Date(dto.spentOn),
          activity: dto.activity ?? 'development',
          comment: dto.comment ?? null,
          isBillable: dto.isBillable ?? true,
        },
      });

      // Update workPackage.spentHours
      if (dto.workPackageId) {
        const agg = await this.prisma.timeEntry.aggregate({
          where: { workPackageId: dto.workPackageId },
          _sum: { hours: true },
        });
        await this.prisma.workPackage.update({
          where: { id: dto.workPackageId },
          data: { spentHours: agg._sum.hours ?? 0 },
        });
      }

      return Result.ok(e);
    } catch (err) {
      this.logger.error('create timeEntry failed', err);
      return Result.fail('Échec de la saisie.');
    }
  }

  async update(id: string, userId: string, dto: { hours?: number; spentOn?: string; activity?: string; comment?: string; isBillable?: boolean; workPackageId?: string | null }) {
    try {
      const existing = await this.prisma.timeEntry.findUnique({ where: { id } });
      if (!existing) return Result.fail('Saisie introuvable.');
      if (existing.userId !== userId) return Result.fail('Accès refusé.');
      if (existing.lockedAt) return Result.fail('Saisie verrouillée.');

      const data: Record<string, unknown> = {};
      if (dto.hours !== undefined) data.hours = dto.hours;
      if (dto.spentOn !== undefined) data.spentOn = new Date(dto.spentOn);
      if (dto.activity !== undefined) data.activity = dto.activity;
      if (dto.comment !== undefined) data.comment = dto.comment;
      if (dto.isBillable !== undefined) data.isBillable = dto.isBillable;
      if (dto.workPackageId !== undefined) data.workPackageId = dto.workPackageId;

      const updated = await this.prisma.timeEntry.update({ where: { id }, data });
      return Result.ok(updated);
    } catch {
      return Result.fail('Échec de la mise à jour.');
    }
  }

  async delete(id: string, userId: string) {
    try {
      const existing = await this.prisma.timeEntry.findUnique({ where: { id } });
      if (!existing) return Result.fail<void>('Saisie introuvable.');
      if (existing.userId !== userId) return Result.fail<void>('Accès refusé.');
      if (existing.lockedAt) return Result.fail<void>('Saisie verrouillée.');
      await this.prisma.timeEntry.delete({ where: { id } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec de la suppression.');
    }
  }

  async getWeeklyGrid(userId: string, weekStart: string) {
    try {
      const start = new Date(weekStart);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const entries = await this.prisma.timeEntry.findMany({
        where: { userId, spentOn: { gte: start, lte: end } },
        include: { project: { select: { id: true, name: true } }, workPackage: { select: { id: true, title: true } } },
        orderBy: { spentOn: 'asc' },
      });
      return Result.ok({ start: start.toISOString().slice(0, 10), entries });
    } catch {
      return Result.fail('Échec du chargement de la semaine.');
    }
  }

  async getSummary(projectId: string) {
    try {
      const entries = await this.prisma.timeEntry.findMany({
        where: { projectId },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      });
      const byUser = new Map<string, { userId: string; name: string; hours: number }>();
      const byActivity = new Map<string, number>();
      let total = 0;
      for (const e of entries) {
        const h = Number(e.hours);
        total += h;
        byActivity.set(e.activity, (byActivity.get(e.activity) ?? 0) + h);
        const key = e.userId;
        const existing = byUser.get(key);
        const name = e.user ? `${e.user.firstName} ${e.user.lastName}` : 'Unknown';
        if (existing) existing.hours += h;
        else byUser.set(key, { userId: key, name, hours: h });
      }
      return Result.ok({
        total,
        byUser: Array.from(byUser.values()).sort((a, b) => b.hours - a.hours),
        byActivity: Array.from(byActivity.entries()).map(([activity, hours]) => ({ activity, hours })),
      });
    } catch {
      return Result.fail('Échec du résumé.');
    }
  }

  async lockPeriod(from: string, to: string, userId?: string) {
    try {
      const where: Record<string, unknown> = { spentOn: { gte: new Date(from), lte: new Date(to) }, lockedAt: null };
      if (userId) where.userId = userId;
      const r = await this.prisma.timeEntry.updateMany({ where, data: { lockedAt: new Date() } });
      return Result.ok({ count: r.count });
    } catch {
      return Result.fail('Échec du verrouillage.');
    }
  }

  // Hourly Rates
  async listRates() {
    try {
      const rates = await this.prisma.hourlyRate.findMany({
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true } },
        },
        orderBy: { validFrom: 'desc' },
      });
      return Result.ok(rates);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async createRate(dto: { userId: string; projectId?: string; rate: number; currency?: string; validFrom: string; validTo?: string }) {
    try {
      const r = await this.prisma.hourlyRate.create({
        data: {
          userId: dto.userId,
          projectId: dto.projectId ?? null,
          rate: dto.rate,
          currency: dto.currency ?? 'EUR',
          validFrom: new Date(dto.validFrom),
          validTo: dto.validTo ? new Date(dto.validTo) : null,
        },
      });
      return Result.ok(r);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async updateRate(id: string, dto: { rate?: number; currency?: string; validTo?: string | null }) {
    try {
      const data: Record<string, unknown> = {};
      if (dto.rate !== undefined) data.rate = dto.rate;
      if (dto.currency !== undefined) data.currency = dto.currency;
      if (dto.validTo !== undefined) data.validTo = dto.validTo ? new Date(dto.validTo) : null;
      const r = await this.prisma.hourlyRate.update({ where: { id }, data });
      return Result.ok(r);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async deleteRate(id: string) {
    try {
      await this.prisma.hourlyRate.delete({ where: { id } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }

  async getEffectiveRate(userId: string, projectId: string | null, date: Date) {
    // Project-specific rate wins; fall back to global (projectId=null). Latest validFrom <= date, with validTo null or >= date.
    const candidates = await this.prisma.hourlyRate.findMany({
      where: {
        userId,
        validFrom: { lte: date },
        OR: [{ validTo: null }, { validTo: { gte: date } }],
      },
      orderBy: { validFrom: 'desc' },
    });
    const projectMatch = candidates.find((r) => r.projectId === projectId);
    return projectMatch ?? candidates.find((r) => r.projectId === null) ?? null;
  }
}
