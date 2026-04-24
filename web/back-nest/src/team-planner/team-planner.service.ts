import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { DEFAULT_DAILY_CAPACITY_HOURS } from '../common/enums/statuses.js';

const DAILY_CAPACITY_HOURS = DEFAULT_DAILY_CAPACITY_HOURS;

@Injectable()
export class TeamPlannerService {
  private readonly logger = new Logger(TeamPlannerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getAssignments(filters: { from: string; to: string; userIds?: string[]; projectIds?: string[] }) {
    try {
      const from = new Date(filters.from);
      const to = new Date(filters.to);
      const where: Record<string, unknown> = {
        isDeleted: false,
        assigneeId: { not: null },
        OR: [
          { startDate: { lte: to }, dueDate: { gte: from } },
          { startDate: { gte: from, lte: to } },
          { dueDate: { gte: from, lte: to } },
        ],
      };
      if (filters.userIds?.length) where.assigneeId = { in: filters.userIds };
      if (filters.projectIds?.length) where.projectId = { in: filters.projectIds };

      const wps = await this.prisma.workPackage.findMany({
        where,
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true, avatarPath: true } },
          project: { select: { id: true, name: true } },
        },
        orderBy: { startDate: 'asc' },
      });

      const byUser = new Map<string, { user: unknown; items: unknown[] }>();
      for (const wp of wps) {
        if (!wp.assigneeId) continue;
        const key = wp.assigneeId;
        if (!byUser.has(key)) byUser.set(key, { user: wp.assignee, items: [] });
        byUser.get(key)!.items.push(wp);
      }
      return Result.ok(Array.from(byUser.values()));
    } catch (e) {
      this.logger.error('getAssignments failed', e);
      return Result.fail('Échec du planning.');
    }
  }

  async getCapacity(from: string, to: string) {
    try {
      const start = new Date(from);
      const end = new Date(to);
      const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);

      const users = await this.prisma.appUser.findMany({
        where: { isActive: true, role: { in: ['ProjectManager', 'SpecificationTeam', 'Member', 'DeploymentTeam'] } },
        select: { id: true, firstName: true, lastName: true },
      });

      const assignments = await this.prisma.workPackage.findMany({
        where: {
          isDeleted: false,
          assigneeId: { in: users.map((u) => u.id) },
          OR: [
            { startDate: { lte: end }, dueDate: { gte: start } },
          ],
        },
        select: { assigneeId: true, estimatedHours: true, startDate: true, dueDate: true },
      });

      return Result.ok(users.map((u) => {
        const userAssignments = assignments.filter((a) => a.assigneeId === u.id);
        const allocatedHours = userAssignments.reduce((s, a) => s + Number(a.estimatedHours ?? 0), 0);
        const capacityHours = days * DAILY_CAPACITY_HOURS;
        return {
          user: u,
          capacityHours,
          allocatedHours,
          utilizationPercent: capacityHours > 0 ? Math.round((allocatedHours / capacityHours) * 100) : 0,
        };
      }));
    } catch (e) {
      this.logger.error('getCapacity failed', e);
      return Result.fail('Échec de la capacité.');
    }
  }

  async getConflicts(from: string, to: string) {
    try {
      const assignments = await this.prisma.workPackage.findMany({
        where: {
          isDeleted: false,
          assigneeId: { not: null },
          startDate: { lte: new Date(to) },
          dueDate: { gte: new Date(from) },
        },
        select: { id: true, title: true, assigneeId: true, startDate: true, dueDate: true, project: { select: { id: true, name: true } } },
      });
      const byUser = new Map<string, typeof assignments>();
      for (const a of assignments) {
        if (!a.assigneeId) continue;
        if (!byUser.has(a.assigneeId)) byUser.set(a.assigneeId, []);
        byUser.get(a.assigneeId)!.push(a);
      }
      const conflicts: unknown[] = [];
      for (const [userId, items] of byUser.entries()) {
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i], b = items[j];
            if (!a.startDate || !a.dueDate || !b.startDate || !b.dueDate) continue;
            if (new Date(a.startDate) <= new Date(b.dueDate) && new Date(b.startDate) <= new Date(a.dueDate)) {
              conflicts.push({ userId, wp1: a, wp2: b });
            }
          }
        }
      }
      return Result.ok(conflicts);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async reassign(wpId: string, dto: { assigneeId: string; startDate?: string; dueDate?: string }) {
    try {
      const data: Record<string, unknown> = { assigneeId: dto.assigneeId };
      if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
      if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);
      const wp = await this.prisma.workPackage.update({ where: { id: wpId }, data });
      return Result.ok(wp);
    } catch {
      return Result.fail('Échec de la réaffectation.');
    }
  }

  async getUtilization(from: string, to: string) {
    return this.getCapacity(from, to);
  }
}
