import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PhaseGateService } from './phase-gate.service.js';
import { AuditService } from '../audit/audit.service.js';
import { BULK_MAX } from './dto/bulk.dto.js';
import { AnalyticsCacheService } from '../analytics/analytics-cache.service.js';
import { TERMINAL_WP_STATUSES } from '../work-packages/wp-status.constants.js';

/** Per-field optimistic lock token coming from the client. */
export interface FieldValueWrite {
  projectFieldId: string;
  value: string | null;
  /** ISO-8601 string the client last observed for this field's `updatedAt`. */
  expectedUpdatedAt?: string;
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly phaseGate: PhaseGateService,
    private readonly audit: AuditService,
    private readonly analyticsCache: AnalyticsCacheService,
  ) {}

  async findWithFilters(
    userId: string,
    criteria: {
      status?: string[];
      priority?: string[];
      assignedToMe?: boolean;
      tags?: string[];
      search?: string;
      dateRange?: { from?: string; to?: string };
      skip?: number;
      take?: number;
    },
  ) {
    const skip = criteria.skip ?? 0;
    const take = Math.min(Math.max(criteria.take ?? 20, 1), 100);
    const where: any = { isDeleted: false };

    if (criteria.status && criteria.status.length > 0) {
      where.status = { in: criteria.status };
    }

    if (criteria.assignedToMe === true) {
      where.projectManagerId = userId;
    }

    if (criteria.search) {
      where.OR = [
        { name: { contains: criteria.search } },
        { clientName: { contains: criteria.search } },
      ];
    }

    if (criteria.dateRange?.from || criteria.dateRange?.to) {
      where.startDate = {};
      if (criteria.dateRange.from) {
        where.startDate.gte = new Date(criteria.dateRange.from);
      }
      if (criteria.dateRange.to) {
        where.startDate.lte = new Date(criteria.dateRange.to);
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip,
        take,
        include: {
          projectManager: { select: { id: true, firstName: true, lastName: true, email: true } },
          workPackages: { where: { isDeleted: false }, select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.project.count({ where }),
    ]);

    return Result.ok({ items: items.map((p) => this.toSummary(p)), total, skip, take });
  }

  async getProjectsPaged(skip: number, take: number, search?: string, status?: string) {
    const clampedTake = Math.min(Math.max(take, 1), 100);
    const where: any = { isDeleted: false };
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { clientName: { contains: search } },
      ];
    }
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip,
        take: clampedTake,
        include: {
          projectManager: { select: { id: true, firstName: true, lastName: true, email: true } },
          workPackages: { where: { isDeleted: false }, select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.project.count({ where }),
    ]);

    return Result.ok({
      items: items.map((p) => this.toSummary(p)),
      total,
      skip,
      take: clampedTake,
    });
  }

  async getById(id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, isDeleted: false },
      include: {
        projectManager: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        fields: { orderBy: { orderIndex: 'asc' } },
        fieldValues: { include: { field: true } },
      },
    });
    if (!project) return Result.fail('Projet non trouvé.');
    return Result.ok(this.toDetail(project));
  }

  async getByManager(managerId: string) {
    const projects = await this.prisma.project.findMany({
      where: { projectManagerId: managerId, isDeleted: false },
      include: { projectManager: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return Result.ok(projects.map((p) => this.toSummary(p)));
  }

  async getByStatus(status: string, skip = 0, take = 100) {
    const clampedTake = Math.min(Math.max(take, 1), 200);
    const clampedSkip = Math.max(skip, 0);
    const where = { status, isDeleted: false };

    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip: clampedSkip,
        take: clampedTake,
        include: {
          projectManager: { select: { id: true, firstName: true, lastName: true, email: true } },
          workPackages: { where: { isDeleted: false }, select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.project.count({ where }),
    ]);

    return Result.ok({
      items: items.map((p) => this.toSummary(p)),
      total,
      skip: clampedSkip,
      take: clampedTake,
    });
  }

  async create(adminId: string, dto: any) {
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      return Result.fail('La date de fin doit être postérieure à la date de début.');
    }

    // Seed static fields — minimum viable set to produce a coherent cahier des charges.
    // Each field maps 1:1 to a section of the generated document so the AI has exactly
    // what it needs without redundancy.
    const staticFields = [
      { label: 'Contexte et problématique', fieldType: 'Text', fieldCategory: 'Static', isRequired: true, orderIndex: 0 },
      { label: 'Objectif du projet et résultats attendus', fieldType: 'Text', fieldCategory: 'Static', isRequired: true, orderIndex: 1 },
      { label: 'Périmètre fonctionnel (modules à développer)', fieldType: 'Text', fieldCategory: 'Static', isRequired: true, orderIndex: 2 },
      { label: 'Stack technique proposée', fieldType: 'Text', fieldCategory: 'Static', isRequired: true, orderIndex: 3 },
      { label: 'Livrables attendus', fieldType: 'Text', fieldCategory: 'Static', isRequired: true, orderIndex: 4 },
      { label: 'Périmètre exclus', fieldType: 'Text', fieldCategory: 'Static', isRequired: false, orderIndex: 5 },
      { label: 'Priorité', fieldType: 'Select', fieldCategory: 'Static', isRequired: false, orderIndex: 6, options: '["Low","Medium","High","Critical"]' },
    ];

    // Atomic multi-step create: project + fields + field-values all succeed or
    // all roll back. Without this a crash between the calls would leave the
    // questionnaire blank and the PM unable to fill it in.
    const createdId = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: dto.name,
          clientName: dto.clientName,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          projectManagerId: dto.projectManagerId,
          createdByAdminId: adminId,
          currentPhaseEnteredAt: new Date(),
        },
      });

      // Create fields sequentially to capture each generated id, but inside a
      // single transaction so the round-trips are still ACID-atomic.
      for (const sf of staticFields) {
        const field = await tx.projectField.create({
          data: { projectId: project.id, ...sf },
        });
        await tx.projectFieldValue.create({
          data: { projectId: project.id, projectFieldId: field.id, value: null },
        });
      }

      await tx.projectActivity.create({
        data: { projectId: project.id, userId: adminId, action: 'create', detail: `Projet "${project.name}" créé` },
      });

      return project.id;
    });

    void this.audit.log('Project', createdId, 'CREATE', adminId, undefined, { name: dto.name }).catch((e) => this.logger.error('audit create failed', e));

    // Notify the assigned PM about their new project. The dedicated
    // assignManager() path handles re-assignment; create() was missing the
    // equivalent notification, so PMs assigned at creation time saw the
    // project appear in their list without any signal.
    if (dto.projectManagerId && dto.projectManagerId !== adminId) {
      void this.notifications
        .notifyEnhanced({
          userId: dto.projectManagerId,
          type: 'project_assigned',
          reason: 'System',
          title: 'Nouveau projet assigné',
          message: `Vous avez été assigné au projet « ${dto.name} ».`,
          projectId: createdId,
          entityType: 'project',
          entityId: createdId,
          actorId: adminId,
          link: `/app/pm/projects/${createdId}`,
        })
        .catch((e) => this.logger.warn(`notify on project create failed: ${e instanceof Error ? e.message : String(e)}`));
    }

    return this.getById(createdId);
  }

  async update(id: string, dto: any) {
    const existing = await this.prisma.project.findFirst({ where: { id, isDeleted: false } });
    if (!existing) return Result.fail('Projet non trouvé.');

    // Re-validate the date invariant after applying the patch so admins cannot
    // PATCH a `startDate` past the existing `endDate` (and vice-versa).
    const nextStart = dto.startDate !== undefined ? new Date(dto.startDate) : existing.startDate;
    const nextEnd = dto.endDate !== undefined ? new Date(dto.endDate) : existing.endDate;
    if (nextEnd <= nextStart) {
      return Result.fail('La date de fin doit être postérieure à la date de début.');
    }

    await this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.clientName !== undefined && { clientName: dto.clientName }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
      },
    });

    return this.getById(id);
  }

  async softDelete(id: string, userId: string) {
    const existing = await this.prisma.project.findFirst({ where: { id, isDeleted: false } });
    if (!existing) return Result.fail('Projet non trouvé.');
    await this.prisma.project.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), deletedByUserId: userId },
    });
    void this.audit.log('Project', id, 'DELETE', userId, undefined, { soft: true })
      .catch((e) => this.logger.error('audit softDelete failed', e));

    // Clear deep-links on unread notifications for this project — without
    // this, clicking a stale notification routes through ProjectAccessGuard
    // → 404 (the guard filters `isDeleted: false`). Wiping `link` lets the
    // panel still render the title/message but disables the click-through.
    void this.prisma.notification
      .updateMany({
        where: { projectId: id, isRead: false },
        data: { link: null },
      })
      .catch((e) => this.logger.warn(`clear notification links on softDelete failed: ${e instanceof Error ? e.message : String(e)}`));

    return Result.ok();
  }

  async getDeletedProjectsAsync(skip = 0, take = 100, search?: string) {
    const clampedTake = Math.min(Math.max(take, 1), 200);
    const clampedSkip = Math.max(skip, 0);
    const where: any = { isDeleted: true };
    if (search && search.trim()) {
      where.OR = [
        { name: { contains: search } },
        { clientName: { contains: search } },
      ];
    }

    const [deleted, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: {
          projectManager: { select: { id: true, firstName: true, lastName: true, email: true } },
          deletedByUser: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { deletedAt: 'desc' },
        skip: clampedSkip,
        take: clampedTake,
      }),
      this.prisma.project.count({ where }),
    ]);

    return Result.ok({
      items: deleted.map((p) => ({
        id: p.id,
        name: p.name,
        clientName: p.clientName,
        projectManagerName: p.projectManager
          ? `${p.projectManager.firstName} ${p.projectManager.lastName}`
          : null,
        status: p.status,
        deletedAt: p.deletedAt,
        deletedByName: p.deletedByUser
          ? `${p.deletedByUser.firstName} ${p.deletedByUser.lastName}`
          : null,
      })),
      total,
      skip: clampedSkip,
      take: clampedTake,
    });
  }

  async restoreProjectAsync(id: string) {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    // Distinguish "does not exist" (404) from "exists but not deleted" (400)
    // so the caller gets an actionable error instead of a confusing 404.
    if (!existing) return Result.fail('Projet non trouvé.');
    if (!existing.isDeleted) {
      throw new BadRequestException("Le projet n'est pas supprimé, impossible de le restaurer.");
    }
    await this.prisma.project.update({
      where: { id },
      data: { isDeleted: false, deletedAt: null, deletedByUserId: null },
    });
    return Result.ok();
  }

  /**
   * Hard delete — permanently removes the project row AND a best-effort cascade
   * of rows whose FK constraints would otherwise block the delete. Only allowed
   * on rows that are already soft-deleted, must go through the
   * `project.delete_permanent` permission at the controller level, and emits
   * an audit entry.
   */
  async hardDeleteProjectAsync(id: string, actorId?: string) {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) return Result.fail('Projet non trouvé.');
    if (!existing.isDeleted) {
      return Result.fail('Le projet doit d\'abord être supprimé (soft delete) avant une suppression permanente.');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Clean up children that do not already CASCADE at the DB level or
        // whose existence would confuse downstream modules after deletion.
        await tx.projectFieldValue.deleteMany({ where: { projectId: id } });
        await tx.projectField.deleteMany({ where: { projectId: id } });
        await tx.projectValidation.deleteMany({ where: { projectId: id } });
        await tx.projectActivity.deleteMany({ where: { projectId: id } });
        await tx.project.delete({ where: { id } });
      });
    } catch (e) {
      this.logger.error(`hardDelete failed for project ${id}`, e as Error);
      return Result.fail('Impossible de supprimer définitivement le projet (dépendances).');
    }

    void this.audit.log('Project', id, 'DELETE', actorId, undefined, { hard: true, name: existing.name })
      .catch((e) => this.logger.error('audit hardDelete failed', e));
    return Result.ok();
  }

  async assignManager(projectId: string, managerId: string, actorId?: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    const manager = await this.prisma.appUser.findUnique({ where: { id: managerId } });
    if (!manager || manager.role !== 'ProjectManager') {
      return Result.fail('L\'utilisateur sélectionné n\'est pas un chef de projet.');
    }
    if (!manager.isActive) {
      return Result.fail('Le chef de projet sélectionné est désactivé.');
    }

    await this.prisma.project.update({ where: { id: projectId }, data: { projectManagerId: managerId } });
    await this.logActivity(projectId, actorId ?? null, 'assign_manager', `Chef de projet assigné: ${manager.firstName} ${manager.lastName}`);
    void this.audit.log('Project', projectId, 'ASSIGN', actorId ?? managerId, undefined, { manager: `${manager.firstName} ${manager.lastName}` })
      .catch((e) => this.logger.error('audit assignManager failed', e));

    await this.notifications.notify(
      managerId,
      'project_assigned',
      'Nouveau projet assigné',
      `Vous avez été assigné au projet ${project.name}`,
      projectId,
    );

    return Result.ok();
  }

  async updateStatus(projectId: string, status: string, actorId?: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    // Idempotency: a no-op status change (e.g. repeated /archive on an
    // already-archived project) must not re-stamp `currentPhaseEnteredAt`,
    // write a duplicate audit row, or emit another activity entry.
    if (project.status === status) {
      return Result.ok();
    }

    const gate = await this.phaseGate.canTransition(projectId, project.status, status);
    if (gate.isFailure) return Result.fail(gate.error ?? 'Transition refusée.');

    // Stamp `currentPhaseEnteredAt` on every status change so the replay guard
    // in `PhaseGateService.hasRequiredApprovals` can ignore approvals captured
    // during earlier traversals of the same phase.
    await this.prisma.project.update({
      where: { id: projectId },
      data: { status, currentPhaseEnteredAt: new Date() },
    });
    await this.logActivity(projectId, actorId ?? null, 'status_change', `Statut changé: ${project.status} → ${status}`);
    void this.audit.log('Project', projectId, 'STATUS_CHANGE', actorId, { status: { before: project.status, after: status } })
      .catch((e) => this.logger.error('audit updateStatus failed', e));
    // Bust analytics cache — phase velocity, deadline risk, team workload all depend on project status.
    void this.analyticsCache.invalidate();
    return Result.ok();
  }

  async archive(projectId: string, actorId?: string) {
    return this.updateStatus(projectId, 'Archived', actorId);
  }

  async addField(projectId: string, dto: any) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    // Compute the next orderIndex INSIDE the transaction so two concurrent
    // callers cannot both read the same max and emit duplicate positions.
    const field = await this.prisma.$transaction(async (tx) => {
      const maxOrder = await tx.projectField.aggregate({
        where: { projectId },
        _max: { orderIndex: true },
      });

      const created = await tx.projectField.create({
        data: {
          projectId,
          label: dto.label,
          fieldType: dto.fieldType ?? 'Text',
          isRequired: dto.isRequired ?? false,
          options: dto.options ?? null,
          fieldCategory: 'Custom',
          orderIndex: (maxOrder._max.orderIndex ?? 0) + 1,
          isBacklogDriver: dto.isBacklogDriver ?? false,
          backlogHint: dto.backlogHint ?? null,
        },
      });

      await tx.projectFieldValue.create({
        data: { projectId, projectFieldId: created.id, value: null },
      });

      return created;
    });

    return Result.ok(field);
  }

  async removeField(projectId: string, fieldId: string) {
    const field = await this.prisma.projectField.findFirst({ where: { id: fieldId, projectId } });
    if (!field) return Result.fail('Champ non trouvé.');
    if (field.fieldCategory === 'Static') return Result.fail('Les champs statiques ne peuvent pas être supprimés.');

    await this.prisma.$transaction(async (tx) => {
      // Values must go before the field (FK to ProjectField is NoAction).
      await tx.projectFieldValue.deleteMany({ where: { projectFieldId: fieldId } });
      // Best-effort cascade of any WorkPackageCustomValue rows that reference
      // this field id. In practice `WorkPackageCustomValue.customFieldId`
      // points at `WorkPackageCustomField`, not `ProjectField`; the
      // deleteMany is a safety net and a no-op when ids do not collide.
      await tx.workPackageCustomValue.deleteMany({ where: { customFieldId: fieldId } });
      await tx.projectField.delete({ where: { id: fieldId } });
    });
    return Result.ok();
  }

  async duplicate(projectId: string, newName: string, adminId?: string) {
    const source = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      include: { fields: true, fieldValues: { include: { field: true } } },
    });
    if (!source) return Result.fail('Projet non trouvé.');

    const dupId = await this.prisma.$transaction(async (tx) => {
      const dup = await tx.project.create({
        data: {
          name: newName,
          clientName: source.clientName,
          startDate: source.startDate,
          endDate: source.endDate,
          projectManagerId: source.projectManagerId,
          createdByAdminId: adminId ?? source.createdByAdminId,
          status: 'Draft',
          currentPhaseEnteredAt: new Date(),
        },
      });

      for (const f of source.fields) {
        const newField = await tx.projectField.create({
          data: {
            projectId: dup.id,
            label: f.label,
            fieldType: f.fieldType,
            isRequired: f.isRequired,
            defaultValue: f.defaultValue,
            orderIndex: f.orderIndex,
            fieldCategory: f.fieldCategory,
            options: f.options,
          },
        });
        const existingValue = source.fieldValues.find((v) => v.projectFieldId === f.id);
        await tx.projectFieldValue.create({
          data: {
            projectId: dup.id,
            projectFieldId: newField.id,
            value: f.fieldCategory === 'Static' ? existingValue?.value ?? null : null,
          },
        });
      }

      return dup.id;
    });

    return this.getById(dupId);
  }

  // ── Bulk operations ───────────────────────────────────────────────────────
  //
  // All three bulk endpoints:
  //   • hard-cap the batch at BULK_MAX (500) items;
  //   • filter out already soft-deleted projects;
  //   • route through the per-row method that enforces the phase gate /
  //     manager-role check and writes audit + activity entries per project.
  //
  // Returns per-row outcomes so the caller can surface partial failures.

  private assertWithinBulkCap(ids: string[]): Result<void> {
    if (!ids || ids.length === 0) return Result.fail('Aucun projet sélectionné.');
    if (ids.length > BULK_MAX) {
      return Result.fail(`Trop de projets (max ${BULK_MAX}).`);
    }
    return Result.ok();
  }

  private async filterBulkCandidates(ids: string[]): Promise<string[]> {
    const alive = await this.prisma.project.findMany({
      where: { id: { in: ids }, isDeleted: false },
      select: { id: true },
    });
    return alive.map((p) => p.id);
  }

  async bulkArchive(ids: string[], actorId?: string) {
    const guard = this.assertWithinBulkCap(ids);
    if (guard.isFailure) return guard;

    const candidates = await this.filterBulkCandidates(ids);
    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const id of candidates) {
      const r = await this.archive(id, actorId);
      results.push({ id, ok: r.isSuccess, error: r.error });
    }

    return Result.ok({ attempted: candidates.length, results });
  }

  async bulkUpdateStatus(ids: string[], status: string, actorId?: string) {
    const guard = this.assertWithinBulkCap(ids);
    if (guard.isFailure) return guard;

    const candidates = await this.filterBulkCandidates(ids);
    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const id of candidates) {
      const r = await this.updateStatus(id, status, actorId);
      results.push({ id, ok: r.isSuccess, error: r.error });
    }

    return Result.ok({ attempted: candidates.length, results });
  }

  async bulkAssignManager(ids: string[], managerId: string, actorId?: string) {
    const guard = this.assertWithinBulkCap(ids);
    if (guard.isFailure) return guard;

    // Validate manager once for the whole batch to avoid N redundant lookups.
    const manager = await this.prisma.appUser.findUnique({ where: { id: managerId } });
    if (!manager || manager.role !== 'ProjectManager' || !manager.isActive) {
      return Result.fail('Le chef de projet sélectionné est invalide ou désactivé.');
    }

    const candidates = await this.filterBulkCandidates(ids);
    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const id of candidates) {
      const r = await this.assignManager(id, managerId, actorId);
      results.push({ id, ok: r.isSuccess, error: r.error });
    }

    return Result.ok({ attempted: candidates.length, results });
  }

  async getActivity(projectId: string, skip = 0, take = 50) {
    const clampedTake = Math.min(Math.max(take, 1), 200);
    const clampedSkip = Math.max(skip, 0);

    const [activities, total] = await Promise.all([
      this.prisma.projectActivity.findMany({
        where: { projectId },
        include: { user: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: clampedSkip,
        take: clampedTake,
      }),
      this.prisma.projectActivity.count({ where: { projectId } }),
    ]);

    return Result.ok({
      items: activities.map((a) => ({
        id: a.id,
        userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : null,
        action: a.action,
        detail: a.detail,
        createdAt: a.createdAt,
      })),
      total,
      skip: clampedSkip,
      take: clampedTake,
    });
  }

  /**
   * Save multiple field values atomically with per-field optimistic locking.
   *
   * Contract:
   *   • Every row is written inside one `$transaction` — all writes land or
   *     none do.
   *   • If the caller passes `expectedUpdatedAt` for a field and the stored
   *     row's `updatedAt` is strictly greater, the whole transaction is
   *     aborted with a 409 conflict (`ConflictException` thrown from the
   *     controller) so the client can refetch and merge.
   *   • Every write sets `updatedBy = userId` and the DB auto-stamps
   *     `updatedAt`, giving the collaboration module a real audit trail.
   */
  async saveFieldValues(
    projectId: string,
    userId: string,
    fieldValues: FieldValueWrite[],
  ) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    // Required-field enforcement — only for the fields the caller is
    // actually saving in this request. If a field is flagged `isRequired`
    // and the incoming value is null OR an empty/whitespace-only string,
    // reject before opening the write transaction. Fields NOT present in
    // the payload are untouched (partial save is allowed).
    const touchedIds = fieldValues.map((fv) => fv.projectFieldId);
    if (touchedIds.length > 0) {
      const definitions = await this.prisma.projectField.findMany({
        where: { projectId, id: { in: touchedIds } },
        select: { id: true, label: true, isRequired: true },
      });
      const defsById = new Map(definitions.map((d) => [d.id, d]));
      for (const fv of fieldValues) {
        const def = defsById.get(fv.projectFieldId);
        if (!def?.isRequired) continue;
        const isEmpty = fv.value === null || (typeof fv.value === 'string' && fv.value.trim() === '');
        if (isEmpty) {
          return Result.fail(`Le champ "${def.label}" est requis.`);
        }
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const fv of fieldValues) {
          if (fv.expectedUpdatedAt) {
            const existing = await tx.projectFieldValue.findUnique({
              where: { projectId_projectFieldId: { projectId, projectFieldId: fv.projectFieldId } },
              select: { updatedAt: true },
            });
            if (existing?.updatedAt && new Date(fv.expectedUpdatedAt).getTime() < existing.updatedAt.getTime()) {
              throw new ConflictException(
                `Le champ ${fv.projectFieldId} a été modifié par un autre utilisateur. Veuillez rafraîchir.`,
              );
            }
          }

          await tx.projectFieldValue.upsert({
            where: { projectId_projectFieldId: { projectId, projectFieldId: fv.projectFieldId } },
            update: { value: fv.value, updatedBy: userId },
            create: { projectId, projectFieldId: fv.projectFieldId, value: fv.value, updatedBy: userId },
          });
        }
      });
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      this.logger.error('saveFieldValues transaction failed', e as Error);
      return Result.fail('Erreur lors de la sauvegarde des champs.');
    }

    return Result.ok();
  }

  /**
   * Resolve the validating user's effective role for a given project.
   * Reads `AppUser.role` from the DB — NEVER trusts the JWT claim, since a
   * compromised / stale token must not let the caller pick their own
   * `validatedByRole`.
   */
  private async resolveValidatorRole(userId: string): Promise<string | null> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role ?? null;
  }

  async submitValidation(projectId: string, userId: string, _ignoredJwtRole: string, dto: any) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    // Authorisation: caller must be the project's PM, an Admin, or in
    // ProjectMember. (The custom-role-with-permission path was retired
    // along with the dynamic RBAC stack.)
    const [isMember, dbUser] = await Promise.all([
      this.prisma.projectMember.findFirst({
        where: { userId, projectId },
        select: { id: true },
      }),
      this.prisma.appUser.findUnique({
        where: { id: userId },
        select: { role: true },
      }),
    ]);
    const isPm = project.projectManagerId === userId;
    const isAdmin = dbUser?.role === 'Admin';
    if (!isMember && !isPm && !isAdmin) {
      throw new ForbiddenException('Access denied');
    }

    // Derive the validating role from AppUser.role — never from the JWT
    // (which the client controls).
    const resolvedRole = await this.resolveValidatorRole(userId);
    if (!resolvedRole) return Result.fail('Impossible de déterminer votre rôle pour ce projet.');

    const duplicate = await this.prisma.projectValidation.findFirst({
      where: { projectId, validatedByUserId: userId, phase: project.status },
    });
    if (duplicate) return Result.fail('Vous avez déjà soumis une validation pour cette phase.');

    const validation = await this.prisma.projectValidation.create({
      data: {
        projectId,
        validatedByUserId: userId,
        validatedByRole: resolvedRole,
        phase: project.status,
        isApproved: dto.isApproved,
        comment: dto.comment ?? null,
        validatedAt: new Date(),
      },
      include: { validatedBy: { select: { firstName: true, lastName: true } } },
    });

    void this.logActivity(
      projectId,
      userId,
      validation.isApproved ? 'validation_approved' : 'validation_rejected',
      `${resolvedRole} — phase ${validation.phase}${validation.comment ? ` : ${validation.comment.slice(0, 120)}` : ''}`,
    ).catch((e) => this.logger.warn(`activity log failed: ${e instanceof Error ? e.message : e}`));

    // Notify the PM whenever the SpecificationTeam submits a review (approve OR reject),
    // so the PM can either kick off the backlog (approved) or correct the cahier (rejected).
    if (resolvedRole === 'SpecificationTeam' && project.projectManagerId) {
      void this.notifyPmOnSpecReview(
        project.projectManagerId,
        projectId,
        project.name,
        dto.isApproved === true,
        validation.comment,
      ).catch((e) =>
        this.logger.warn(`PM notification failed: ${e instanceof Error ? e.message : String(e)}`),
      );
    }

    return Result.ok({
      id: validation.id,
      projectId: validation.projectId,
      validatedByRole: validation.validatedByRole,
      validatedByName: `${validation.validatedBy.firstName} ${validation.validatedBy.lastName}`,
      phase: validation.phase,
      isApproved: validation.isApproved,
      comment: validation.comment,
      validatedAt: validation.validatedAt,
    });
  }

  /**
   * Notify the PM that the SpecificationTeam has reviewed the cahier des charges.
   * Fires on both approval and rejection so the PM can take the next step.
   */
  private async notifyPmOnSpecReview(
    pmUserId: string,
    projectId: string,
    projectName: string,
    isApproved: boolean,
    comment: string | null,
  ): Promise<void> {
    const title = isApproved
      ? 'Cahier validé par la spécification'
      : 'Cahier rejeté par la spécification';
    const commentTail = comment ? ` — « ${comment.slice(0, 140)} »` : '';
    const message = isApproved
      ? `Le cahier de « ${projectName} » a été validé. Vous pouvez démarrer le backlog.${commentTail}`
      : `Le cahier de « ${projectName} » a été rejeté et doit être corrigé.${commentTail}`;
    await this.notifications.notifyEnhanced({
      userId: pmUserId,
      type: isApproved ? 'cahier_validated' : 'cahier_rejected',
      reason: isApproved ? 'cahier_validated' : 'cahier_rejected',
      title,
      message,
      projectId,
      entityType: 'Project',
      entityId: projectId,
      link: `/app/pm/projects/${projectId}`,
    });
    this.logger.log(`Notified PM ${pmUserId} about ${isApproved ? 'approval' : 'rejection'} for project ${projectId}`);
  }

  async getValidations(projectId: string) {
    const validations = await this.prisma.projectValidation.findMany({
      where: { projectId },
      include: { validatedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { validatedAt: 'desc' },
    });
    return Result.ok(
      validations.map((v) => ({
        id: v.id,
        projectId: v.projectId,
        validatedByRole: v.validatedByRole,
        validatedByName: `${v.validatedBy.firstName} ${v.validatedBy.lastName}`,
        phase: v.phase,
        isApproved: v.isApproved,
        comment: v.comment,
        validatedAt: v.validatedAt,
      })),
    );
  }

  private async logActivity(projectId: string, userId: string | null, action: string, detail: string) {
    await this.prisma.projectActivity.create({
      data: { projectId, userId, action, detail },
    });
  }

  private toSummary(p: any) {
    // Aggregate WP counts (Prisma `_count` with where filter — single query
    // per project loaded with the right include). Computed once here so all
    // list endpoints expose the same `progressPct`.
    const allWps = Array.isArray(p.workPackages) ? p.workPackages : [];
    const wpTotal = allWps.length;
    const wpClosed = allWps.filter((w: any) => (TERMINAL_WP_STATUSES as readonly string[]).includes(w.status)).length;
    const progressPct = wpTotal === 0 ? 0 : Math.round((wpClosed / wpTotal) * 100);
    return {
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      projectManagerName: p.projectManager ? `${p.projectManager.firstName} ${p.projectManager.lastName}` : null,
      projectManagerEmail: p.projectManager?.email ?? null,
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
      createdAt: p.createdAt,
      progressPct,
      wpClosed,
      wpTotal,
    };
  }

  async exportToCsv(): Promise<string> {
    const projects = await this.prisma.project.findMany({
      where: { isDeleted: false },
      include: { projectManager: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const escape = (v: string | null | undefined) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };

    const header = ['ID', 'Nom', 'Client', 'Statut', 'Priorité', 'Chef de projet', 'Date début', 'Date fin', 'Créé le'];
    const rows = projects.map((p) => [
      escape(p.id),
      escape(p.name),
      escape(p.clientName),
      escape(p.status),
      escape(p.priority),
      p.projectManager
        ? escape(`${p.projectManager.firstName} ${p.projectManager.lastName}`)
        : '',
      escape(p.startDate.toISOString().slice(0, 10)),
      escape(p.endDate.toISOString().slice(0, 10)),
      escape(p.createdAt.toISOString().slice(0, 10)),
    ]);

    return [header.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  }

  private toDetail(p: any) {
    return {
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      status: p.status,
      aiOutput: p.aiOutput,
      startDate: p.startDate,
      endDate: p.endDate,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      projectManager: p.projectManager,
      fields: p.fields?.map((f: any) => ({
        id: f.id, label: f.label, fieldType: f.fieldType, isRequired: f.isRequired,
        defaultValue: f.defaultValue, orderIndex: f.orderIndex, fieldCategory: f.fieldCategory, options: f.options,
      })) ?? [],
      fieldValues: p.fieldValues?.map((v: any) => ({
        projectFieldId: v.projectFieldId, label: v.field?.label ?? '', value: v.value,
        updatedAt: v.updatedAt, updatedBy: v.updatedBy,
      })) ?? [],
    };
  }
}
