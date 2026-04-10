import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { AiProviderFactory } from './ai-provider.factory.js'

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AiProviderFactory,
  ) {}

  async analyzeTranscript(transcriptId: string): Promise<void> {
    // 1. Mark as processing
    await this.prisma.meetingTranscript.update({
      where: { id: transcriptId },
      data: { aiStatus: 'processing', aiError: null },
    })

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

      // 3. Call AI provider
      const provider = this.providerFactory.getProvider()
      const result = await provider.analyze(fullText, uniqueSpeakers)

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
            aiModel: provider.modelName,
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

      this.logger.log(`AI analysis completed for transcript ${transcriptId} (model: ${provider.modelName})`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue'
      this.logger.error(`AI analysis failed for transcript ${transcriptId}: ${message}`)

      await this.prisma.meetingTranscript.update({
        where: { id: transcriptId },
        data: {
          aiStatus: 'failed',
          aiError: message.substring(0, 500),
        },
      })
    }
  }
}
