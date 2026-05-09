/**
 * @file live-copilot.controller.ts — HTTP entry points for the unified
 * meeting copilot. Each fire produces both the project checklist and any
 * inline question suggestions in one shot. The endpoint is non-blocking
 * (returns 202) and pushes the result via the gateway when ready.
 *
 * Feature-flagged behind `LIVE_MEETING_COPILOT=on`. When off, every route
 * returns 404 so the frontend treats it as missing and degrades.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  BadRequestException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service.js'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js'
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js'
import { RolesGuard } from '../common/guards/roles.guard.js'
import { Roles } from '../common/decorators/roles.decorator.js'
import { ProjectAccess } from '../common/decorators/project-access.decorator.js'
import { CurrentUser } from '../common/decorators/current-user.decorator.js'
import { LiveCopilotService } from './live-copilot.service.js'
import { LiveCopilotGateway } from './live-copilot.gateway.js'
import {
  StartCopilotSessionDto,
  AppendCopilotChunkDto,
  FireCopilotDto,
  ChecklistItemActionDto,
  EndCopilotSessionDto,
} from './dto/live-copilot.dto.js'

interface JwtUser {
  userId: string
  role: string
}

@Controller('pm/projects/:projectId/meetings/live/copilot')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, RolesGuard)
@ProjectAccess('projectId')
@Roles('Admin', 'ProjectManager')
export class LiveCopilotController {
  constructor(
    private readonly service: LiveCopilotService,
    private readonly gateway: LiveCopilotGateway,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Driver-field snapshot (frontend coverage gauge) ──────────────────────

  @Get('_drivers')
  async listDrivers(@Param('projectId') projectId: string) {
    this.assertEnabled()
    const fields = await this.prisma.projectField.findMany({
      where: { projectId, isBacklogDriver: true },
      orderBy: { orderIndex: 'asc' },
      include: { values: { select: { value: true } } },
    })
    return {
      items: fields.map((f) => ({
        label: f.label,
        value: f.values[0]?.value ?? null,
        isBacklogDriver: f.isBacklogDriver,
      })),
    }
  }

  // ─── Session lifecycle ────────────────────────────────────────────────────

  @Post('session')
  @HttpCode(HttpStatus.CREATED)
  async startSession(
    @Param('projectId') projectId: string,
    @Body() dto: StartCopilotSessionDto,
    @CurrentUser() user: JwtUser,
  ) {
    this.assertEnabled()
    const r = this.service.startSession(projectId, dto.liveSessionId, user.userId, dto.meetingType)
    if (r.isFailure) throw new BadRequestException(r.error)
    return { liveSessionId: dto.liveSessionId, started: true, meetingType: r.value?.meetingType }
  }

  // ─── Append a transcript chunk ────────────────────────────────────────────

  @Post('append')
  @HttpCode(HttpStatus.OK)
  async append(
    @Param('projectId') _projectId: string,
    @Body() dto: AppendCopilotChunkDto,
  ) {
    this.assertEnabled()
    const r = this.service.appendTranscript(dto.liveSessionId, dto.chunk)
    if (r.isFailure) throw new BadRequestException(r.error)
    return r.value
  }

  // ─── Fire the copilot agent (non-blocking) ────────────────────────────────

  @Post('fire')
  @HttpCode(HttpStatus.ACCEPTED)
  async fire(
    @Param('projectId') projectId: string,
    @Body() dto: FireCopilotDto,
  ) {
    this.assertEnabled()
    void this.service
      .fire(dto.liveSessionId, dto.force === true)
      .then((result) => {
        if (result.isFailure || !result.value) return
        const value = result.value
        if (value.skipped && value.skipReason) {
          this.gateway.emitFireSkipped(projectId, dto.liveSessionId, value.skipReason)
          return
        }
        this.gateway.emitMeetingState(projectId, dto.liveSessionId, {
          checklist: value.checklist,
          hint: value.hint,
          readyForCahier: value.readyForCahier,
        })
        // Derive the agent-tagged coverage signal from the emitted checklist
        // (covered + partial sections) so the keyword baseline is replaced.
        const sections = Array.from(
          new Set(
            value.checklist
              .filter((i) => i.status !== 'missing')
              .map((i) => i.section),
          ),
        )
        if (sections.length > 0) {
          this.gateway.emitCoverage(projectId, dto.liveSessionId, sections)
        }
      })
      .catch(() => {
        this.gateway.emitFireSkipped(projectId, dto.liveSessionId, 'provider')
      })
    return { accepted: true }
  }

  // ─── Per-item actions (Ask / Ignore on a checklist row) ───────────────────

  @Post('items/:itemId/ask')
  @HttpCode(HttpStatus.OK)
  async askItem(
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ChecklistItemActionDto,
  ) {
    this.assertEnabled()
    if (dto.itemId !== itemId) throw new BadRequestException('itemId mismatch')
    const r = await this.service.recordItemAction(dto.liveSessionId, itemId, 'asked')
    if (r.isFailure) throw new NotFoundException(r.error)
    if (r.value) {
      this.gateway.emitMeetingState(projectId, dto.liveSessionId, {
        checklist: r.value.checklist,
        hint: this.service.getState(dto.liveSessionId)?.hint ?? null,
        readyForCahier: this.service.getState(dto.liveSessionId)?.readyForCahier ?? false,
      })
    }
    return { ok: true }
  }

  @Post('items/:itemId/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismissItem(
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ChecklistItemActionDto,
  ) {
    this.assertEnabled()
    if (dto.itemId !== itemId) throw new BadRequestException('itemId mismatch')
    const r = await this.service.recordItemAction(dto.liveSessionId, itemId, 'dismissed')
    if (r.isFailure) throw new NotFoundException(r.error)
    if (r.value) {
      this.gateway.emitMeetingState(projectId, dto.liveSessionId, {
        checklist: r.value.checklist,
        hint: this.service.getState(dto.liveSessionId)?.hint ?? null,
        readyForCahier: this.service.getState(dto.liveSessionId)?.readyForCahier ?? false,
      })
    }
    return { ok: true }
  }

  // ─── End session ──────────────────────────────────────────────────────────

  @Delete('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  async endSession(@Body() dto: EndCopilotSessionDto) {
    this.assertEnabled()
    await this.service.endSession(dto.liveSessionId, dto.meetingTranscriptId ?? null)
  }

  // ─── Feature flag ─────────────────────────────────────────────────────────

  private assertEnabled(): void {
    const flag = (this.config.get<string>('LIVE_MEETING_COPILOT') ?? 'off').toLowerCase()
    if (flag !== 'on') throw new NotFoundException('Live meeting copilot is disabled.')
  }
}
