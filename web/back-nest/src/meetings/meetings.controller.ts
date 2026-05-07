import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common'
import type { Response } from 'express'
import { createReadStream } from 'fs'
import { FileInterceptor } from '@nestjs/platform-express'
import { MeetingsService } from './meetings.service.js'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js'
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js'
import { RolesGuard } from '../common/guards/roles.guard.js'
import { ProjectAccess } from '../common/decorators/project-access.decorator.js'
import { Roles } from '../common/decorators/roles.decorator.js'
import { CurrentUser } from '../common/decorators/current-user.decorator.js'
import { isAudioBuffer } from './audio-signature.js'

interface AuthUser { userId: string }

@Controller('pm/projects/:projectId/meetings')
@UseGuards(JwtAuthGuard, ProjectAccessGuard, RolesGuard)
@ProjectAccess('projectId')
export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: 100 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = new Set([
          'audio/mpeg',
          'audio/wav',
          'audio/x-wav',
          'audio/webm',
          'audio/ogg',
          'audio/mp4',
          'audio/flac',
          'audio/x-m4a',
        ])
        if (!allowed.has(file.mimetype)) {
          return cb(new BadRequestException('Unsupported audio format'), false)
        }
        cb(null, true)
      },
    }),
  )
  async upload(
    @Param('projectId') projectId: string,
    @UploadedFile() audio: Express.Multer.File,
    @Body('title') title: string,
  ) {
    if (!audio || !audio.buffer.length) throw new BadRequestException('Fichier audio requis.')
    // MIME type is client-supplied and cannot be trusted. Verify the real
    // file signature from the buffer header before accepting the upload.
    if (!isAudioBuffer(audio.buffer.subarray(0, 32))) {
      throw new BadRequestException(
        'Format audio non supporté — formats acceptés: MP3, WAV, OGG, FLAC, M4A, WebM',
      )
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      throw new BadRequestException('Le titre de la réunion est requis.')
    }
    if (title.length > 200) {
      throw new BadRequestException('Le titre ne peut pas dépasser 200 caractères.')
    }
    const result = await this.service.transcribe(projectId, audio.buffer, audio.originalname, title.trim())
    if (result.isFailure) throw new BadRequestException(result.error)
    return result.value
  }

  @Get()
  async getByProject(@Param('projectId') projectId: string) {
    const result = await this.service.getByProject(projectId)
    return result.value
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const result = await this.service.getById(id)
    if (result.isFailure) throw new NotFoundException(result.error)
    return result.value
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string) {
    const result = await this.service.deleteTranscript(id)
    if (result.isFailure) throw new NotFoundException(result.error)
  }

  @Patch(':id/rename-speaker')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('Admin', 'ProjectManager')
  async renameSpeaker(
    @Param('id') id: string,
    @Body() body: { oldName: string; newName: string },
    @CurrentUser() user: AuthUser,
  ) {
    if (!body.oldName?.trim() || !body.newName?.trim()) {
      throw new BadRequestException("L'ancien et le nouveau nom du locuteur sont requis.")
    }
    if (body.newName.length > 100) {
      throw new BadRequestException('Le nouveau nom du locuteur ne peut pas dépasser 100 caractères.')
    }
    const result = await this.service.renameSpeaker(id, body.oldName, body.newName, user.userId)
    if (result.isFailure) throw new NotFoundException(result.error)
  }

  @Post(':id/ai-analyze')
  async aiAnalyze(@Param('id') id: string) {
    const result = await this.service.triggerAiAnalysis(id)
    if (result.isFailure) throw new NotFoundException(result.error)
    return result.value
  }

  @Get(':id/ai-results')
  async getAiResults(@Param('id') id: string) {
    const result = await this.service.getAiResults(id)
    if (result.isFailure) throw new NotFoundException(result.error)
    return result.value
  }

  /**
   * POST /pm/projects/:projectId/meetings/:id/audio
   * Attach the recorded audio blob to an existing live-meeting transcript so
   * the validation team can re-listen. Multipart field: 'audio'.
   */
  @Post(':id/audio')
  @Roles('Admin', 'ProjectManager', 'SpecificationTeam')
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: 200 * 1024 * 1024 } }),
  )
  async attachAudio(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @UploadedFile() audio: Express.Multer.File,
  ) {
    if (!audio?.buffer?.length) {
      throw new BadRequestException('Fichier audio requis.')
    }
    const result = await this.service.attachAudio(
      projectId,
      id,
      audio.buffer,
      audio.mimetype || 'audio/webm',
    )
    if (result.isFailure) throw new BadRequestException(result.error)
    // Fire-and-forget: re-run the full transcription with speaker
    // diarization on the saved audio so the meeting detail shows real
    // speaker separation instead of a single "PM + invités" blob.
    void this.service.redoDiarization(id).catch(() => undefined)
    return result.value
  }

  /**
   * PATCH /pm/projects/:projectId/meetings/:id/preserve
   * Body: { preserved: boolean }
   * Marks (or unmarks) the meeting's audio as preserved so the retention
   * cron will skip it.
   */
  @Patch(':id/preserve')
  @Roles('Admin', 'ProjectManager')
  async setPreserve(
    @Param('id') id: string,
    @Body() body: { preserved?: boolean },
  ) {
    const result = await this.service.setAudioPreserved(id, !!body.preserved)
    if (result.isFailure) throw new NotFoundException(result.error)
    return result.value
  }

  /**
   * GET /pm/projects/:projectId/meetings/:id/audio
   * Stream the stored audio so any project member (PM or validation team)
   * can replay the meeting.
   */
  @Get(':id/audio')
  async streamAudio(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.service.getAudioFile(id)
    if (result.isFailure || !result.value) throw new NotFoundException(result.error ?? 'Audio non disponible.')
    const { path: filePath, mimeType, size } = result.value
    res.set({
      'Content-Type': mimeType,
      'Content-Length': String(size),
      'Cache-Control': 'private, max-age=300',
    })
    return new StreamableFile(createReadStream(filePath))
  }
}
