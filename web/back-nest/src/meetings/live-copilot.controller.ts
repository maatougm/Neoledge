/**
 * @file live-copilot.controller.ts — HTTP entry points for the live
 * meeting copilot. The agent-loop fire is non-blocking (returns 202)
 * and pushes its result to the gateway when ready, so the meeting UI
 * never waits on the LLM round-trip.
 *
 * Feature-flagged behind `LIVE_MEETING_COPILOT=on`. When off, every
 * route returns 404 so the frontend treats it as missing and degrades.
 */

import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  BadRequestException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
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
  ) {}

  // ─── Session lifecycle ────────────────────────────────────────────────────

  @Post('session')
  @HttpCode(HttpStatus.CREATED)
  async startSession(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: StartCopilotSessionDto,
    @CurrentUser() user: JwtUser,
  ) {
    this.assertEnabled()
    const r = this.service.startSession(projectId, dto.liveSessionId, user.userId)
    if (r.isFailure) throw new BadRequestException(r.error)
    return { liveSessionId: dto.liveSessionId, started: true }
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
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: FireCopilotDto,
  ) {
    this.assertEnabled()
    // Run the agent loop detached so the HTTP response returns immediately.
    void this.service
      .fire(dto.liveSessionId)
      .then((result) => {
        if (result.isFailure || !result.value) return
        const value = result.value
        if (value.skipped && value.skipReason) {
          this.gateway.emitFireSkipped(projectId, dto.liveSessionId, value.skipReason)
          return
        }
        if (value.cards.length > 0) {
          this.gateway.emitSuggestions(projectId, dto.liveSessionId, value.cards)
        }
      })
      .catch(() => {
        this.gateway.emitFireSkipped(projectId, dto.liveSessionId, 'provider')
      })
    return { accepted: true }
  }

  // ─── Suggestion actions ───────────────────────────────────────────────────

  @Post('suggestions/:suggestionId/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  async dismiss(@Param('suggestionId', ParseUUIDPipe) suggestionId: string) {
    this.assertEnabled()
    const r = await this.service.dismissSuggestion(suggestionId)
    if (r.isFailure) throw new NotFoundException(r.error)
  }

  @Post('suggestions/:suggestionId/ask')
  @HttpCode(HttpStatus.NO_CONTENT)
  async ask(@Param('suggestionId', ParseUUIDPipe) suggestionId: string) {
    this.assertEnabled()
    const r = await this.service.markAsked(suggestionId)
    if (r.isFailure) throw new NotFoundException(r.error)
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
