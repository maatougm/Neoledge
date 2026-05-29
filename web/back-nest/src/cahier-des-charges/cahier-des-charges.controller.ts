import { Controller, Get, Post, Patch, Param, Body, Req, Res, Header, UseGuards, Logger } from '@nestjs/common'
import type { Response, Request } from 'express'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js'
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js'
import { RolesGuard } from '../common/guards/roles.guard.js'
import { ProjectAccess } from '../common/decorators/project-access.decorator.js'
import { Roles } from '../common/decorators/roles.decorator.js'
import { AllowSpecReviewer } from '../common/decorators/allow-spec-reviewer.decorator.js'
import { CahierDesChargesService } from './cahier-des-charges.service.js'
import { CahierFeedbackDto } from './dto/cahier-feedback.dto.js'
import type { CahierStreamEvent } from './cahier-des-charges.types.js'

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
  // PM/Admin only — this GET runs a full AI generation (cost + AiUsage writes),
  // so it must NOT be reachable via the SpecificationTeam read-grant. The spec
  // team reviews the SAVED cahier; they don't generate/regenerate.
  @Get('pm/projects/:projectId/cahier-des-charges/generate')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard, RolesGuard)
  @ProjectAccess('projectId')
  @Roles('Admin', 'ProjectManager')
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
      // Each download triggers a fresh AI call; if a previous identical docx
      // was generated, Express would otherwise weak-ETag the buffer and return
      // 304 on a re-download, handing the browser an empty file.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    })
    res.send(buffer)
  }

  /**
   * GET /pm/projects/:projectId/cahier-des-charges/preflight
   *
   * Inspect questionnaire + meetings + saved cahier and report what's missing
   * BEFORE generation. The PM can then either fill the gaps, schedule another
   * meeting, or proceed anyway. Prevents the AI from inventing content for
   * sections where no source data exists.
   */
  @Get('pm/projects/:projectId/cahier-des-charges/preflight')
  // AI-generated content varies per call (timestamp + heuristic state) and is
  // expensive. Disable client/proxy caching so the browser never short-circuits
  // a regeneration request with a stale 304.
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  @UseGuards(JwtAuthGuard, ProjectAccessGuard)
  @ProjectAccess('projectId')
  async preflightCahier(@Param('projectId') projectId: string) {
    return this.cahierService.runPreflight(projectId)
  }

  /**
   * GET /pm/projects/:projectId/cahier-des-charges/preview
   *
   * Returns the AI-generated content as JSON (for preview in frontend before download).
   */
  @Get('pm/projects/:projectId/cahier-des-charges/preview')
  // Same as /preflight: each call runs the AI and we never want the browser
  // to return a cached 304 with an empty body, which silently broke "Générer"
  // on the second click and surfaced as a generic "Erreur lors de la génération".
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  // PM/Admin only — runs AI generation; keep it off the SpecTeam read-grant.
  @UseGuards(JwtAuthGuard, ProjectAccessGuard, RolesGuard)
  @ProjectAccess('projectId')
  @Roles('Admin', 'ProjectManager')
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
   * GET /pm/projects/:projectId/cahier-des-charges/preview-stream
   *
   * Server-Sent Events variant of /preview. Emits one `section` event per
   * group as it lands, then a single `complete` event with the full result.
   * Frontend renders sections progressively; saves only after `complete`.
   *
   * Event grammar:
   *   event: started        data: {"totalGroups":3,"transcriptCount":N}
   *   event: section        data: {"group":"intro","partial":{...},"latencyMs":N}
   *   event: group_error    data: {"group":"scope","message":"…"}
   *   event: complete       data: {"aiContent":{...9 keys…},"durationMs":N}
   *   event: error          data: {"message":"…"}
   *
   * When `CAHIER_STREAM_SECTIONS=off`, the endpoint still works but emits
   * one `complete` event after running the standard /preview path. That
   * keeps the client-side wire format stable across flag flips.
   */
  @Get('pm/projects/:projectId/cahier-des-charges/preview-stream')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  // PM/Admin only — runs AI generation; keep it off the SpecTeam read-grant.
  @UseGuards(JwtAuthGuard, ProjectAccessGuard, RolesGuard)
  @ProjectAccess('projectId')
  @Roles('Admin', 'ProjectManager')
  async previewStream(
    @Param('projectId') projectId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // SSE handshake. Flush headers immediately so the client gets the
    // 200/OK + content-type even if the first event takes a moment.
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const send = (event: CahierStreamEvent): void => {
      // SSE frame: `event: <name>\ndata: <json>\n\n`. The data line must NOT
      // contain raw newlines; JSON.stringify guarantees this.
      const payload = JSON.stringify(event)
      res.write(`event: ${event.type}\n`)
      res.write(`data: ${payload}\n\n`)
    }

    // Translate client disconnect to an AbortSignal the service can observe.
    const aborter = new AbortController()
    req.on('close', () => {
      if (!res.writableEnded) {
        aborter.abort()
      }
    })

    try {
      const { formData, transcripts } = await this.cahierService.gatherProjectData(projectId)

      // Flag-off branch: still expose the streaming endpoint, but emit a
      // single complete event so the client UI stays identical.
      if (!this.cahierService.isSectionStreamingEnabled()) {
        send({ type: 'started', totalGroups: 3, transcriptCount: transcripts.length })
        const aiContent = await this.cahierService.generateCahierContent(formData, transcripts, projectId)
        send({ type: 'complete', aiContent, durationMs: 0 })
        res.end()
        return
      }

      await this.cahierService.streamCahierContent(
        formData,
        transcripts,
        projectId,
        (event) => {
          if (!res.writableEnded) send(event)
        },
        aborter.signal,
      )
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Erreur inconnue'
      this.logger.error(`previewStream failed for project ${projectId}: ${message}`)
      if (!res.writableEnded) send({ type: 'error', message })
    } finally {
      if (!res.writableEnded) res.end()
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
  // Spec team is global (not project members): let an active SpecificationTeam
  // reviewer submit feedback on any cahier'd project. saveFeedback re-authorizes
  // (active SpecificationTeam or Admin; PM self-approval still blocked).
  @AllowSpecReviewer()
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
