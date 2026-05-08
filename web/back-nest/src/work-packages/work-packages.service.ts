import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateWorkPackageDto, UpdateWorkPackageDto, MoveWorkPackageDto } from './dto/work-package.dto.js';
import { AnalyticsCacheService } from '../analytics/analytics-cache.service.js';
import { AgentRunnerService } from '../ai/agent/agent-runner.service.js';
import { runAssignmentAgent, type AssignmentSuggestionForWp } from '../ai/assignment-agent.js';

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
    private readonly analyticsCache: AnalyticsCacheService,
    private readonly agentRunner: AgentRunnerService,
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

  /**
   * Notify the project's PM when a WP transitions into AwaitingReview so they
   * can approve (Resolved) or reject (back to InProgress) the completed work.
   * Skipped silently if the PM is the same user who made the transition.
   */
  private async notifyPmOnAwaitingReview(
    projectId: string,
    wpId: string,
    wpTitle: string,
    actorId: string,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, projectManagerId: true },
    });
    if (!project || !project.projectManagerId) return;
    if (project.projectManagerId === actorId) return;
    await this.prisma.notification.create({
      data: {
        userId: project.projectManagerId,
        type: 'work_package_awaiting_review',
        reason: 'AwaitingReview',
        title: 'Tâche à valider',
        message: `"${wpTitle}" est en attente de votre validation (projet « ${project.name} »).`,
        projectId,
        entityType: 'work_package',
        entityId: wpId,
        actorId,
        link: `/app/pm/projects/${projectId}/workpackages?wpId=${wpId}`,
      },
    });
  }

  /** Cross-project work packages for a specific user (assignee). Used by "Mes tâches". */
  async findForAssignee(userId: string, filters: {
    status?: string;
    q?: string;
    projectId?: string;
    sprintId?: string;
    page?: number;
    limit?: number;
  } = {}) {
    try {
      const page = Math.max(1, filters.page ?? 1);
      const limit = Math.min(200, Math.max(1, filters.limit ?? 100));
      const where: Record<string, unknown> = { assigneeId: userId, isDeleted: false };
      if (filters.status) where.status = filters.status;
      if (filters.q) where.title = { contains: filters.q };
      if (filters.projectId) where.projectId = filters.projectId;
      if (filters.sprintId) where.sprintId = filters.sprintId;

      const [items, total] = await Promise.all([
        this.prisma.workPackage.findMany({
          where,
          include: {
            assignee: { select: USER_SELECT },
            author: { select: USER_SELECT },
            project: { select: { id: true, name: true } },
            sprint: { select: { id: true, name: true, status: true } },
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

  /**
   * Top-N urgent OPEN tasks (status in {New, InProgress, AwaitingReview}) for
   * the Member dashboard. Ordering: overdue first, then ascending due date,
   * then priority desc. Default limit 6.
   */
  async findTodayForAssignee(userId: string, limit = 6) {
    try {
      const cap = Math.min(20, Math.max(1, limit));
      const items = await this.prisma.workPackage.findMany({
        where: {
          assigneeId: userId,
          isDeleted: false,
          status: { in: ['New', 'InProgress', 'AwaitingReview'] },
        },
        include: {
          project: { select: { id: true, name: true } },
          sprint: { select: { id: true, name: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        take: cap,
      });
      return Result.ok({ items });
    } catch (e) {
      this.logger.error('findTodayForAssignee failed', e);
      return Result.fail<{ items: unknown[] }>('Échec du chargement des tâches du jour.');
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
      // C1: cross-project parent guard. Skip when parentId is null/undefined.
      if (dto.parentId) {
        const parent = await this.prisma.workPackage.findUnique({
          where: { id: dto.parentId },
          select: { id: true, projectId: true },
        });
        if (!parent || parent.projectId !== projectId) {
          throw new BadRequestException('parentId must belong to same project');
        }
      }
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
      // Notify assignee (if different from author). Deep-link goes to the
      // assignee's "Mes tâches" view — the PM workpackages page 403s for
      // Member-role assignees.
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
          link: `/app/team/my-tasks?projectId=${projectId}`,
        }).catch((e) => this.logger.error('notifyEnhanced (wp assignee create) failed', e));
      }
      void this.logActivity(projectId, authorId, 'work_package_created', `WP "${wp.title}" créé`);
      void this.analyticsCache.invalidate('team_workload');
      return Result.ok(wp);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error('create failed', e);
      return Result.fail('Échec de la création du work package.');
    }
  }

  async update(id: string, projectId: string, dto: UpdateWorkPackageDto, actorId?: string) {
    try {
      const existing = await this.prisma.workPackage.findFirst({ where: { id, projectId, isDeleted: false } });
      if (!existing) return Result.fail('Work package introuvable.');

      // C2: reject self-parent cycles. null/undefined mean "no change" or "clear" — OK.
      if (dto.parentId !== undefined && dto.parentId !== null) {
        if (dto.parentId === id) {
          throw new BadRequestException('A work package cannot be its own parent');
        }
        // C1: cross-project parent guard on update.
        const parent = await this.prisma.workPackage.findUnique({
          where: { id: dto.parentId },
          select: { id: true, projectId: true },
        });
        if (!parent || parent.projectId !== projectId) {
          throw new BadRequestException('parentId must belong to same project');
        }
      }

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
            link: `/app/team/my-tasks?projectId=${projectId}`,
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
          void this.analyticsCache.invalidate('team_workload');

          // When a Member pushes a WP into AwaitingReview, notify the project's PM
          // so they can validate (or reject) the work. The PM is the sole
          // approver of a completed task.
          if (dto.status === 'AwaitingReview') {
            void this.notifyPmOnAwaitingReview(projectId, id, wp.title, actorId).catch((e) =>
              this.logger.error('notifyPmOnAwaitingReview failed', e),
            );
          }
        }
      }

      return Result.ok(wp);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
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
      // H2: verify target column (if provided) belongs to a board in the same project as the WP.
      // Also C1/C2 guard on parent moves.
      const wpExisting = await this.prisma.workPackage.findUnique({
        where: { id },
        select: { id: true, projectId: true },
      });
      if (!wpExisting) throw new BadRequestException('Work package introuvable.');

      if (dto.boardColumnId) {
        const column = await this.prisma.boardColumn.findUnique({
          where: { id: dto.boardColumnId },
          select: { id: true, board: { select: { projectId: true } } },
        });
        if (!column || column.board.projectId !== wpExisting.projectId) {
          throw new BadRequestException('boardColumnId must belong to a board in the same project');
        }
      }
      if (dto.parentId !== undefined && dto.parentId !== null) {
        if (dto.parentId === id) {
          throw new BadRequestException('A work package cannot be its own parent');
        }
        const parent = await this.prisma.workPackage.findUnique({
          where: { id: dto.parentId },
          select: { id: true, projectId: true },
        });
        if (!parent || parent.projectId !== wpExisting.projectId) {
          throw new BadRequestException('parentId must belong to same project');
        }
      }

      const data: Record<string, unknown> = {};
      if (dto.boardColumnId !== undefined) data.boardColumnId = dto.boardColumnId;
      if (dto.sprintId !== undefined) data.sprintId = dto.sprintId;
      if (dto.parentId !== undefined) data.parentId = dto.parentId;
      if (dto.position !== undefined) data.position = dto.position;
      const wp = await this.prisma.workPackage.update({ where: { id }, data });
      return Result.ok(wp);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
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
      // M5: precheck existence so a 404 is surfaced instead of a silent no-op.
      const existing = await this.prisma.workPackageWatcher.findUnique({
        where: { workPackageId_userId: { workPackageId, userId } },
      });
      if (!existing) throw new NotFoundException('Watcher not found');
      await this.prisma.workPackageWatcher.delete({
        where: { workPackageId_userId: { workPackageId, userId } },
      });
      return Result.ok<void>();
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      this.logger.error('removeWatcher failed', e);
      return Result.fail<void>('Échec de la suppression de l\'observateur.');
    }
  }

  async addDependency(fromWpId: string, toWpId: string, type: string) {
    try {
      if (fromWpId === toWpId) return Result.fail('Impossible de créer une dépendance sur le même work package.');

      // C3: detect circular dependencies via DFS from `toWpId` following existing deps.
      // If we can reach `fromWpId`, adding fromWpId -> toWpId would close a cycle.
      const visited = new Set<string>();
      const stack: string[] = [toWpId];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        if (current === fromWpId) {
          throw new BadRequestException('Circular dependency detected');
        }
        if (visited.has(current)) continue;
        visited.add(current);
        const outgoing = await this.prisma.workPackageDependency.findMany({
          where: { fromWpId: current },
          select: { toWpId: true },
        });
        for (const dep of outgoing) {
          if (!visited.has(dep.toWpId)) stack.push(dep.toWpId);
        }
      }

      const d = await this.prisma.workPackageDependency.create({ data: { fromWpId, toWpId, type: type || 'relates' } });
      return Result.ok(d);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
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

  /** Bulk-assign multiple work packages to users in a single transaction.
   *  `assigneeId === null` un-assigns the work package.
   *  `sprintId` is optional context — when provided, the grouped
   *  notification carries the sprint name and a deep-link to the
   *  assignee's filtered "Mes tâches" view. */
  async bulkAssign(
    projectId: string,
    assignments: Array<{ wpId: string; assigneeId: string | null }>,
    actorId: string,
    sprintId?: string,
  ): Promise<Result<{ updated: number }>> {
    if (assignments.length === 0) return Result.ok({ updated: 0 });

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    if (!project) return Result.fail('Projet introuvable');

    // Resolve sprint name once for the notification message + scope check.
    let sprintName: string | null = null;
    if (sprintId) {
      const sprint = await this.prisma.sprint.findUnique({
        where: { id: sprintId },
        select: { name: true, board: { select: { projectId: true } } },
      });
      if (!sprint || sprint.board.projectId !== projectId) {
        return Result.fail('Sprint introuvable ou hors projet.');
      }
      sprintName = sprint.name;
    }

    // Validate all non-null assignees are real, active users.
    const uniqueAssignees = [
      ...new Set(assignments.map((a) => a.assigneeId).filter((x): x is string => !!x)),
    ];
    if (uniqueAssignees.length > 0) {
      const users = await this.prisma.appUser.findMany({
        where: { id: { in: uniqueAssignees }, isActive: true },
        select: { id: true },
      });
      if (users.length !== uniqueAssignees.length) {
        return Result.fail('Certains utilisateurs sont introuvables ou inactifs.');
      }
    }

    // Group by target assigneeId so we can issue ONE updateMany per target
    // instead of N individual round-trips inside the transaction.
    const buckets = new Map<string | null, string[]>();
    for (const a of assignments) {
      const key = a.assigneeId ?? null;
      const list = buckets.get(key) ?? [];
      list.push(a.wpId);
      buckets.set(key, list);
    }

    let updated = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const [assigneeId, wpIds] of buckets) {
          const res = await tx.workPackage.updateMany({
            where: { id: { in: wpIds }, projectId, isDeleted: false },
            data: { assigneeId, updatedAt: new Date() },
          });
          updated += res.count;
        }
      });
    } catch (e) {
      this.logger.error('bulkAssign transaction failed', e);
      return Result.fail<{ updated: number }>('Échec de la mise à jour groupée.');
    }

    // Group by assignee → one consolidated notification per user (skip un-assignments).
    const byAssignee = new Map<string, number>();
    for (const a of assignments) {
      if (!a.assigneeId) continue;
      byAssignee.set(a.assigneeId, (byAssignee.get(a.assigneeId) ?? 0) + 1);
    }

    const myTasksLink = sprintId
      ? `/app/team/my-tasks?projectId=${projectId}&sprintId=${sprintId}`
      : `/app/team/my-tasks?projectId=${projectId}`;

    for (const [assigneeId, count] of byAssignee) {
      try {
        await this.notifications.notifyEnhanced({
          userId: assigneeId,
          actorId,
          type: 'wp_bulk_assigned',
          reason: 'Assignee',
          title: 'Nouvelles tâches assignées',
          message: sprintName
            ? `${count} tâche(s) vous ont été assignées dans le sprint « ${sprintName} » sur « ${project.name} ».`
            : `${count} tâche(s) vous ont été assignées sur « ${project.name} ».`,
          projectId,
          entityType: 'project',
          entityId: projectId,
          link: myTasksLink,
        });
      } catch (e) {
        this.logger.warn(`bulkAssign notify ${assigneeId} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return Result.ok({ updated });
  }

  /**
   * Run the AI-assisted assignment agent for a list of candidate WPs.
   * The agent reads members + workload + history and emits per-WP
   * suggestions (advisory; PM still confirms via bulk-assign).
   */
  async suggestAssignments(
    projectId: string,
    wpIds: string[],
  ): Promise<Result<{ items: AssignmentSuggestionForWp[] }>> {
    if (!wpIds || wpIds.length === 0) {
      return Result.ok({ items: [] });
    }
    // Trim to 50 — controller DTO already enforces, but be safe.
    const candidate = wpIds.slice(0, 50);
    try {
      const items = await runAssignmentAgent(this.agentRunner, this.logger, projectId, candidate);
      return Result.ok({ items });
    } catch (e) {
      this.logger.warn(`suggestAssignments failed: ${e instanceof Error ? e.message : String(e)}`);
      return Result.fail<{ items: AssignmentSuggestionForWp[] }>('Suggestions IA indisponibles, réessayez.');
    }
  }
}
