import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service.js'
import { Result } from '../common/result.js'
import { AiService } from '../ai/ai.service.js'

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly aiService: AiService,
  ) {}

  async transcribe(projectId: string, audioBuffer: Buffer, fileName: string, title: string, speakerMap?: string) {
    const serviceUrl = this.config.get<string>('TRANSCRIPTION_URL', 'http://localhost:8000')

    try {
      const formData = new FormData()
      formData.append('audio', new Blob([audioBuffer as unknown as BlobPart]), fileName)

      const response = await fetch(`${serviceUrl}/transcribe`, { method: 'POST', body: formData })

      if (!response.ok) {
        const text = await response.text()
        this.logger.error(`Transcription service error: ${response.status} ${text}`)
        return Result.fail<any>(`Erreur de transcription : ${text}`)
      }

      const data: any = await response.json()

      const transcript = await this.prisma.meetingTranscript.create({
        data: {
          projectId,
          title,
          originalFileName: fileName,
          durationSeconds: Math.round(data.duration_seconds ?? 0),
          detectedLanguages: (data.detected_languages ?? []).join(','),
          recordedAt: new Date(),
        },
      })

      const segments = (data.segments ?? []).map((s: any) => ({
        transcriptId: transcript.id,
        speaker: s.speaker ?? 'Unknown',
        text: s.text ?? '',
        startTime: s.start_time ?? 0,
        endTime: s.end_time ?? 0,
        language: s.language ?? '',
        confidence: s.confidence ?? 0,
      }))

      if (segments.length > 0) {
        await this.prisma.transcriptSegment.createMany({ data: segments })
      }

      // Fire-and-forget AI analysis if enabled
      const aiEnabled = this.config.get<string>('AI_ENABLED', 'false')
      if (aiEnabled === 'true' || aiEnabled === '1') {
        void this.aiService.analyzeTranscript(transcript.id).catch((e: unknown) =>
          this.logger.error(`Unhandled AI error for transcript ${transcript.id}: ${e instanceof Error ? e.message : String(e)}`)
        )
      }

      return this.getById(transcript.id)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue'
      this.logger.error(`Transcription failed: ${message}`)
      return Result.fail<any>(`Erreur de transcription : ${message}`)
    }
  }

  async getByProject(projectId: string) {
    const transcripts = await this.prisma.meetingTranscript.findMany({
      where: { projectId },
      include: { _count: { select: { segments: true } } },
      orderBy: { createdAt: 'desc' },
    })

    return Result.ok(
      transcripts.map((t) => ({
        id: t.id,
        title: t.title,
        durationSeconds: t.durationSeconds,
        detectedLanguages: t.detectedLanguages,
        segmentCount: t._count.segments,
        recordedAt: t.recordedAt,
        createdAt: t.createdAt,
        aiStatus: t.aiStatus,
      })),
    )
  }

  async getById(id: string) {
    const t = await this.prisma.meetingTranscript.findUnique({
      where: { id },
      include: { segments: { orderBy: { startTime: 'asc' } } },
    })
    if (!t) return Result.fail<any>('Transcription non trouvée.')

    return Result.ok({
      id: t.id,
      projectId: t.projectId,
      title: t.title,
      durationSeconds: t.durationSeconds,
      detectedLanguages: t.detectedLanguages,
      recordedAt: t.recordedAt,
      createdAt: t.createdAt,
      aiStatus: t.aiStatus,
      segments: t.segments.map((s) => ({
        id: s.id,
        speaker: s.speaker,
        text: s.text,
        startTime: s.startTime,
        endTime: s.endTime,
        language: s.language,
        confidence: s.confidence,
      })),
    })
  }

  async deleteTranscript(id: string) {
    const t = await this.prisma.meetingTranscript.findUnique({ where: { id } })
    if (!t) return Result.fail('Transcription non trouvée.')
    await this.prisma.meetingTranscript.delete({ where: { id } })
    return Result.ok()
  }

  async renameSpeaker(id: string, oldName: string, newName: string) {
    const t = await this.prisma.meetingTranscript.findUnique({ where: { id } })
    if (!t) return Result.fail('Transcription non trouvée.')

    await this.prisma.transcriptSegment.updateMany({
      where: { transcriptId: id, speaker: oldName },
      data: { speaker: newName },
    })

    return Result.ok()
  }

  async triggerAiAnalysis(transcriptId: string) {
    const t = await this.prisma.meetingTranscript.findUnique({ where: { id: transcriptId } })
    if (!t) return Result.fail<any>('Transcription non trouvée.')

    // Fire and forget
    void this.aiService.analyzeTranscript(transcriptId).catch((e: unknown) =>
      this.logger.error(`Unhandled AI error for transcript ${transcriptId}: ${e instanceof Error ? e.message : String(e)}`)
    )

    return Result.ok({ aiStatus: 'processing' })
  }

  async getAiResults(transcriptId: string) {
    const t = await this.prisma.meetingTranscript.findUnique({
      where: { id: transcriptId },
      include: {
        actionItems: { orderBy: { createdAt: 'asc' } },
        decisions: { orderBy: { createdAt: 'asc' } },
      },
    })

    if (!t) return Result.fail<any>('Transcription non trouvée.')

    return Result.ok({
      aiStatus: t.aiStatus,
      aiSummary: t.aiSummary,
      aiError: t.aiError,
      aiModel: t.aiModel,
      aiProcessedAt: t.aiProcessedAt,
      actionItems: t.actionItems.map((a) => ({
        id: a.id,
        description: a.description,
        assigneeName: a.assigneeName,
        dueDate: a.dueDate,
        isCompleted: a.isCompleted,
      })),
      decisions: t.decisions.map((d) => ({
        id: d.id,
        description: d.description,
        category: d.category,
      })),
    })
  }
}
