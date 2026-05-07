import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { AiProviderFactory } from './ai-provider.factory.js'
import type { AiAnalysisResult } from './ai.types.js'

/** Strip API keys and auth tokens from error messages before persisting. */
function sanitizeAiError(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9\-_]{20,}/g, '[REDACTED_OPENAI_KEY]')
    .replace(/AIza[0-9A-Za-z\-_]{35}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/key=[^&\s"']+/gi, 'key=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9\-_\.]+/gi, 'Bearer [REDACTED]')
    .substring(0, 500)
}

/** Rows stuck in 'processing' for longer than this are considered abandoned. */
const AI_STUCK_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AiProviderFactory,
  ) {}

  /** On startup, mark any rows stuck in processing as failed. */
  async onModuleInit(): Promise<void> {
    try {
      const stuckBefore = new Date(Date.now() - AI_STUCK_THRESHOLD_MS)
      const { count } = await this.prisma.meetingTranscript.updateMany({
        where: { aiStatus: 'processing', aiStartedAt: { lt: stuckBefore } },
        data: { aiStatus: 'failed', aiError: 'Timed out (abandoned on restart)' },
      })
      if (count > 0) {
        this.logger.warn(`Marked ${count} stuck AI processing row(s) as failed on startup.`)
      }
    } catch (e: unknown) {
      this.logger.error(`onModuleInit stuck-sweep failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async analyzeTranscript(transcriptId: string): Promise<void> {
    // 1. Mark as processing — only if not already processing (concurrency guard).
    const { count } = await this.prisma.meetingTranscript.updateMany({
      where: { id: transcriptId, aiStatus: { not: 'processing' } },
      data: { aiStatus: 'processing', aiError: null, aiStartedAt: new Date() },
    })
    if (count === 0) {
      // Either the row doesn't exist or it's already processing — bail out.
      this.logger.warn(`analyzeTranscript: transcript ${transcriptId} is already processing or missing — skipping.`)
      return
    }

    try {
      // 2. Fetch segments and build transcript text
      const transcript = await this.prisma.meetingTranscript.findUnique({
        where: { id: transcriptId },
        include: { segments: { orderBy: { startTime: 'asc' } } },
      })

      if (!transcript) {
        throw new Error('Transcription introuvable')
      }

      const fullText = transcript.segments
        .map((s) => `${s.speaker}: ${s.text}`)
        .join('\n')

      const uniqueSpeakers = [...new Set(transcript.segments.map((s) => s.speaker))]

      // 3. Call primary provider — on error, fall back to AI_FALLBACK_PROVIDER if configured.
      const primary = this.providerFactory.getPrimary()
      const fallback = this.providerFactory.getFallback()
      let result: AiAnalysisResult
      let modelUsed = primary.modelName
      try {
        result = await primary.analyze(fullText, uniqueSpeakers)
      } catch (primaryErr: unknown) {
        if (!fallback) throw primaryErr
        const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
        this.logger.warn(`Primary provider (${primary.modelName}) failed: ${msg.slice(0, 200)} — falling back to ${fallback.modelName}`)
        result = await fallback.analyze(fullText, uniqueSpeakers)
        modelUsed = `${fallback.modelName} (fallback)`
      }

      // 4. Persist results in a transaction
      await this.prisma.$transaction(async (tx) => {
        // Clear previous results
        await tx.meetingActionItem.deleteMany({ where: { transcriptId } })
        await tx.meetingDecision.deleteMany({ where: { transcriptId } })

        // Update transcript
        await tx.meetingTranscript.update({
          where: { id: transcriptId },
          data: {
            aiSummary: result.summary,
            aiStatus: 'completed',
            aiProcessedAt: new Date(),
            aiModel: modelUsed,
            aiError: null,
          },
        })

        // Create action items
        if (result.actionItems.length > 0) {
          await tx.meetingActionItem.createMany({
            data: result.actionItems.map((item) => ({
              id: crypto.randomUUID(),
              transcriptId,
              description: item.description,
              assigneeName: item.assigneeName ?? null,
              dueDate: item.dueDate ? new Date(item.dueDate) : null,
            })),
          })
        }

        // Create decisions
        if (result.decisions.length > 0) {
          await tx.meetingDecision.createMany({
            data: result.decisions.map((d) => ({
              id: crypto.randomUUID(),
              transcriptId,
              description: d.description,
              category: d.category,
            })),
          })
        }
      })

      this.logger.log(`AI analysis completed for transcript ${transcriptId} (model: ${modelUsed})`)

      // Log to global activity feed so admin/activity page reflects AI completions.
      void this.prisma.projectActivity
        .create({
          data: {
            projectId: transcript.projectId,
            userId: null,
            action: 'ai_analysis_completed',
            detail: `Analyse IA terminée (${modelUsed}) — ${result.actionItems.length} action(s), ${result.decisions.length} décision(s)`,
          },
        })
        .catch(() => { /* non-fatal */ })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue'
      this.logger.error(`AI analysis failed for transcript ${transcriptId}: ${message}`)

      const transcript = await this.prisma.meetingTranscript.findUnique({
        where: { id: transcriptId },
        select: { projectId: true },
      })

      await this.prisma.meetingTranscript.update({
        where: { id: transcriptId },
        data: {
          aiStatus: 'failed',
          aiError: sanitizeAiError(message),
        },
      })

      // Log failure so the activity feed shows it too.
      if (transcript) {
        void this.prisma.projectActivity
          .create({
            data: {
              projectId: transcript.projectId,
              userId: null,
              action: 'ai_analysis_failed',
              detail: sanitizeAiError(message),
            },
          })
          .catch(() => { /* non-fatal */ })
      }
    }
  }
}
