import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

// Prisma unique-constraint violation (e.g. duplicate snapshot re-capture).
const PRISMA_UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class GanttService {
  private readonly logger = new Logger(GanttService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async getGanttPayload(projectId: string) {
    try {
      const [workPackages, milestones] = await Promise.all([
        this.prisma.workPackage.findMany({
          where: { projectId, isDeleted: false, OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] },
          // Projection: never dump LongText description or every column over HTTP.
          select: {
            id: true,
            projectId: true,
            title: true,
            status: true,
            priority: true,
            type: true,
            startDate: true,
            dueDate: true,
            percentDone: true,
            parentId: true,
            assigneeId: true,
            estimatedHours: true,
            position: true,
            assignee: { select: { id: true, firstName: true, lastName: true } },
            dependenciesOut: { select: { toWpId: true, type: true } },
          },
          orderBy: [{ startDate: 'asc' }, { position: 'asc' }],
        }),
        this.prisma.milestone.findMany({
          where: { projectId },
          orderBy: { date: 'asc' },
        }),
      ]);
      const dependencies = workPackages.flatMap((wp) =>
        wp.dependenciesOut.map((d) => ({ fromWpId: wp.id, toWpId: d.toWpId, type: d.type })),
      );
      return Result.ok({ workPackages, milestones, dependencies });
    } catch (e) {
      this.logger.error('getGanttPayload failed', e);
      return Result.fail('Échec du chargement du Gantt.');
    }
  }

  async listMilestones(projectId: string) {
    try {
      const items = await this.prisma.milestone.findMany({ where: { projectId }, orderBy: { date: 'asc' } });
      return Result.ok(items);
    } catch (e) {
      this.logger.error('listMilestones failed', e);
      return Result.fail('Échec du chargement des jalons.');
    }
  }

  async createMilestone(projectId: string, dto: { title: string; date: string; description?: string; color?: string; workPackageId?: string }) {
    try {
      const m = await this.prisma.milestone.create({
        data: {
          projectId,
          title: dto.title,
          date: new Date(dto.date),
          description: dto.description ?? null,
          color: dto.color ?? null,
          workPackageId: dto.workPackageId ?? null,
        },
      });
      return Result.ok(m);
    } catch (e) {
      this.logger.error('createMilestone failed', e);
      return Result.fail('Échec de la création du jalon.');
    }
  }

  async updateMilestone(id: string, dto: { title?: string; date?: string; description?: string; color?: string; isReached?: boolean }) {
    try {
      const data: Record<string, unknown> = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.date !== undefined) data.date = new Date(dto.date);
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.color !== undefined) data.color = dto.color;
      if (dto.isReached !== undefined) data.isReached = dto.isReached;
      const m = await this.prisma.milestone.update({ where: { id }, data });
      return Result.ok(m);
    } catch (e) {
      this.logger.error('updateMilestone failed', e);
      return Result.fail('Échec de la mise à jour du jalon.');
    }
  }

  /**
   * Defense-in-depth: even though the route is guarded by ProjectAccessGuard on
   * the URL's :projectId, verify the entity's projectId matches before delete.
   */
  async deleteMilestone(id: string, projectId?: string) {
    try {
      if (projectId) {
        const existing = await this.prisma.milestone.findUnique({ where: { id }, select: { projectId: true } });
        if (!existing) return Result.fail<void>('Jalon introuvable.');
        if (existing.projectId !== projectId) return Result.fail<void>('Jalon hors projet.');
      }
      await this.prisma.milestone.delete({ where: { id } });
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('deleteMilestone failed', e);
      return Result.fail<void>('Échec de la suppression du jalon.');
    }
  }

  /**
   * Atomic transition: the WHERE clause scopes to isReached=false, so two
   * concurrent /reach calls produce exactly one successful transition and one
   * no-op.
   *
   * Defense-in-depth projectId check: verifies the milestone belongs to the
   * URL's project even though ProjectAccessGuard already passed.
   */
  async markMilestoneReached(id: string, projectId?: string) {
    try {
      const existing = await this.prisma.milestone.findUnique({
        where: { id },
        select: { projectId: true, title: true, date: true, isReached: true },
      });
      if (!existing) return Result.fail('Jalon introuvable.');
      if (projectId && existing.projectId !== projectId) {
        return Result.fail('Jalon hors projet.');
      }
      if (existing.isReached) {
        const ms = await this.prisma.milestone.findUnique({ where: { id } });
        return Result.ok(ms);
      }

      // Conditional update: succeeds only if still unreached.
      const { count } = await this.prisma.milestone.updateMany({
        where: { id, isReached: false },
        data: { isReached: true },
      });
      if (count === 0) {
        const ms = await this.prisma.milestone.findUnique({ where: { id } });
        return Result.ok(ms);
      }

      const ms = await this.prisma.milestone.findUnique({ where: { id } });
      return Result.ok(ms);
    } catch (e) {
      this.logger.error('markMilestoneReached failed', e);
      return Result.fail('Échec de la mise à jour du jalon.');
    }
  }

  async captureBaseline(projectId: string, snapshotName: string, createdById: string) {
    try {
      const trimmed = snapshotName.trim();
      if (!trimmed) return Result.fail('Nom de snapshot requis.');
      if (trimmed.length > 120) return Result.fail('Nom de snapshot trop long (max 120 caractères).');

      // Fast pre-check — avoid scanning all WPs when the snapshotName is taken.
      const existing = await this.prisma.ganttBaseline.count({
        where: { projectId, snapshotName: trimmed },
      });
      if (existing > 0) {
        return Result.fail(`Nom de snapshot déjà utilisé: "${trimmed}".`);
      }

      const wps = await this.prisma.workPackage.findMany({
        where: { projectId, isDeleted: false },
        select: { id: true, startDate: true, dueDate: true, estimatedHours: true, percentDone: true },
      });
      await this.prisma.ganttBaseline.createMany({
        data: wps.map((wp) => ({
          projectId,
          workPackageId: wp.id,
          snapshotName: trimmed,
          startDate: wp.startDate,
          dueDate: wp.dueDate,
          estimatedHours: wp.estimatedHours,
          percentDone: wp.percentDone,
          createdById,
        })),
      });
      return Result.ok({ snapshotName: trimmed, count: wps.length });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === PRISMA_UNIQUE_VIOLATION) {
        // Concurrent re-capture won the race after our count() check.
        return Result.fail(`Nom de snapshot déjà utilisé: "${snapshotName}".`);
      }
      this.logger.error('captureBaseline failed', e);
      return Result.fail('Échec de la capture de la baseline.');
    }
  }

  async listBaselines(projectId: string) {
    try {
      const rows = await this.prisma.ganttBaseline.groupBy({
        by: ['snapshotName'],
        where: { projectId },
        _min: { snapshotDate: true },
        _count: { _all: true },
      });
      return Result.ok(rows.map((r) => ({ snapshotName: r.snapshotName, capturedAt: r._min.snapshotDate, wpCount: r._count._all })));
    } catch (e) {
      this.logger.error('listBaselines failed', e);
      return Result.fail('Échec du chargement des baselines.');
    }
  }

  async deleteBaseline(projectId: string, snapshotName: string) {
    try {
      await this.prisma.ganttBaseline.deleteMany({ where: { projectId, snapshotName } });
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('deleteBaseline failed', e);
      return Result.fail<void>('Échec de la suppression de la baseline.');
    }
  }

  /**
   * Surface deleted-WP drift with an explicit marker instead of masking it as
   * delta: 0. Also expose estimatedHours/percentDone deltas for completeness.
   */
  async compareBaseline(projectId: string, snapshotName: string) {
    try {
      const [baselines, current] = await Promise.all([
        this.prisma.ganttBaseline.findMany({ where: { projectId, snapshotName } }),
        this.prisma.workPackage.findMany({
          where: { projectId, isDeleted: false },
          select: { id: true, title: true, startDate: true, dueDate: true, percentDone: true, estimatedHours: true },
        }),
      ]);
      const currentMap = new Map(current.map((wp) => [wp.id, wp]));
      const drift = baselines.map((b) => {
        const wp = currentMap.get(b.workPackageId);
        const deleted = !wp;
        const dueDelta =
          wp && b.dueDate && wp.dueDate
            ? Math.round((new Date(wp.dueDate).getTime() - new Date(b.dueDate).getTime()) / (1000 * 60 * 60 * 24))
            : null;
        const percentDelta = wp ? wp.percentDone - b.percentDone : null;
        const estHoursDelta =
          wp && b.estimatedHours != null && wp.estimatedHours != null
            ? Number(wp.estimatedHours) - Number(b.estimatedHours)
            : null;
        return {
          workPackageId: b.workPackageId,
          title: wp?.title ?? '(deleted)',
          deleted,
          baseline: {
            startDate: b.startDate,
            dueDate: b.dueDate,
            percentDone: b.percentDone,
            estimatedHours: b.estimatedHours,
          },
          current: wp
            ? {
                startDate: wp.startDate,
                dueDate: wp.dueDate,
                percentDone: wp.percentDone,
                estimatedHours: wp.estimatedHours,
              }
            : null,
          delta: dueDelta,
          percentDoneDelta: percentDelta,
          estimatedHoursDelta: estHoursDelta,
        };
      });
      return Result.ok(drift);
    } catch (e) {
      this.logger.error('compareBaseline failed', e);
      return Result.fail('Échec de la comparaison.');
    }
  }
}
