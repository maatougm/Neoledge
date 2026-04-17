import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { AutomationService } from '../automation/automation.service.js';

@Injectable()
export class GanttService {
  private readonly logger = new Logger(GanttService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly automation: AutomationService,
  ) {}

  async getGanttPayload(projectId: string) {
    try {
      const [workPackages, milestones] = await Promise.all([
        this.prisma.workPackage.findMany({
          where: { projectId, isDeleted: false, OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] },
          include: {
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
    } catch {
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
    } catch {
      return Result.fail('Échec de la mise à jour du jalon.');
    }
  }

  async deleteMilestone(id: string) {
    try {
      await this.prisma.milestone.delete({ where: { id } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec de la suppression du jalon.');
    }
  }

  async markMilestoneReached(id: string) {
    const r = await this.updateMilestone(id, { isReached: true });
    const ms = r.value as { projectId?: string; title?: string; date?: Date } | undefined;
    if (r.isSuccess && ms?.projectId) {
      void this.automation.executeRulesForEvent(ms.projectId, 'milestone_reached', {
        milestoneId: id, title: ms.title, date: ms.date,
      });
    }
    return r;
  }

  async captureBaseline(projectId: string, snapshotName: string, createdById: string) {
    try {
      const wps = await this.prisma.workPackage.findMany({ where: { projectId, isDeleted: false } });
      await this.prisma.ganttBaseline.createMany({
        data: wps.map((wp) => ({
          projectId,
          workPackageId: wp.id,
          snapshotName,
          startDate: wp.startDate,
          dueDate: wp.dueDate,
          estimatedHours: wp.estimatedHours,
          percentDone: wp.percentDone,
          createdById,
        })),
      });
      return Result.ok({ snapshotName, count: wps.length });
    } catch (e) {
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
    } catch {
      return Result.fail<void>('Échec de la suppression de la baseline.');
    }
  }

  async compareBaseline(projectId: string, snapshotName: string) {
    try {
      const [baselines, current] = await Promise.all([
        this.prisma.ganttBaseline.findMany({ where: { projectId, snapshotName } }),
        this.prisma.workPackage.findMany({ where: { projectId, isDeleted: false } }),
      ]);
      const currentMap = new Map(current.map((wp) => [wp.id, wp]));
      const drift = baselines.map((b) => {
        const wp = currentMap.get(b.workPackageId);
        return {
          workPackageId: b.workPackageId,
          title: wp?.title ?? '(deleted)',
          baseline: { startDate: b.startDate, dueDate: b.dueDate, percentDone: b.percentDone },
          current: wp ? { startDate: wp.startDate, dueDate: wp.dueDate, percentDone: wp.percentDone } : null,
          delta: wp && b.dueDate && wp.dueDate
            ? Math.round((new Date(wp.dueDate).getTime() - new Date(b.dueDate).getTime()) / (1000 * 60 * 60 * 24))
            : 0,
        };
      });
      return Result.ok(drift);
    } catch (e) {
      this.logger.error('compareBaseline failed', e);
      return Result.fail('Échec de la comparaison.');
    }
  }
}
