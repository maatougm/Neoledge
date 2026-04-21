import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AutomationService } from '../automation/automation.service.js';
import { CreateWorkPackageDto, UpdateWorkPackageDto, MoveWorkPackageDto } from './dto/work-package.dto.js';
import { AnalyticsCacheService } from '../analytics/analytics-cache.service.js';

export interface WorkPackageFilters {
  status?: string;
  type?: string;
  priority?: string;
  assigneeId?: string;
  parentId?: string | null;
  sprintId?: string;
  versionId?: string;
  q?: string;
  page?: number;
  limit?: number;
}

const USER_SELECT = { id: true, firstName: true, lastName: true, email: true, avatarPath: true };

@Injectable()
export class WorkPackagesService {
  private readonly logger = new Logger(WorkPackagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly automation: AutomationService,
    private readonly analyticsCache: AnalyticsCacheService,
  ) {}

  /** Log an entry to ProjectActivity. Fire-and-forget. */
  private async logActivity(projectId: string, userId: string, action: string, detail?: string): Promise<void> {
    try {
      await this.prisma.projectActivity.create({
        data: { projectId, userId, action, detail: detail ?? null },
      });
    } catch {
      // Never break the caller.
    }
  }

  /** Fire-and-forget notification for WP events. Never throws. */
  private async notifyWatchersAndAssignee(
    wpId: string,
    actorId: string,
    reason: 'Assignee' | 'Watcher' | 'StatusChange',
    title: string,
    message: string,
    projectId: string,
    /** Optional userId to exclude — used to avoid double-notifying when assignee & status both changed. */
    excludeUserId?: string,
  ): Promise<void> {
    try {
      const watchers = await this.prisma.workPackageWatcher.findMany({
        where: { workPackageId: wpId, userId: { not: actorId } },
        select: { userId: true },
      });
      const wp = await this.prisma.workPackage.findUnique({
        where: { id: wpId },
        select: { assigneeId: true },
      });
      const userIds = new Set<string>();
      if (wp?.assigneeId && wp.assigneeId !== actorId) userIds.add(wp.assigneeId);
      for (const w of watchers) userIds.add(w.userId);
      // Remove the explicitly excluded user (already notified via assignee path).
      if (excludeUserId) userIds.delete(excludeUserId);

      // Batch DB inserts in a single createMany to avoid N+1 writes.
      // Side effects that are per-user (socket emit) still run individually below.
      if (userIds.size > 0) {
        try {
          await this.prisma.notification.createMany({
            data: Array.from(userIds).map((userId) => ({
              userId,
              type: 'work_package',
              title,
              message,
              projectId,
              reason,
              entityType: 'work_package' as const,
              entityId: wpId,
              actorId,
              link: `/app/pm/projects/${projectId}/workpackages`,
            })),
            skipDuplicates: true,
          });
        } catch (e) {
          this.logger.error('notifyWatchersAndAssignee: createMany failed', e);
        }
      }
    } catch {
      // Never break the caller.
    }
  }

  /** Cross-project work packages for a specific user (assignee). Used by "Mes tâches". */
  async findForAssignee(userId: string, filters: { status?: string; q?: string; page?: number; limit?: number } = {}) {
    try {
      const page = Math.max(1, filters.page ?? 1);
      const limit = Math.min(200, Math.max(1, filters.limit ?? 100));
      const where: Record<string, unknown> = { assigneeId: userId, isDeleted: false };
      if (filters.status) where.status = filters.status;
      if (filters.q) where.title = { contains: filters.q };

      const [items, total] = await Promise.all([
        this.prisma.workPackage.findMany({
          where,
          include: {
            assignee: { select: USER_SELECT },
            author: { select: USER_SELECT },
            project: { select: { id: true, name: true } },
          },
          orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.workPackage.count({ where }),
      ]);
      return Result.ok({ items, total, page, limit });
    } catch (e) {
      this.logger.error('findForAssignee failed', e);
      return Result.fail<{ items: unknown[]; total: number; page: number; limit: number }>('Échec du chargement des tâches.');
    }
  }

  async findAll(projectId: string, filters: WorkPackageFilters = {}) {
    try {
      const page = Math.max(1, filters.page ?? 1);
      const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
      const where: Record<string, unknown> = { projectId, isDeleted: false };
      if (filters.status) where.status = filters.status;
      if (filters.type) where.type = filters.type;
      if (filters.priority) where.priority = filters.priority;
      if (filters.assigneeId) where.assigneeId = filters.assigneeId;
      if (filters.sprintId) where.sprintId = filters.sprintId;
      if (filters.versionId) where.versionId = filters.versionId;
      if (filters.parentId === null) where.parentId = null;
      else if (filters.parentId) where.parentId = filters.parentId;
      if (filters.q) where.title = { contains: filters.q };

      const [items, total] = await Promise.all([
        this.prisma.workPackage.findMany({
          where,
          include: {
            assignee: { select: USER_SELECT },
            author: { select: USER_SELECT },
            _count: { select: { children: true, watchers: true } },
          },
          orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.workPackage.count({ where }),
      ]);
      return Result.ok({ items, total, page, limit });
    } catch (e) {
      this.logger.error('findAll failed', e);
      return Result.fail<{ items: unknown[]; total: number; page: number; limit: number }>('Échec du chargement des work packages.');
    }
  }

  async findOne(id: string, projectId: string) {
    // Let DB errors propagate to the global exception filter — only handle the
    // explicit not-found case here so callers get a clean 404.
    const wp = await this.prisma.workPackage.findFirst({
      where: { id, projectId, isDeleted: false },
      include: {
        assignee: { select: USER_SELECT },
        author: { select: USER_SELECT },
        parent: { select: { id: true, title: true } },
        children: {
          where: { isDeleted: false },
          select: { id: true, title: true, status: true, type: true, assigneeId: true, percentDone: true },
          orderBy: { position: 'asc' },
        },
        watchers: { include: { user: { select: USER_SELECT } } },
        dependenciesOut: { include: { toWp: { select: { id: true, title: true, status: true } } } },
        dependenciesIn: { include: { fromWp: { select: { id: true, title: true, status: true } } } },
        customValues: { include: { customField: true } },
        sprint: { select: { id: true, name: true, status: true } },
        version: { select: { id: true, name: true, status: true } },
      },
    });
    if (!wp) return Result.fail('Work package introuvable.');
    return Result.ok(wp);
  }

  async create(projectId: string, dto: CreateWorkPackageDto, authorId: string) {
    try {
      if (!dto.title?.trim()) return Result.fail('Le titre est requis.');
      const maxPos = await this.prisma.workPackage.aggregate({
        where: { projectId, parentId: dto.parentId ?? null },
        _max: { position: true },
      });
      const wp = await this.prisma.workPackage.create({
        data: {
          projectId,
          title: dto.title.trim(),
          description: dto.description ?? null,
          type: dto.type ?? 'Task',
          status: dto.status ?? 'New',
          priority: dto.priority ?? 'Normal',
          assigneeId: dto.assigneeId ?? null,
          authorId,
          parentId: dto.parentId ?? null,
          sprintId: dto.sprintId ?? null,
          versionId: dto.versionId ?? null,
          boardColumnId: dto.boardColumnId ?? null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          estimatedHours: dto.estimatedHours ?? null,
          position: (maxPos._max.position ?? 0) + 1,
        },
        include: {
          assignee: { select: USER_SELECT },
          author: { select: USER_SELECT },
        },
      });
      // Notify assignee (if different from author)
      if (wp.assigneeId && wp.assigneeId !== authorId) {
        void this.notifications.notifyEnhanced({
          userId: wp.assigneeId,
          type: 'work_package_assigned',
          title: 'Nouvelle tâche assignée',
          message: `"${wp.title}" vous a été assigné`,
          projectId,
          reason: 'Assignee',
          entityType: 'work_package',
          entityId: wp.id,
          actorId: authorId,
          link: `/app/pm/projects/${projectId}/workpackages`,
        }).catch((e) => this.logger.error('notifyEnhanced (wp assignee create) failed', e));
      }
      void this.logActivity(projectId, authorId, 'work_package_created', `WP "${wp.title}" créé`);
      void this.automation.executeRulesForEvent(projectId, 'work_package_created', {
        workPackageId: wp.id, title: wp.title, type: wp.type, status: wp.status, assigneeId: wp.assigneeId,
      }).catch((e) => this.logger.error('automation work_package_created failed', e));
      void this.analyticsCache.invalidate('team_workload');
      return Result.ok(wp);
    } catch (e) {
      this.logger.error('create failed', e);
      return Result.fail('Échec de la création du work package.');
    }
  }

  async update(id: string, projectId: string, dto: UpdateWorkPackageDto, actorId?: string) {
    try {
      const existing = await this.prisma.workPackage.findFirst({ where: { id, projectId, isDeleted: false } });
      if (!existing) return Result.fail('Work package introuvable.');

      const data: Record<string, unknown> = {};
      const keys: (keyof UpdateWorkPackageDto)[] = ['title', 'description', 'type', 'status', 'priority', 'assigneeId', 'parentId', 'sprintId', 'versionId', 'boardColumnId', 'spentHours', 'percentDone', 'position', 'estimatedHours'];
      for (const k of keys) {
        if (dto[k] !== undefined) data[k] = dto[k];
      }
      if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
      if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;

      const wp = await this.prisma.workPackage.update({
        where: { id },
        data,
        include: {
          assignee: { select: USER_SELECT },
          author: { select: USER_SELECT },
        },
      });

      // Notification hooks (fire-and-forget, never throws).
      // De-dup rule: when both assignee and status change in the same PATCH, the
      // new assignee receives a single "Assignee" notification; the status-change
      // watcher blast explicitly skips that user to avoid double-notifying.
      if (actorId) {
        const newAssignee = dto.assigneeId;
        const assigneeChanged =
          newAssignee !== undefined && newAssignee !== existing.assigneeId && !!newAssignee;
        const statusChanged = dto.status !== undefined && dto.status !== existing.status;

        if (assigneeChanged) {
          void this.notifications.notifyEnhanced({
            userId: newAssignee as string,
            type: 'work_package_assigned',
            title: statusChanged
              ? `Tâche réassignée — statut : ${dto.status}`
              : 'Tâche réassignée',
            message: `"${wp.title}" vous a été assigné`,
            projectId,
            reason: 'Assignee',
            entityType: 'work_package',
            entityId: id,
            actorId,
            link: `/app/pm/projects/${projectId}/workpackages`,
          }).catch((e) => this.logger.error('notifyEnhanced (wp reassign) failed', e));
        }

        if (statusChanged) {
          // Pass the newly-assigned user as an exclusion so they don't receive a
          // second notification from the watcher blast.
          void this.notifyWatchersAndAssignee(
            id,
            actorId,
            'StatusChange',
            'Statut mis à jour',
            `"${wp.title}" → ${dto.status}`,
            projectId,
            assigneeChanged ? (newAssignee as string) : undefined,
          );
          void this.logActivity(projectId, actorId, 'work_package_status_changed', `"${wp.title}" : ${existing.status} → ${dto.status}`);
          void this.automation.executeRulesForEvent(projectId, 'work_package_status_changed', {
            workPackageId: id, title: wp.title, fromStatus: existing.status, toStatus: dto.status,
          }).catch((e) => this.logger.error('automation work_package_status_changed failed', e));
          void this.analyticsCache.invalidate('team_workload');
        }
      }

      return Result.ok(wp);
    } catch (e) {
      this.logger.error('update failed', e);
      return Result.fail('Échec de la mise à jour du work package.');
    }
  }

  async softDelete(id: string, projectId: string) {
    try {
      const existing = await this.prisma.workPackage.findFirst({ where: { id, projectId, isDeleted: false } });
      if (!existing) return Result.fail<void>('Work package introuvable.');
      await this.prisma.workPackage.update({ where: { id }, data: { isDeleted: true } });
      void this.analyticsCache.invalidate('team_workload');
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('softDelete failed', e);
      return Result.fail<void>('Échec de la suppression.');
    }
  }

  async moveCard(id: string, dto: MoveWorkPackageDto) {
    try {
      const data: Record<string, unknown> = {};
      if (dto.boardColumnId !== undefined) data.boardColumnId = dto.boardColumnId;
      if (dto.sprintId !== undefined) data.sprintId = dto.sprintId;
      if (dto.parentId !== undefined) data.parentId = dto.parentId;
      if (dto.position !== undefined) data.position = dto.position;
      const wp = await this.prisma.workPackage.update({ where: { id }, data });
      return Result.ok(wp);
    } catch (e) {
      this.logger.error('moveCard failed', e);
      return Result.fail('Échec du déplacement.');
    }
  }

  async addWatcher(workPackageId: string, userId: string) {
    try {
      const existing = await this.prisma.workPackageWatcher.findUnique({
        where: { workPackageId_userId: { workPackageId, userId } },
      });
      if (existing) return Result.ok(existing);
      const w = await this.prisma.workPackageWatcher.create({ data: { workPackageId, userId } });
      return Result.ok(w);
    } catch (e) {
      this.logger.error('addWatcher failed', e);
      return Result.fail('Échec de l\'ajout de l\'observateur.');
    }
  }

  async removeWatcher(workPackageId: string, userId: string) {
    try {
      await this.prisma.workPackageWatcher.deleteMany({ where: { workPackageId, userId } });
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('removeWatcher failed', e);
      return Result.fail<void>('Échec de la suppression de l\'observateur.');
    }
  }

  async addDependency(fromWpId: string, toWpId: string, type: string) {
    try {
      if (fromWpId === toWpId) return Result.fail('Impossible de créer une dépendance sur le même work package.');
      const d = await this.prisma.workPackageDependency.create({ data: { fromWpId, toWpId, type: type || 'relates' } });
      return Result.ok(d);
    } catch (e) {
      this.logger.error('addDependency failed', e);
      return Result.fail('Échec de l\'ajout de la dépendance.');
    }
  }

  async removeDependency(depId: string) {
    try {
      await this.prisma.workPackageDependency.delete({ where: { id: depId } });
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('removeDependency failed', e);
      return Result.fail<void>('Échec de la suppression de la dépendance.');
    }
  }

  async listCustomFields(projectId: string) {
    try {
      const fields = await this.prisma.workPackageCustomField.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
      });
      return Result.ok(fields);
    } catch {
      return Result.fail('Échec du chargement des champs personnalisés.');
    }
  }

  async createCustomField(projectId: string, name: string, fieldType: string, options?: string) {
    try {
      const f = await this.prisma.workPackageCustomField.create({
        data: { projectId, name, fieldType, options: options ?? null },
      });
      return Result.ok(f);
    } catch {
      return Result.fail('Échec de la création du champ.');
    }
  }

  async deleteCustomField(id: string) {
    try {
      await this.prisma.workPackageCustomField.delete({ where: { id } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec de la suppression du champ.');
    }
  }

  async upsertCustomValues(workPackageId: string, values: { customFieldId: string; value?: string }[]) {
    try {
      for (const v of values) {
        await this.prisma.workPackageCustomValue.upsert({
          where: { workPackageId_customFieldId: { workPackageId, customFieldId: v.customFieldId } },
          create: { workPackageId, customFieldId: v.customFieldId, value: v.value ?? null },
          update: { value: v.value ?? null },
        });
      }
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('upsertCustomValues failed', e);
      return Result.fail<void>('Échec de la mise à jour des valeurs.');
    }
  }
}
