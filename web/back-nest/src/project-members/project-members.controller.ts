import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js'
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js'
import { RolesGuard } from '../common/guards/roles.guard.js'
import { ProjectAccess } from '../common/decorators/project-access.decorator.js'
import { Roles } from '../common/decorators/roles.decorator.js'
import { CurrentUser } from '../common/decorators/current-user.decorator.js'
import { ProjectMembersService } from './project-members.service.js'
import { AuditService } from '../audit/audit.service.js'
import { AddProjectMemberDto, UpdateProjectMemberDto } from './dto/project-member.dto.js'

interface JwtUser { userId: string; role: string }

@Controller('pm/projects/:projectId/members')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, RolesGuard)
@ProjectAccess('projectId')
export class ProjectMembersController {
  constructor(
    private readonly service: ProjectMembersService,
    private readonly audit: AuditService,
  ) {}

  /** Anyone with project access can read the membership list — needed by
   *  the validation team for context, by team members for collaboration. */
  @Get()
  async list(@Param('projectId') projectId: string) {
    const result = await this.service.findAll(projectId)
    if (result.isFailure) throw new NotFoundException(result.error)
    return result.value
  }

  /** Admin or PM only — Member / SpecificationTeam roles must NOT be able
   *  to add other people to the project (privilege escalation risk). */
  @Post()
  @Roles('Admin', 'ProjectManager')
  async add(
    @Param('projectId') projectId: string,
    @Body() dto: AddProjectMemberDto,
    @CurrentUser() actor: JwtUser,
  ) {
    const result = await this.service.add(projectId, dto.userId, dto.label)
    if (result.isFailure || !result.value) {
      if (result.error?.includes('déjà')) throw new ConflictException(result.error)
      if (result.error?.includes('introuvable')) throw new NotFoundException(result.error)
      throw new BadRequestException(result.error ?? 'Erreur lors de l\'ajout du membre')
    }
    void this.audit.log(
      'ProjectMember',
      result.value.id,
      'CREATE',
      actor.userId,
      undefined,
      { projectId, addedUserId: dto.userId, label: dto.label },
    )
    return result.value
  }

  @Patch(':memberId')
  @Roles('Admin', 'ProjectManager')
  async updateLabel(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateProjectMemberDto,
    @CurrentUser() actor: JwtUser,
  ) {
    const result = await this.service.updateLabel(memberId, dto.label)
    if (result.isFailure) throw new NotFoundException(result.error)
    void this.audit.log(
      'ProjectMember',
      memberId,
      'UPDATE',
      actor.userId,
      { label: { before: undefined, after: dto.label } },
      { projectId },
    )
    return { success: true }
  }

  @Delete(':memberId')
  @Roles('Admin', 'ProjectManager')
  async remove(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() actor: JwtUser,
    @Query('force') force?: string,
    @Query('reassignTo') reassignTo?: string,
  ) {
    const opts = {
      force: force === 'true' || force === '1',
      reassignTo: reassignTo || undefined,
      actorId: actor.userId,
    }
    const result = await this.service.remove(memberId, opts)
    if (result.isFailure) {
      if (result.error?.startsWith('BLOCKERS:')) {
        const json = result.error.slice('BLOCKERS:'.length)
        let blockers: Record<string, number> = {}
        try { blockers = JSON.parse(json) as Record<string, number> } catch { /* ignore */ }
        throw new ConflictException({
          message: 'Ce membre a encore des références actives sur le projet',
          blockers,
          code: 'MEMBER_HAS_BLOCKERS',
        })
      }
      if (result.error === 'Membre introuvable') throw new NotFoundException(result.error)
      throw new BadRequestException(result.error)
    }
    void this.audit.log(
      'ProjectMember',
      memberId,
      'DELETE',
      actor.userId,
      undefined,
      { projectId, force: opts.force, reassignTo: opts.reassignTo ?? null },
    )
    return { success: true }
  }
}
