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

      // [Fix-5] Validate cross-project reassignment via workPackageId.
      if (dto.workPackageId) {
        const wp = await this.prisma.workPackage.findUnique({ where: { id: dto.workPackageId } });
        if (!wp) return Result.fail('Work package introuvable.');
        if (wp.projectId !== existing.projectId) {
          return Result.fail('Le work package appartient à un autre projet.');
        }
        if (wp.isDeleted) return Result.fail('Work package supprimé.');
      }

      const data: Record<string, unknown> = {};
      if (dto.hours !== undefined) data.hours = dto.hours;
      if (dto.spentOn !== undefined) data.spentOn = new Date(dto.spentOn);
      if (dto.activity !== undefined) data.activity = dto.activity;
      if (dto.comment !== undefined) data.comment = dto.comment;
      if (dto.isBillable !== undefined) data.isBillable = dto.isBillable;
      if (dto.workPackageId !== undefined) data.workPackageId = dto.workPackageId;

      // [Fix-6] Atomic lock check: add lockedAt: null predicate so a concurrent
      // lockPeriod call cannot race past us. updateMany returns count=0 if
      // the row was locked (or deleted) between our read and write.
      const result = await this.prisma.timeEntry.updateMany({
        where: { id, userId, lockedAt: null },
        data,
      });
      if (result.count === 0) return Result.fail('Saisie verrouillée ou introuvable.');

      const updated = await this.prisma.timeEntry.findUnique({ where: { id } });
      return Result.ok(updated);
    } catch (e) {
      this.logger.error('update timeEntry failed', e);
      return Result.fail('Échec de la mise à jour.');
    }
  }

  async delete(id: string, userId: string) {
    try {
      const existing = await this.prisma.timeEntry.findUnique({ where: { id } });
      if (!existing) return Result.fail<void>('Saisie introuvable.');
      if (existing.userId !== userId) return Result.fail<void>('Accès refusé.');

      // [Fix-6] Atomic lock check: add lockedAt: null predicate.
      const result = await this.prisma.timeEntry.deleteMany({
        where: { id, userId, lockedAt: null },
      });
      if (result.count === 0) return Result.fail<void>('Saisie verrouillée ou introuvable.');
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('delete timeEntry failed', e);
      return Result.fail<void>('Échec de la suppression.');
    }
  }

  async getWeeklyGrid(userId: string, weekStart: string, timezone = 'Europe/Paris') {
    try {
      // [Fix-3] Parse weekStart as a plain YYYY-MM-DD date in the user's timezone
      // to avoid UTC midnight misalignment on DST boundaries.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
        return Result.fail('weekStart doit être au format YYYY-MM-DD.');
      }
      const [year, month, day] = weekStart.split('-').map(Number);
      // Build the start boundary as midnight in the target timezone expressed as UTC.
      const startUtc = this.localMidnightUtc(year, month, day, timezone);
      const endDate = new Date(startUtc.getTime() + 6 * 86400000); // +6 days in ms

      const entries = await this.prisma.timeEntry.findMany({
        where: { userId, spentOn: { gte: startUtc, lte: endDate } },
        include: { project: { select: { id: true, name: true } }, workPackage: { select: { id: true, title: true } } },
        orderBy: { spentOn: 'asc' },
      });
      return Result.ok({ start: weekStart, timezone, entries });
    } catch (e) {
      this.logger.error('getWeeklyGrid failed', e);
      return Result.fail('Échec du chargement de la semaine.');
    }
  }

  /**
   * Returns a Date whose UTC value corresponds to midnight of (year, month, day)
   * in the given IANA timezone. Uses Intl.DateTimeFormat to find the UTC offset
   * at that instant without relying on a third-party date library.
   */
  private localMidnightUtc(year: number, month: number, day: number, timezone: string): Date {
    // First approximation: midnight UTC for that date.
    const approx = new Date(Date.UTC(year, month - 1, day));
    // Use the formatter to find the local wall-clock reading at that UTC instant.
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(approx);
    const p = (type: string) => Number(parts.find((x) => x.type === type)?.value ?? '0');
    // The offset = approx(UTC) minus the local time it represents.
    const localUtcMs = Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'), p('second'));
    const offsetMs = approx.getTime() - localUtcMs;
    // Midnight local = UTC midnight of the target date + offset.
    return new Date(Date.UTC(year, month - 1, day) + offsetMs);
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
      const validFrom = new Date(dto.validFrom);
      const validTo = dto.validTo ? new Date(dto.validTo) : null;

      // [Fix-7] Reject if validTo is before validFrom.
      if (validTo && validTo <= validFrom) {
        return Result.fail('validTo doit être postérieur à validFrom.');
      }

      // [Fix-7] Reject overlapping rate windows for the same (userId, projectId).
      // A conflict exists when an existing rate's interval overlaps [validFrom, validTo].
      const projectId = dto.projectId ?? null;
      const overlap = await this.prisma.hourlyRate.findFirst({
        where: {
          userId: dto.userId,
          projectId,
          validFrom: { lte: validTo ?? new Date('9999-12-31') },
          OR: [{ validTo: null }, { validTo: { gte: validFrom } }],
        },
      });
      if (overlap) {
        return Result.fail(
          'Un tarif horaire couvre déjà cette période. Fermez le tarif existant avant d\'en créer un nouveau.',
        );
      }

      const r = await this.prisma.hourlyRate.create({
        data: {
          userId: dto.userId,
          projectId,
          rate: dto.rate,
          currency: dto.currency ?? 'EUR',
          validFrom,
          validTo,
        },
      });
      return Result.ok(r);
    } catch (e) {
      this.logger.error('createRate failed', e);
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
