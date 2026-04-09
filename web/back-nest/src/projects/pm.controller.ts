import { Controller, Get, Post, Patch, Param, Body, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

interface JwtUser {
  userId: string;
  role: string;
}

@Controller('pm')
@UseGuards(JwtAuthGuard)
export class PmController {
  constructor(
    private readonly service: ProjectsService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('projects')
  async getMyProjects(@CurrentUser() user: JwtUser) {
    const result = await this.service.getByManager(user.userId);
    return result.value;
  }

  @Get('projects/:id')
  async getProject(@Param('id') id: string) {
    const result = await this.service.getById(id);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  @Patch('projects/:id/field-values')
  async saveFieldValues(@Param('id') id: string, @Body() body: { fieldValues: { projectFieldId: string; value: string | null }[] }) {
    const result = await this.service.saveFieldValues(id, body.fieldValues);
    if (result.isFailure) throw new BadRequestException(result.error);
  }

  @Post('projects/:id/fields')
  async addField(@Param('id') id: string, @Body() dto: { label: string; fieldType?: string; isRequired?: boolean; options?: string }) {
    const result = await this.service.addField(id, dto);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Get('projects/:id/validations')
  async getValidations(@Param('id') id: string) {
    const result = await this.service.getValidations(id);
    return result.value;
  }

  @Get('projects/:id/activity')
  async getActivity(@Param('id') id: string) {
    const result = await this.service.getActivity(id);
    return result.value;
  }

  @Post('projects/:id/validations')
  async submitValidation(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: { isApproved: boolean; comment?: string },
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
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      select: { name: true, projectManagerId: true },
    });
    if (!project) return;

    const status = isApproved ? 'approuvée' : 'rejetée';
    const type = isApproved ? 'validation_approved' : 'validation_rejected';
    const title = isApproved ? 'Validation approuvée' : 'Validation rejetée';
    const message = `Validation ${status} pour le projet "${project.name}" — phase: ${phase}`;

    // Notify PM if they are not the submitter
    if (project.projectManagerId && project.projectManagerId !== submitterId) {
      await this.notifications.notify(project.projectManagerId, type, title, message, projectId);
    }

    // Notify all admins except the submitter
    const admins = await this.prisma.appUser.findMany({
      where: { role: 'Admin', isActive: true },
      select: { id: true },
    });

    for (const admin of admins) {
      if (admin.id !== submitterId) {
        await this.notifications.notify(admin.id, type, title, message, projectId);
      }
    }
  }
}
