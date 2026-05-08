import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { UsersService } from '../users/users.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';
import { SaveFieldValuesDto } from './dto/save-field-values.dto.js';
import { AddFieldDto } from './dto/add-field.dto.js';
import { SubmitValidationDto } from './dto/submit-validation.dto.js';

interface JwtUser {
  userId: string;
  role: string;
}

@Controller('pm')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
export class PmController {
  constructor(
    private readonly service: ProjectsService,
    private readonly usersService: UsersService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('projects')
  async getMyProjects(@CurrentUser() user: JwtUser) {
    const result = await this.service.getByManager(user.userId);
    return result.value;
  }

  @Get('projects/:id')
  @ProjectAccess('id')
  async getProject(@Param('id') id: string) {
    const result = await this.service.getById(id);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  @Patch('projects/:id/field-values')
  @ProjectAccess('id')
  async saveFieldValues(
    @Param('id') id: string,
    @Body() body: SaveFieldValuesDto,
    @CurrentUser() user: JwtUser,
  ) {
    const result = await this.service.saveFieldValues(id, user.userId, body.fieldValues);
    if (result.isFailure) throw new BadRequestException(result.error);
  }

  @Post('projects/:id/fields')
  @ProjectAccess('id')
  async addField(
    @Param('id') id: string,
    @Body() dto: AddFieldDto,
    @CurrentUser() user: JwtUser,
  ) {
    // Custom-field authoring is reserved for the project's PM (and Admin).
    // ProjectAccessGuard would otherwise also let any ProjectMember through —
    // closes the audit IDOR finding (docs/qa/backend/projects.md:47-63).
    const project = await this.prisma.project.findFirst({
      where: { id, isDeleted: false },
      select: { projectManagerId: true },
    });
    if (!project) throw new NotFoundException('Projet non trouvé.');
    const isOwner = project.projectManagerId === user.userId;
    const isAdmin = user.role === 'Admin';
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Seul le chef de projet peut ajouter des champs personnalisés.');
    }

    const result = await this.service.addField(id, dto);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Get('projects/:id/validations')
  @ProjectAccess('id')
  async getValidations(@Param('id') id: string) {
    const result = await this.service.getValidations(id);
    return result.value;
  }

  @Get('projects/:id/activity')
  @ProjectAccess('id')
  async getActivity(@Param('id') id: string) {
    const result = await this.service.getActivity(id);
    return result.value;
  }

  /**
   * Active users list — used by PM views like Members, assignee dropdowns, etc.
   *
   * `?forMembers=true` filters out inactive users + Admin / Viewer roles
   * (system roles that should never be added as project members) so the
   * Members page doesn't leak that list to the UI. Default behaviour
   * (no flag) stays unchanged for legacy callers.
   */
  @Get('users')
  async getUsers(@Query('forMembers') forMembers?: string) {
    const result = await this.usersService.getAll(0, 500);
    if (result.isFailure) return [];
    const items = (result.value as unknown as { items: any[] }).items;
    if (forMembers !== 'true') return items;
    return items.filter(
      (u) => u.isActive !== false && u.role !== 'Admin' && u.role !== 'Viewer',
    );
  }

  /** All active projects — used by team-member roles who are not project managers */
  @Get('team-projects')
  async getTeamProjects() {
    const result = await this.service.getProjectsPaged(0, 200);
    if (result.isFailure) return [];
    return (result.value as { items: unknown[] }).items;
  }

  /**
   * Strict ProjectMember-scoped project list for the Member dashboard.
   * Returns only projects where the caller has a `ProjectMember` row.
   * Each item carries the active sprint (if any) + the caller's
   * in-progress WP count for that project.
   */
  @Get('my-projects')
  async getMyMemberProjects(@CurrentUser() user: JwtUser) {
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId: user.userId },
      include: {
        project: {
          select: {
            id: true, name: true, clientName: true, status: true,
            startDate: true, endDate: true, isDeleted: true,
            boards: {
              select: {
                sprints: {
                  where: { status: 'Active' },
                  orderBy: { startDate: 'desc' },
                  take: 1,
                  select: { id: true, name: true, status: true, startDate: true, endDate: true, goal: true },
                },
              },
            },
          },
        },
      },
    });

    const projects = memberships
      .map((m) => m.project)
      .filter((p): p is NonNullable<typeof p> => !!p && !p.isDeleted);

    if (projects.length === 0) return { items: [] };

    const wpCounts = await this.prisma.workPackage.groupBy({
      by: ['projectId'],
      where: {
        assigneeId: user.userId,
        isDeleted: false,
        status: 'InProgress',
        projectId: { in: projects.map((p) => p.id) },
      },
      _count: { _all: true },
    });
    const inProgressByProject = new Map(wpCounts.map((c) => [c.projectId, c._count._all]));

    return {
      items: projects.map((p) => {
        const activeSprint = p.boards?.[0]?.sprints?.[0] ?? null;
        return {
          id: p.id,
          name: p.name,
          clientName: p.clientName,
          status: p.status,
          startDate: p.startDate,
          endDate: p.endDate,
          activeSprint,
          myInProgressCount: inProgressByProject.get(p.id) ?? 0,
        };
      }),
    };
  }

  /**
   * Cross-project active + planning sprints where the caller has at least
   * one assigned WP. Powers the Member dashboard's "Sprint en cours" widget.
   */
  @Get('my-sprints')
  async getMyAssignedSprints(@CurrentUser() user: JwtUser) {
    const wps = await this.prisma.workPackage.findMany({
      where: {
        assigneeId: user.userId,
        isDeleted: false,
        sprintId: { not: null },
      },
      select: { sprintId: true, projectId: true },
    });
    if (wps.length === 0) return { items: [] };

    const sprintIds = Array.from(new Set(wps.map((w) => w.sprintId).filter((x): x is string => !!x)));
    const sprints = await this.prisma.sprint.findMany({
      where: { id: { in: sprintIds }, status: { in: ['Active', 'Planning'] } },
      include: { board: { select: { project: { select: { id: true, name: true } } } } },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    });

    const myTasksBySprint = new Map<string, number>();
    for (const w of wps) {
      if (!w.sprintId) continue;
      myTasksBySprint.set(w.sprintId, (myTasksBySprint.get(w.sprintId) ?? 0) + 1);
    }

    return {
      items: sprints.map((s) => ({
        sprint: {
          id: s.id,
          name: s.name,
          goal: s.goal,
          status: s.status,
          startDate: s.startDate,
          endDate: s.endDate,
        },
        projectId: s.board.project.id,
        projectName: s.board.project.name,
        myTaskCount: myTasksBySprint.get(s.id) ?? 0,
      })),
    };
  }

  /** Users available to be assigned as team responsibles (SpecificationTeam + Member). */
  @Get('projects/:id/assignable-users')
  @ProjectAccess('id')
  async getAssignableUsers() {
    const users = await this.prisma.appUser.findMany({
      where: {
        isActive: true,
        role: { in: ['SpecificationTeam', 'Member', 'ProjectManager', 'Admin'] },
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
    });
    return users;
  }

  /** Current team responsibility assignments for a project. */
  @Get('projects/:id/responsibilities')
  @ProjectAccess('id')
  async getResponsibilities(@Param('id') projectId: string) {
    return this.loadResponsibilities(projectId);
  }

  /** Save team responsibility assignments (validationResponsibleId, deploymentResponsibleId). */
  @Patch('projects/:id/responsibilities')
  @ProjectAccess('id')
  async saveResponsibilities(
    @Param('id') projectId: string,
    @Body() body: { validationResponsibleId?: string | null; deploymentResponsibleId?: string | null },
  ) {
    await this.upsertResponsibility(projectId, 'Responsable validation',  body.validationResponsibleId ?? null);
    await this.upsertResponsibility(projectId, 'Responsable déploiement', body.deploymentResponsibleId ?? null);
    return this.loadResponsibilities(projectId);
  }

  private async upsertResponsibility(projectId: string, label: string, userId: string | null): Promise<void> {
    // Ensure the system ProjectField exists (identified by label + fieldCategory='System')
    let field = await this.prisma.projectField.findFirst({
      where: { projectId, label, fieldCategory: 'System' },
    });
    if (!field) {
      field = await this.prisma.projectField.create({
        data: {
          projectId,
          label,
          fieldType: 'Text',
          isRequired: false,
          orderIndex: 9999,
          fieldCategory: 'System',
        },
      });
    }
    // Upsert the value
    await this.prisma.projectFieldValue.upsert({
      where: { projectId_projectFieldId: { projectId, projectFieldId: field.id } },
      create: { projectId, projectFieldId: field.id, value: userId ?? '' },
      update: { value: userId ?? '', updatedAt: new Date() },
    });
  }

  private async loadResponsibilities(projectId: string): Promise<{
    validationResponsibleId: string | null;
    deploymentResponsibleId: string | null;
    validationResponsible: { id: string; firstName: string; lastName: string } | null;
    deploymentResponsible: { id: string; firstName: string; lastName: string } | null;
  }> {
    const LABEL_VAL = 'Responsable validation';
    const LABEL_DEP = 'Responsable déploiement';

    const fields = await this.prisma.projectField.findMany({
      where: { projectId, label: { in: [LABEL_VAL, LABEL_DEP] }, fieldCategory: 'System' },
      include: { values: { where: { projectId } } },
    });

    const getVal = (lbl: string): string | null => {
      const f = fields.find((x) => x.label === lbl);
      return f?.values[0]?.value || null;
    };

    const valId = getVal(LABEL_VAL);
    const depId = getVal(LABEL_DEP);

    const userIds = [valId, depId].filter(Boolean) as string[];
    const users = userIds.length
      ? await this.prisma.appUser.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];

    const find = (id: string | null) => users.find((u) => u.id === id) ?? null;

    return {
      validationResponsibleId: valId,
      deploymentResponsibleId: depId,
      validationResponsible: find(valId),
      deploymentResponsible: find(depId),
    };
  }

  @Post('projects/:id/validations')
  @ProjectAccess('id')
  async submitValidation(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: SubmitValidationDto,
  ) {
    const result = await this.service.submitValidation(id, user.userId, user.role, dto);
    if (result.isFailure) throw new BadRequestException(result.error);

    const validation = result.value as { phase: string };
    await this.sendValidationNotifications(id, user.userId, dto.isApproved, validation.phase);

    return result.value;
  }

  private async sendValidationNotifications(
    projectId: string,
    submitterId: string,
    isApproved: boolean,
    phase: string,
  ): Promise<void> {
    // Exclude soft-deleted projects from notification fan-out
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      select: { name: true, projectManagerId: true },
    });
    if (!project) return;

    const status = isApproved ? 'approuvée' : 'rejetée';
    const type = isApproved ? 'validation_approved' : 'validation_rejected';
    const title = isApproved ? 'Validation approuvée' : 'Validation rejetée';
    const message = `Validation ${status} pour le projet "${project.name}" — phase: ${phase}`;

    const notifyTargets: Promise<void>[] = [];

    // Notify PM if they are not the submitter
    if (project.projectManagerId && project.projectManagerId !== submitterId) {
      notifyTargets.push(
        this.notifications.notify(project.projectManagerId, type, title, message, projectId),
      );
    }

    // Notify all admins except the submitter — batch in parallel to avoid
    // O(admins) sequential round-trips blocking the HTTP response.
    const admins = await this.prisma.appUser.findMany({
      where: { role: 'Admin', isActive: true },
      select: { id: true },
    });

    for (const admin of admins) {
      if (admin.id !== submitterId) {
        notifyTargets.push(
          this.notifications.notify(admin.id, type, title, message, projectId),
        );
      }
    }

    await Promise.all(notifyTargets);
  }
}
