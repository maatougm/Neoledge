import { Controller, Get, Post, Patch, Param, Body, Req, Res, UseGuards, Logger } from '@nestjs/common'
import type { Response, Request } from 'express'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js'
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js'
import { ProjectAccess } from '../common/decorators/project-access.decorator.js'
import { CahierDesChargesService } from './cahier-des-charges.service.js'
import { CahierFeedbackDto } from './dto/cahier-feedback.dto.js'

interface AuthenticatedRequest extends Request {
  user?: { userId: string }
}

@Controller()
export class CahierDesChargesController {
  private readonly logger = new Logger(CahierDesChargesController.name)

  constructor(private readonly cahierService: CahierDesChargesService) {}

  /**
   * GET /pm/projects/:projectId/cahier-des-charges/generate
   *
   * Generates a complete cahier des charges for the given project.
   * Gathers form data + all transcripts → calls AI (with past feedback) → returns .docx file.
   */
  @Get('pm/projects/:projectId/cahier-des-charges/generate')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard)
  @ProjectAccess('projectId')
  async generateCahier(
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`Generating cahier des charges for project ${projectId}`)

    const { buffer, fileName } = await this.cahierService.generateDocx(projectId)

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Content-Length': buffer.length.toString(),
    })
    res.send(buffer)
  }

  /**
   * GET /pm/projects/:projectId/cahier-des-charges/preview
   *
   * Returns the AI-generated content as JSON (for preview in frontend before download).
   */
  @Get('pm/projects/:projectId/cahier-des-charges/preview')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard)
  @ProjectAccess('projectId')
  async previewCahier(@Param('projectId') projectId: string) {
    this.logger.log(`Preview cahier des charges for project ${projectId}`)

    const { formData, transcripts } = await this.cahierService.gatherProjectData(projectId)
    const aiContent = await this.cahierService.generateCahierContent(formData, transcripts, projectId)

    return {
      formData,
      aiContent,
      transcriptCount: transcripts.length,
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * POST /pm/projects/:projectId/cahier-des-charges/save
   *
   * Persist the AI-generated cahier content as JSON in Project.aiOutput so the
   * Cahier tab and Validation tab can render it without re-calling the AI.
   */
  @Post('pm/projects/:projectId/cahier-des-charges/save')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard)
  @ProjectAccess('projectId')
  async saveCahier(
    @Param('projectId') projectId: string,
    @Body() body: { aiContent: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.userId ?? null
    await this.cahierService.savePersistedCahier(projectId, body?.aiContent, userId)
    return { success: true }
  }

  /**
   * GET /pm/projects/:projectId/cahier-des-charges/versions
   * List the project's cahier history (last 50, newest first).
   */
  @Get('pm/projects/:projectId/cahier-des-charges/versions')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard)
  @ProjectAccess('projectId')
  async listVersions(@Param('projectId') projectId: string) {
    return { versions: await this.cahierService.listVersions(projectId) }
  }

  /**
   * GET /pm/projects/:projectId/cahier-des-charges/versions/:versionId
   * Return one historical version's full content.
   */
  @Get('pm/projects/:projectId/cahier-des-charges/versions/:versionId')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard)
  @ProjectAccess('projectId')
  async getVersion(
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ) {
    const v = await this.cahierService.getVersion(projectId, versionId)
    if (!v) return { aiContent: null }
    return v
  }

  /**
   * PATCH /pm/projects/:projectId/cahier-des-charges/content
   *
   * In-place edit of the saved cahier JSON. Used by the SpecificationTeam (or
   * the PM) to fix wording / structure without re-running the AI. Preserves
   * the original savedAt so the validation queue is NOT reset, and writes a
   * `cahier_edited` activity row.
   */
  @Patch('pm/projects/:projectId/cahier-des-charges/content')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard)
  @ProjectAccess('projectId')
  async editContent(
    @Param('projectId') projectId: string,
    @Body() body: { aiContent: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.userId ?? null
    await this.cahierService.editCahierContent(projectId, body?.aiContent, userId)
    return { success: true }
  }

  /**
   * GET /pm/projects/:projectId/cahier-des-charges/saved
   *
   * Return the last saved cahier JSON (from Project.aiOutput). Returns {aiContent: null}
   * if nothing has been generated+saved yet.
   */
  @Get('pm/projects/:projectId/cahier-des-charges/saved')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard)
  @ProjectAccess('projectId')
  async getSavedCahier(@Param('projectId') projectId: string) {
    return this.cahierService.getPersistedCahier(projectId)
  }

  /**
   * GET /pm/projects/:projectId/cahier-des-charges/status
   *
   * Aggregate validation status: { status: 'none'|'pending'|'approved'|'rejected',
   * cahierSavedAt, lastFeedback, approverCount, rejectionCount }.
   * Used to render the status badge + reject banner.
   */
  @Get('pm/projects/:projectId/cahier-des-charges/status')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard)
  @ProjectAccess('projectId')
  async getStatus(@Param('projectId') projectId: string) {
    return this.cahierService.getCahierStatus(projectId)
  }

  /**
   * POST /pm/projects/:projectId/cahier-des-charges/feedback
   *
   * Save user feedback on a generated cahier des charges.
   * When rejected, the comment is stored and fed into the AI prompt on the next generation
   * so that the AI learns from its mistakes and doesn't repeat them.
   *
   * Body: { status: 'approved' | 'rejected', comment: string, section?: string }
   */
  @Post('pm/projects/:projectId/cahier-des-charges/feedback')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard)
  @ProjectAccess('projectId')
  async submitFeedback(
    @Param('projectId') projectId: string,
    @Body() body: CahierFeedbackDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.userId ?? ''
    const { status, comment, section } = body

    await this.cahierService.saveFeedback(projectId, userId, status, comment.trim(), section)

    return {
      success: true,
      message:
        status === 'rejected'
          ? 'Feedback enregistré. La prochaine génération prendra en compte vos remarques.'
          : 'Approbation enregistrée.',
    }
  }

  /**
   * GET /pm/projects/:projectId/cahier-des-charges/feedback
   *
   * Returns past feedback for this project (for display in the UI).
   */
  @Get('pm/projects/:projectId/cahier-des-charges/feedback')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard)
  @ProjectAccess('projectId')
  async getFeedback(@Param('projectId') projectId: string) {
    const feedback = await this.cahierService.getPastFeedback(projectId)
    return { feedback }
  }
}
