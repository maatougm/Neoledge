import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PhaseGateService } from './phase-gate.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly phaseGate: PhaseGateService,
    private readonly audit: AuditService,
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
        include: { projectManager: { select: { id: true, firstName: true, lastName: true, email: true } } },
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
        include: { projectManager: { select: { id: true, firstName: true, lastName: true, email: true } } },
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
        projectManager: { select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true, mustChangePassword: true, createdAt: true, lastLoginAt: true } },
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

  async getByStatus(status: string) {
    const projects = await this.prisma.project.findMany({
      where: { status, isDeleted: false },
      include: { projectManager: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    return Result.ok(projects.map((p) => this.toSummary(p)));
  }

  async create(adminId: string, dto: any) {
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      return Result.fail('La date de fin doit être postérieure à la date de début.');
    }

    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        clientName: dto.clientName,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        projectManagerId: dto.projectManagerId ?? null,
        createdByAdminId: adminId,
      },
    });

    // Seed static fields
    const staticFields = [
      { label: 'Description', fieldType: 'Text', fieldCategory: 'Static', isRequired: true, orderIndex: 0 },
      { label: 'Budget', fieldType: 'Number', fieldCategory: 'Static', isRequired: false, orderIndex: 1 },
      { label: 'Type de projet', fieldType: 'Select', fieldCategory: 'Static', isRequired: true, orderIndex: 2, options: '["NeoLeadge","Elise","Both"]' },
      { label: 'Environnement', fieldType: 'Text', fieldCategory: 'Static', isRequired: false, orderIndex: 3 },
      { label: 'Priorité', fieldType: 'Select', fieldCategory: 'Static', isRequired: false, orderIndex: 4, options: '["Low","Medium","High","Critical"]' },
      { label: 'Validation client requise', fieldType: 'Checkbox', fieldCategory: 'Static', isRequired: false, orderIndex: 5 },
    ];

    for (const sf of staticFields) {
      const field = await this.prisma.projectField.create({
        data: { projectId: project.id, ...sf },
      });
      await this.prisma.projectFieldValue.create({
        data: { projectId: project.id, projectFieldId: field.id, value: null },
      });
    }

    await this.logActivity(project.id, adminId, 'create', `Projet "${project.name}" créé`);
    void this.audit.log('Project', project.id, 'CREATE', adminId, undefined, { name: project.name });
    return this.getById(project.id);
  }

  async update(id: string, dto: any) {
    const existing = await this.prisma.project.findFirst({ where: { id, isDeleted: false } });
    if (!existing) return Result.fail('Projet non trouvé.');

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

  async deleteProject(id: string) {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) return Result.fail('Projet non trouvé.');
    await this.prisma.project.delete({ where: { id } });
    return Result.ok();
  }

  async softDelete(id: string, userId: string) {
    const existing = await this.prisma.project.findFirst({ where: { id, isDeleted: false } });
    if (!existing) return Result.fail('Projet non trouvé.');
    await this.prisma.project.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), deletedByUserId: userId },
    });
    return Result.ok();
  }

  async getDeletedProjectsAsync() {
    const deleted = await this.prisma.project.findMany({
      where: { isDeleted: true },
      include: {
        projectManager: { select: { id: true, firstName: true, lastName: true, email: true } },
        deletedByUser: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
    return Result.ok(
      deleted.map((p) => ({
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
    );
  }

  async restoreProjectAsync(id: string) {
    const existing = await this.prisma.project.findFirst({ where: { id, isDeleted: true } });
    if (!existing) return Result.fail('Projet supprimé non trouvé.');
    await this.prisma.project.update({
      where: { id },
      data: { isDeleted: false, deletedAt: null, deletedByUserId: null },
    });
    return Result.ok();
  }

  async hardDeleteProjectAsync(id: string) {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) return Result.fail('Projet non trouvé.');
    await this.prisma.project.delete({ where: { id } });
    return Result.ok();
  }

  async assignManager(projectId: string, managerId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    const manager = await this.prisma.appUser.findUnique({ where: { id: managerId } });
    if (!manager || manager.role !== 'ProjectManager') {
      return Result.fail('L\'utilisateur sélectionné n\'est pas un chef de projet.');
    }

    await this.prisma.project.update({ where: { id: projectId }, data: { projectManagerId: managerId } });
    await this.logActivity(projectId, null, 'assign_manager', `Chef de projet assigné: ${manager.firstName} ${manager.lastName}`);
    void this.audit.log('Project', projectId, 'ASSIGN', managerId, undefined, { manager: `${manager.firstName} ${manager.lastName}` });

    await this.notifications.notify(
      managerId,
      'project_assigned',
      'Nouveau projet assigné',
      `Vous avez été assigné au projet ${project.name}`,
      projectId,
    );

    return Result.ok();
  }

  async updateStatus(projectId: string, status: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    const gate = await this.phaseGate.canTransition(projectId, project.status, status);
    if (gate.isFailure) return Result.fail(gate.error ?? 'Transition refusée.');

    await this.prisma.project.update({ where: { id: projectId }, data: { status } });
    await this.logActivity(projectId, null, 'status_change', `Statut changé: ${project.status} → ${status}`);
    void this.audit.log('Project', projectId, 'STATUS_CHANGE', undefined, { status: { before: project.status, after: status } });
    return Result.ok();
  }

  async archive(projectId: string) {
    return this.updateStatus(projectId, 'Archived');
  }

  async addField(projectId: string, dto: any) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    const maxOrder = await this.prisma.projectField.aggregate({
      where: { projectId },
      _max: { orderIndex: true },
    });

    const field = await this.prisma.projectField.create({
      data: {
        projectId,
        label: dto.label,
        fieldType: dto.fieldType ?? 'Text',
        isRequired: dto.isRequired ?? false,
        options: dto.options ?? null,
        fieldCategory: 'Custom',
        orderIndex: (maxOrder._max.orderIndex ?? 0) + 1,
      },
    });

    await this.prisma.projectFieldValue.create({
      data: { projectId, projectFieldId: field.id, value: null },
    });

    return Result.ok(field);
  }

  async removeField(projectId: string, fieldId: string) {
    const field = await this.prisma.projectField.findFirst({ where: { id: fieldId, projectId } });
    if (!field) return Result.fail('Champ non trouvé.');
    if (field.fieldCategory === 'Static') return Result.fail('Les champs statiques ne peuvent pas être supprimés.');

    await this.prisma.projectFieldValue.deleteMany({ where: { projectFieldId: fieldId } });
    await this.prisma.projectField.delete({ where: { id: fieldId } });
    return Result.ok();
  }

  async toggleManagerFields(projectId: string, allow: boolean) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');
    await this.prisma.project.update({ where: { id: projectId }, data: { allowManagerCustomFields: allow } });
    return Result.ok();
  }

  async duplicate(projectId: string, newName: string) {
    const source = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      include: { fields: true, fieldValues: { include: { field: true } } },
    });
    if (!source) return Result.fail('Projet non trouvé.');

    const dup = await this.prisma.project.create({
      data: {
        name: newName,
        clientName: source.clientName,
        startDate: source.startDate,
        endDate: source.endDate,
        createdByAdminId: source.createdByAdminId,
        status: 'Draft',
      },
    });

    for (const f of source.fields) {
      const newField = await this.prisma.projectField.create({
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
      await this.prisma.projectFieldValue.create({
        data: {
          projectId: dup.id,
          projectFieldId: newField.id,
          value: f.fieldCategory === 'Static' ? existingValue?.value ?? null : null,
        },
      });
    }

    return this.getById(dup.id);
  }

  async bulkArchive(ids: string[]) {
    await this.prisma.project.updateMany({ where: { id: { in: ids } }, data: { status: 'Archived' } });
    return Result.ok();
  }

  async bulkUpdateStatus(ids: string[], status: string) {
    await this.prisma.project.updateMany({ where: { id: { in: ids } }, data: { status } });
    return Result.ok();
  }

  async bulkAssignManager(ids: string[], managerId: string) {
    await this.prisma.project.updateMany({ where: { id: { in: ids } }, data: { projectManagerId: managerId } });
    return Result.ok();
  }

  async getActivity(projectId: string) {
    const activities = await this.prisma.projectActivity.findMany({
      where: { projectId },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return Result.ok(
      activities.map((a) => ({
        id: a.id,
        userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : null,
        action: a.action,
        detail: a.detail,
        createdAt: a.createdAt,
      })),
    );
  }

  async saveFieldValues(projectId: string, fieldValues: { projectFieldId: string; value: string | null }[]) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    for (const fv of fieldValues) {
      await this.prisma.projectFieldValue.upsert({
        where: { projectId_projectFieldId: { projectId, projectFieldId: fv.projectFieldId } },
        update: { value: fv.value },
        create: { projectId, projectFieldId: fv.projectFieldId, value: fv.value },
      });
    }
    return Result.ok();
  }

  async submitValidation(projectId: string, userId: string, userRole: string, dto: any) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    const validation = await this.prisma.projectValidation.create({
      data: {
        projectId,
        validatedByUserId: userId,
        validatedByRole: userRole,
        phase: project.status,
        isApproved: dto.isApproved,
        comment: dto.comment ?? null,
        validatedAt: new Date(),
      },
      include: { validatedBy: { select: { firstName: true, lastName: true } } },
    });

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
    };
  }

  private toDetail(p: any) {
    return {
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      status: p.status,
      allowManagerCustomFields: p.allowManagerCustomFields,
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
      })) ?? [],
    };
  }
}
