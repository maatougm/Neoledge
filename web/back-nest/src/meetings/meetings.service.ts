import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service.js'
import { Result } from '../common/result.js'
import { AiService } from '../ai/ai.service.js'

interface TranscriptionSegment {
  speaker: string
  text: string
  start_time: number
  end_time: number
  language: string
  confidence: number
}

interface TranscriptionResponse {
  segments: TranscriptionSegment[]
  duration_seconds: number
  detected_languages: string[]
}

/**
 * Validate the JSON shape returned by the transcription service.
 * Throws a descriptive Error if the response is malformed.
 */
function validateTranscriptionResponse(raw: unknown): TranscriptionResponse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Transcription response must be a JSON object')
  }
  const obj = raw as Record<string, unknown>

  if (!Array.isArray(obj['segments'])) {
    throw new Error('Transcription response missing "segments" array')
  }
  if (obj['segments'].length > 10_000) {
    throw new Error(`Transcription response has too many segments: ${obj['segments'].length}`)
  }

  const segments: TranscriptionSegment[] = (obj['segments'] as unknown[]).map((s, i) => {
    if (typeof s !== 'object' || s === null) throw new Error(`Segment[${i}] is not an object`)
    const seg = s as Record<string, unknown>
    return {
      speaker: typeof seg['speaker'] === 'string' ? seg['speaker'].slice(0, 200) : 'Unknown',
      text: typeof seg['text'] === 'string' ? seg['text'].slice(0, 10_000) : '',
      start_time: typeof seg['start_time'] === 'number' && isFinite(seg['start_time']) ? seg['start_time'] : 0,
      end_time: typeof seg['end_time'] === 'number' && isFinite(seg['end_time']) ? seg['end_time'] : 0,
      language: typeof seg['language'] === 'string' ? seg['language'].slice(0, 10) : '',
      confidence: typeof seg['confidence'] === 'number' && isFinite(seg['confidence']) ? seg['confidence'] : 0,
    }
  })

  const duration = typeof obj['duration_seconds'] === 'number' && isFinite(obj['duration_seconds'])
    ? obj['duration_seconds']
    : 0

  const langs = Array.isArray(obj['detected_languages'])
    ? (obj['detected_languages'] as unknown[])
        .filter((l): l is string => typeof l === 'string')
        .map((l) => l.slice(0, 10))
    : []

  return { segments, duration_seconds: duration, detected_languages: langs }
}

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly aiService: AiService,
  ) {}

  async transcribe(projectId: string, audioBuffer: Buffer, fileName: string, title: string) {
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

      const rawJson: unknown = await response.json()
      let data: TranscriptionResponse
      try {
        data = validateTranscriptionResponse(rawJson)
      } catch (validationErr: unknown) {
        const msg = validationErr instanceof Error ? validationErr.message : String(validationErr)
        this.logger.error(`Transcription service returned invalid response shape: ${msg}`)
        return Result.fail<any>(`Réponse de transcription invalide : ${msg}`)
      }

      const transcript = await this.prisma.meetingTranscript.create({
        data: {
          projectId,
          title,
          originalFileName: fileName,
          durationSeconds: Math.round(data.duration_seconds),
          detectedLanguages: data.detected_languages.join(','),
          recordedAt: new Date(),
        },
      })

      const segments = data.segments.map((s) => ({
        transcriptId: transcript.id,
        speaker: s.speaker,
        text: s.text,
        startTime: s.start_time,
        endTime: s.end_time,
        language: s.language,
        confidence: s.confidence,
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

  async renameSpeaker(id: string, oldName: string, newName: string, userId: string) {
    const t = await this.prisma.meetingTranscript.findUnique({ where: { id } })
    if (!t) return Result.fail('Transcription non trouvée.')

    await this.prisma.transcriptSegment.updateMany({
      where: { transcriptId: id, speaker: oldName },
      data: { speaker: newName },
    })

    // Audit trail
    await this.prisma.auditLog.create({
      data: {
        entityType: 'TranscriptSegment',
        entityId: id,
        action: 'rename_speaker',
        userId,
        changes: JSON.stringify({ oldName, newName }),
      },
    }).catch((e: unknown) =>
      this.logger.error(`Failed to write audit log for rename_speaker: ${e instanceof Error ? e.message : String(e)}`)
    )

    return Result.ok()
  }

  async triggerAiAnalysis(transcriptId: string) {
    const t = await this.prisma.meetingTranscript.findUnique({ where: { id: transcriptId } })
    if (!t) return Result.fail<any>('Transcription non trouvée.')

    if (t.aiStatus === 'processing') {
      return Result.fail<any>('Une analyse est déjà en cours pour cette transcription.')
    }

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
