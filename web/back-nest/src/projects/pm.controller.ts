import { Controller, Get, Post, Patch, Param, Body, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
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
  async addField(@Param('id') id: string, @Body() dto: AddFieldDto) {
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

  /** Active users list — used by PM views like Members, assignee dropdowns, etc. */
  @Get('users')
  async getUsers() {
    const result = await this.usersService.getAll(0, 500);
    if (result.isFailure) return [];
    return (result.value as unknown as { items: unknown[] }).items;
  }

  /** All active projects — used by team-member roles who are not project managers */
  @Get('team-projects')
  async getTeamProjects() {
    const result = await this.service.getProjectsPaged(0, 200);
    if (result.isFailure) return [];
    return (result.value as { items: unknown[] }).items;
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
