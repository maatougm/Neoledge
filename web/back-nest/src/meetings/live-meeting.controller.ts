import {
  Body,
  Controller,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { ProjectAccess } from '../common/decorators/project-access.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import {
  LiveMeetingService,
  type ChecklistItem,
  type ChecklistResponse,
} from './live-meeting.service.js';

@Controller('pm/projects/:projectId/meetings/live')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, RolesGuard)
@ProjectAccess('projectId')
export class LiveMeetingController {
  constructor(private readonly service: LiveMeetingService) {}

  /**
   * POST /pm/projects/:projectId/meetings/live/checklist
   * Body: { transcript: string, previousChecklist?: ChecklistItem[] }
   * Returns the updated checklist + readiness flag.
   */
  @Post('checklist')
  @Roles('Admin', 'ProjectManager')
  async checklist(
    @Param('projectId') projectId: string,
    @Body() body: { transcript?: string; previousChecklist?: ChecklistItem[] },
  ): Promise<ChecklistResponse> {
    const transcript = typeof body?.transcript === 'string' ? body.transcript : '';
    const prev = Array.isArray(body?.previousChecklist) ? body.previousChecklist : [];
    return this.service.checklist(projectId, transcript, prev);
  }

  /**
   * POST /pm/projects/:projectId/meetings/live/transcribe-chunk
   * Multipart form field 'audio'. Used by the online meeting mode (tab capture).
   * Returns { text }.
   */
  @Post('transcribe-chunk')
  @Roles('Admin', 'ProjectManager', 'SpecificationTeam')
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  async transcribeChunk(
    @UploadedFile() audio: Express.Multer.File,
  ): Promise<{ text: string }> {
    if (!audio?.buffer?.length) throw new BadRequestException('Chunk audio requis.');
    return this.service.transcribeChunk(audio.buffer, audio.mimetype || 'audio/webm');
  }

  /**
   * POST /pm/projects/:projectId/meetings/live/save
   * Persist the live transcript as a regular MeetingTranscript.
   */
  @Post('save')
  @Roles('Admin', 'ProjectManager', 'SpecificationTeam')
  async save(
    @Param('projectId') projectId: string,
    @Body() body: { title?: string; transcript?: string; durationSeconds?: number },
  ): Promise<{ transcriptId: string }> {
    return this.service.saveLiveTranscript(
      projectId,
      typeof body?.title === 'string' ? body.title : 'Réunion en direct',
      typeof body?.transcript === 'string' ? body.transcript : '',
      typeof body?.durationSeconds === 'number' ? body.durationSeconds : 0,
    );
  }
}
