import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service.js'
import { Result } from '../common/result.js'
import { AiService } from '../ai/ai.service.js'
import { EmbeddingIndexerService } from '../ai/embeddings/embedding-indexer.service.js'
import { AssemblyAiProvider } from './assemblyai.provider.js'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'node:crypto'

const AUDIO_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'meetings')

const AUDIO_EXT_BY_MIME: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/webm;codecs=opus': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
}
const ALLOWED_AUDIO_MIMES = new Set(Object.keys(AUDIO_EXT_BY_MIME))

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
    private readonly assemblyAi: AssemblyAiProvider,
    private readonly embeddingIndexer: EmbeddingIndexerService,
  ) {}

  /** Fire-and-forget: read the just-inserted segments for a transcript and
   *  push them through the embedding indexer. Catches all errors so failed
   *  embeddings never break transcript ingestion. */
  private async indexSegmentsAsync(transcriptId: string, projectId: string): Promise<void> {
    try {
      const rows = await this.prisma.transcriptSegment.findMany({
        where: { transcriptId },
        select: { id: true, text: true },
      })
      if (rows.length === 0) return
      const result = await this.embeddingIndexer.indexAndStore(
        'segment',
        rows.map((r) => ({ id: r.id, text: r.text })),
        { projectId },
      )
      this.logger.log(
        `indexSegmentsAsync transcript=${transcriptId} segments=${rows.length} indexed=${result.indexed} failed=${result.failed}`,
      )
    } catch (e) {
      this.logger.warn(`indexSegmentsAsync failed for ${transcriptId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async transcribe(projectId: string, audioBuffer: Buffer, fileName: string, title: string) {
    // No default fallback URL — TRANSCRIPTION_URL is validated as required at startup.
    const serviceUrl = this.config.getOrThrow<string>('TRANSCRIPTION_URL')

    // SSRF guard: only allow http(s) schemes pointing to the configured host.
    try {
      const parsed = new URL(serviceUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        this.logger.error(`TRANSCRIPTION_URL has forbidden protocol: ${parsed.protocol}`)
        return Result.fail<any>('Configuration de transcription invalide.')
      }
    } catch {
      this.logger.error(`TRANSCRIPTION_URL is not a valid URL: ${serviceUrl}`)
      return Result.fail<any>('Configuration de transcription invalide.')
    }

    // Try the local model first; if the local service is unreachable or errors out,
    // fall back to OpenAI's Whisper API (when OPENAI_API_KEY is set).
    let data: TranscriptionResponse
    let usedFallback = false
    try {
      data = await this.callLocalTranscription(serviceUrl, audioBuffer, fileName)
    } catch (localErr: unknown) {
      const msg = localErr instanceof Error ? localErr.message : String(localErr)
      this.logger.warn(`Local transcription failed: ${msg} — attempting Whisper API fallback`)
      try {
        data = await this.callWhisperApiFallback(audioBuffer, fileName)
        usedFallback = true
        this.logger.log('Whisper API fallback succeeded')
      } catch (fallbackErr: unknown) {
        const fmsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
        this.logger.error(`Whisper API fallback also failed: ${fmsg}`)
        return Result.fail<any>('Service de transcription indisponible. Veuillez réessayer ultérieurement.')
      }
    }

    try {
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
        // Phase 4 — index the just-inserted segments for semantic retrieval.
        // Fire-and-forget; embeddings populate within a few seconds and the
        // cahier agent's semantic tools filter `embedding IS NOT NULL` so the
        // system degrades gracefully while indexing is in flight.
        void this.indexSegmentsAsync(transcript.id, projectId)
      }

      if (usedFallback) {
        this.logger.log(`Transcript ${transcript.id} created via Whisper API fallback`)
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
      this.logger.error(`Transcript persistence failed: ${message}`)
      return Result.fail<any>('Erreur lors de la sauvegarde de la transcription.')
    }
  }

  /**
   * POST audio to the local Python transcription service. Throws on any non-2xx
   * response or invalid JSON shape so the caller can fall back to the API path.
   */
  private async callLocalTranscription(
    serviceUrl: string,
    audioBuffer: Buffer,
    fileName: string,
  ): Promise<TranscriptionResponse> {
    const formData = new FormData()
    formData.append('audio', new Blob([audioBuffer as unknown as BlobPart]), fileName)

    const transcriptionSecret = this.config.get<string>('TRANSCRIPTION_SECRET', '')
    const headers: Record<string, string> = {}
    if (transcriptionSecret) {
      headers['x-transcription-secret'] = transcriptionSecret
    }

    // 5-minute hard timeout — long enough for a 30-min audio file on CPU,
    // short enough that a hung container can't pile up requests indefinitely.
    const response = await fetch(`${serviceUrl}/transcribe`, {
      method: 'POST',
      body: formData,
      headers,
      signal: AbortSignal.timeout(300_000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`local service returned ${response.status}: ${text.slice(0, 200)}`)
    }

    const rawJson: unknown = await response.json()
    return validateTranscriptionResponse(rawJson)
  }

  /**
   * Fallback path: Z.AI speech-to-text (glm-asr) — OpenAI-compatible
   * `/audio/transcriptions` endpoint. Reuses AI_FALLBACK_API_KEY (the same
   * key already used by ZaiFallbackProvider for chat completions).
   *
   * Returns a `TranscriptionResponse` with a single "Speaker 1" since
   * Z.AI's ASR doesn't diarize. Throws if no API key is configured or the
   * call fails.
   *
   * Operators can override:
   *   - WHISPER_FALLBACK_BASE_URL  (default: https://api.z.ai/api/paas/v4)
   *   - WHISPER_FALLBACK_MODEL     (default: glm-asr)
   *   - WHISPER_FALLBACK_API_KEY   (default: AI_FALLBACK_API_KEY)
   */
  private async callWhisperApiFallback(
    audioBuffer: Buffer,
    fileName: string,
  ): Promise<TranscriptionResponse> {
    const apiKey =
      this.config.get<string>('WHISPER_FALLBACK_API_KEY', '') ||
      this.config.get<string>('AI_FALLBACK_API_KEY', '')
    if (!apiKey) {
      throw new Error('AI_FALLBACK_API_KEY (Z.AI) not configured — fallback unavailable')
    }
    const baseUrl = (
      this.config.get<string>('WHISPER_FALLBACK_BASE_URL', '') ||
      'https://api.z.ai/api/paas/v4'
    ).replace(/\/+$/, '')
    const model = this.config.get<string>('WHISPER_FALLBACK_MODEL', 'glm-asr')

    const form = new FormData()
    form.append('file', new Blob([audioBuffer as unknown as BlobPart]), fileName)
    form.append('model', model)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')

    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(300_000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Whisper API returned ${response.status}: ${text.slice(0, 300)}`)
    }

    const raw = (await response.json()) as {
      task?: string
      language?: string
      duration?: number
      text?: string
      segments?: Array<{
        id: number
        start: number
        end: number
        text: string
        avg_logprob?: number
        no_speech_prob?: number
      }>
    }

    const language = (raw.language ?? '').slice(0, 10) || 'auto'
    const duration = typeof raw.duration === 'number' && isFinite(raw.duration) ? raw.duration : 0

    const apiSegments = Array.isArray(raw.segments) ? raw.segments : []
    const segments: TranscriptionSegment[] = apiSegments.length > 0
      ? apiSegments.map((s) => ({
          speaker: 'Speaker 1',
          text: typeof s.text === 'string' ? s.text.trim().slice(0, 10_000) : '',
          start_time: typeof s.start === 'number' && isFinite(s.start) ? s.start : 0,
          end_time: typeof s.end === 'number' && isFinite(s.end) ? s.end : 0,
          language,
          // OpenAI's avg_logprob is in [-inf, 0]; map to a [0,1] confidence.
          confidence: typeof s.avg_logprob === 'number' && isFinite(s.avg_logprob)
            ? Math.max(0, Math.min(1, Math.exp(s.avg_logprob)))
            : 0.85,
        }))
      // No segment-level data — synthesize one segment from the flat text.
      : raw.text && raw.text.trim()
      ? [{
          speaker: 'Speaker 1',
          text: raw.text.trim().slice(0, 10_000),
          start_time: 0,
          end_time: duration,
          language,
          confidence: 0.85,
        }]
      : []

    return {
      segments,
      duration_seconds: duration,
      detected_languages: language && language !== 'auto' ? [language] : [],
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
      hasAudio: !!t.audioPath,
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
    if (t.audioPath) {
      try { fs.unlinkSync(t.audioPath) } catch { /* file already gone */ }
    }
    await this.prisma.meetingTranscript.delete({ where: { id } })
    return Result.ok()
  }

  /**
   * Persist the recorded audio for a live-meeting transcript on disk so it
   * can be replayed via /audio. Stores under uploads/meetings/<projectId>/.
   */
  async attachAudio(
    projectId: string,
    transcriptId: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<Result<{ audioSize: number }>> {
    const t = await this.prisma.meetingTranscript.findFirst({
      where: { id: transcriptId, projectId },
      select: { id: true, audioPath: true },
    })
    if (!t) return Result.fail<any>('Transcription non trouvée.')

    const cleanMime = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_AUDIO_MIMES.has(cleanMime) && !ALLOWED_AUDIO_MIMES.has(mimeType)) {
      return Result.fail<any>('Format audio non supporté.')
    }
    const ext = AUDIO_EXT_BY_MIME[cleanMime] ?? AUDIO_EXT_BY_MIME[mimeType] ?? '.webm'

    const dir = path.join(AUDIO_UPLOAD_DIR, projectId)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const fileName = `${randomUUID()}${ext}`
    const storagePath = path.join(dir, fileName)

    // Path-traversal containment.
    const resolved = path.resolve(storagePath)
    const root = path.resolve(AUDIO_UPLOAD_DIR)
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      return Result.fail<any>('Invalid path')
    }

    fs.writeFileSync(storagePath, buffer)

    // Replace any older audio for this transcript (re-record).
    if (t.audioPath && t.audioPath !== storagePath) {
      try { fs.unlinkSync(t.audioPath) } catch { /* ignore */ }
    }

    await this.prisma.meetingTranscript.update({
      where: { id: transcriptId },
      data: {
        audioPath: storagePath,
        audioMimeType: cleanMime,
        audioSize: buffer.length,
      },
    })

    return Result.ok({ audioSize: buffer.length })
  }

  /**
   * Re-run the full transcription (with speaker diarization) on the audio
   * file already attached to a transcript. Replaces the existing
   * TranscriptSegment rows. Used after a live meeting saves its audio
   * because the live flow only stored a single "PM + invités" segment.
   *
   * Provider order: AssemblyAI Universal-2 (when configured) → local
   * faster-whisper + SpeechBrain. AssemblyAI gives noticeably better
   * speaker separation; the local stack stays as a free fallback.
   */
  async redoDiarization(transcriptId: string): Promise<Result<{ speakers: number; provider: string }>> {
    const t = await this.prisma.meetingTranscript.findUnique({
      where: { id: transcriptId },
      select: { id: true, audioPath: true, audioMimeType: true },
    })
    if (!t || !t.audioPath) return Result.fail<any>('Audio non disponible.')
    if (!fs.existsSync(t.audioPath)) {
      return Result.fail<any>('Fichier audio introuvable.')
    }

    const buffer = fs.readFileSync(t.audioPath)
    let data: TranscriptionResponse
    let provider = 'unknown'

    if (this.assemblyAi.isConfigured()) {
      try {
        data = await this.assemblyAi.transcribeWithDiarization(buffer)
        provider = 'assemblyai'
        this.logger.log(`AssemblyAI diarization succeeded for ${transcriptId}`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.warn(
          `AssemblyAI failed for ${transcriptId}: ${msg.slice(0, 200)} — falling back to local`,
        )
        try {
          const serviceUrl = this.config.getOrThrow<string>('TRANSCRIPTION_URL')
          data = await this.callLocalTranscription(
            serviceUrl,
            buffer,
            path.basename(t.audioPath),
          )
          provider = 'local-whisper'
        } catch (localErr: unknown) {
          const lmsg = localErr instanceof Error ? localErr.message : String(localErr)
          this.logger.warn(`Local fallback also failed for ${transcriptId}: ${lmsg}`)
          return Result.fail<any>('Échec de la diarisation.')
        }
      }
    } else {
      try {
        const serviceUrl = this.config.getOrThrow<string>('TRANSCRIPTION_URL')
        data = await this.callLocalTranscription(
          serviceUrl,
          buffer,
          path.basename(t.audioPath),
        )
        provider = 'local-whisper'
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.warn(`redoDiarization fetch failed for ${transcriptId}: ${msg}`)
        return Result.fail<any>('Échec de la diarisation.')
      }
    }

    // Replace all segments atomically. If diarization didn't actually
    // separate speakers (still returns 1 unique speaker), we still keep
    // the new segments since they're more granular than the single-blob
    // saved by the live flow.
    await this.prisma.$transaction([
      this.prisma.transcriptSegment.deleteMany({ where: { transcriptId } }),
      this.prisma.meetingTranscript.update({
        where: { id: transcriptId },
        data: {
          durationSeconds: Math.round(data.duration_seconds || 0),
          detectedLanguages: (data.detected_languages || []).join(','),
        },
      }),
      this.prisma.transcriptSegment.createMany({
        data: data.segments.map((s) => ({
          transcriptId,
          speaker: s.speaker || 'Speaker 1',
          text: s.text,
          startTime: s.start_time,
          endTime: s.end_time,
          language: s.language,
          confidence: s.confidence,
        })),
      }),
    ])

    const speakers = new Set(data.segments.map((s) => s.speaker)).size
    this.logger.log(
      `Re-diarized transcript ${transcriptId} via ${provider}: ${data.segments.length} segments, ${speakers} speaker(s)`,
    )
    return Result.ok({ speakers, provider })
  }

  /** Mark a meeting's audio as preserved (or release the flag). The
   *  retention cron skips preserved recordings. */
  async setAudioPreserved(transcriptId: string, preserved: boolean): Promise<Result<{ preserved: boolean }>> {
    const t = await this.prisma.meetingTranscript.findUnique({
      where: { id: transcriptId },
      select: { id: true },
    })
    if (!t) return Result.fail<any>('Transcription non trouvée.')
    await this.prisma.meetingTranscript.update({
      where: { id: transcriptId },
      data: { audioPreserved: preserved },
    })
    return Result.ok({ preserved })
  }

  /** Return the absolute path + content type of a transcript's stored audio. */
  async getAudioFile(
    transcriptId: string,
  ): Promise<Result<{ path: string; mimeType: string; size: number }>> {
    const t = await this.prisma.meetingTranscript.findUnique({
      where: { id: transcriptId },
      select: { audioPath: true, audioMimeType: true, audioSize: true },
    })
    if (!t || !t.audioPath) return Result.fail<any>('Audio non disponible.')
    if (!fs.existsSync(t.audioPath)) {
      return Result.fail<any>('Fichier audio introuvable sur le serveur.')
    }
    return Result.ok({
      path: t.audioPath,
      mimeType: t.audioMimeType ?? 'audio/webm',
      size: t.audioSize ?? fs.statSync(t.audioPath).size,
    })
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

  /**
   * Convert selected MeetingActionItem rows into WorkPackages.
   * Each action item becomes a WorkPackage of type='Task', priority='Normal',
   * status='New', with `aiGeneratedFrom='meeting-actions:<meetingId>'` for
   * traceability. The `assigneeName` is fuzzy-matched against project
   * members (case-insensitive substring on first / last / full name);
   * unmatched names produce an unassigned task.
   */
  async convertActionItemsToWPs(
    projectId: string,
    meetingId: string,
    actionItemIds: string[],
    authorId: string,
    sprintId: string | null,
  ) {
    if (actionItemIds.length === 0) {
      return Result.fail<{ created: number; skipped: number }>('Aucun élément sélectionné.')
    }

    // Verify meeting belongs to project + load matching action items.
    const transcript = await this.prisma.meetingTranscript.findFirst({
      where: { id: meetingId, projectId },
      select: { id: true },
    })
    if (!transcript) return Result.fail<{ created: number; skipped: number }>('Réunion introuvable sur ce projet.')

    const items = await this.prisma.meetingActionItem.findMany({
      where: { id: { in: actionItemIds }, transcriptId: meetingId },
    })
    if (items.length === 0) return Result.fail<{ created: number; skipped: number }>('Aucune action correspondante.')

    // Validate sprint belongs to project (when provided).
    let safeSprintId: string | null = null
    if (sprintId) {
      const sprint = await this.prisma.sprint.findFirst({
        where: {
          id: sprintId,
          board: { projectId },
        },
        select: { id: true },
      })
      if (sprint) safeSprintId = sprint.id
    }

    // Pull project members for fuzzy match.
    const memberRows = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    })

    function matchAssignee(rawName: string | null): string | null {
      if (!rawName || rawName.trim().length < 2) return null
      const needle = rawName.trim().toLowerCase()
      const tokens = needle.split(/\s+/).filter((t) => t.length >= 2)
      for (const m of memberRows) {
        const first = m.user.firstName.toLowerCase()
        const last = m.user.lastName.toLowerCase()
        const full = `${first} ${last}`
        if (full === needle) return m.userId
        if (tokens.every((t) => full.includes(t))) return m.userId
      }
      // Fallback: any member whose first OR last name is fully contained in the input
      for (const m of memberRows) {
        const first = m.user.firstName.toLowerCase()
        const last = m.user.lastName.toLowerCase()
        if (first && needle.includes(first)) return m.userId
        if (last && needle.includes(last)) return m.userId
      }
      return null
    }

    let created = 0
    const tag = `meeting-actions:${meetingId}`
    await this.prisma.$transaction(async (tx) => {
      for (const a of items) {
        const assigneeId = matchAssignee(a.assigneeName)
        // Title trimmed to 200 chars (DB cap), description holds the full text.
        const title = a.description.length > 200 ? a.description.slice(0, 197) + '...' : a.description
        await tx.workPackage.create({
          data: {
            projectId,
            authorId,
            title,
            description: a.description,
            type: 'Task',
            status: 'New',
            priority: 'Normal',
            assigneeId,
            dueDate: a.dueDate ?? null,
            sprintId: safeSprintId,
            aiGeneratedFrom: tag,
          },
        })
        created += 1
        // Mark the action item as completed so it stops surfacing in the modal.
        await tx.meetingActionItem.update({
          where: { id: a.id },
          data: { isCompleted: true },
        })
      }
    })

    return Result.ok({ created, skipped: actionItemIds.length - created })
  }
}
