import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { MeetingsService } from './meetings.service.js'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js'

@Controller('pm/projects/:projectId/meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async upload(
    @Param('projectId') projectId: string,
    @UploadedFile() audio: Express.Multer.File,
    @Body('title') title: string,
    @Body('speakerMap') speakerMap?: string,
  ) {
    if (!audio || !audio.buffer.length) throw new BadRequestException('Fichier audio requis.')
    const result = await this.service.transcribe(projectId, audio.buffer, audio.originalname, title, speakerMap)
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
  async renameSpeaker(@Param('id') id: string, @Body() body: { oldName: string; newName: string }) {
    if (!body.oldName?.trim() || !body.newName?.trim()) {
      throw new BadRequestException("L'ancien et le nouveau nom du locuteur sont requis.")
    }
    const result = await this.service.renameSpeaker(id, body.oldName, body.newName)
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
}
