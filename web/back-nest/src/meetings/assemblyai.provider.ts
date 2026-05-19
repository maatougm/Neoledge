import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/**
 * Shape consumed by MeetingsService — kept identical to the local Python
 * service response so a provider swap doesn't ripple through the persistence
 * layer.
 */
interface AssemblyAiSegment {
  speaker: string
  text: string
  start_time: number
  end_time: number
  language: string
  confidence: number
}
export interface AssemblyAiResponse {
  segments: AssemblyAiSegment[]
  duration_seconds: number
  detected_languages: string[]
}

interface AssemblyAiUtterance {
  speaker?: string
  text?: string
  start?: number
  end?: number
  confidence?: number
}
interface AssemblyAiTranscript {
  status: 'queued' | 'processing' | 'completed' | 'error'
  error?: string
  language_code?: string
  audio_duration?: number
  utterances?: AssemblyAiUtterance[]
  text?: string
}

const UPLOAD_URL = 'https://api.assemblyai.com/v2/upload'
const TRANSCRIPT_URL = 'https://api.assemblyai.com/v2/transcript'

const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 10 * 60 * 1_000 // 10 min — covers a ~30 min meeting

/**
 * AssemblyAI Universal-2 provider with speaker_labels enabled — returns
 * transcript + diarization in one async job. Used as the primary STT for
 * live meetings; the local faster-whisper + SpeechBrain stack remains as
 * fallback when the key is missing or the upload/poll fails.
 */
@Injectable()
export class AssemblyAiProvider {
  private readonly logger = new Logger(AssemblyAiProvider.name)

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('ASSEMBLYAI_API_KEY')
  }

  /**
   * Upload audio + submit transcription job + poll until completion.
   * Throws on any failure so the caller can fall back. Returns the
   * shape MeetingsService persists into TranscriptSegment.
   */
  async transcribeWithDiarization(buffer: Buffer): Promise<AssemblyAiResponse> {
    const apiKey = this.config.get<string>('ASSEMBLYAI_API_KEY')
    if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not configured')

    const uploadUrl = await this.uploadAudio(buffer, apiKey)
    const transcriptId = await this.submitJob(uploadUrl, apiKey)
    const result = await this.pollUntilDone(transcriptId, apiKey)
    return this.toResponse(result)
  }

  private async uploadAudio(buffer: Buffer, apiKey: string): Promise<string> {
    const response = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/octet-stream',
      },
      // Multer Buffer is a Uint8Array under the hood — fetch accepts it directly.
      body: buffer as unknown as BodyInit,
      signal: AbortSignal.timeout(180_000),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`AssemblyAI upload failed ${response.status}: ${text.slice(0, 200)}`)
    }
    const data = (await response.json()) as { upload_url?: string }
    if (!data.upload_url) throw new Error('AssemblyAI upload returned no upload_url')
    return data.upload_url
  }

  private async submitJob(uploadUrl: string, apiKey: string): Promise<string> {
    const response = await fetch(TRANSCRIPT_URL, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: uploadUrl,
        speaker_labels: true,
        language_detection: true,
        // Bump the boost weight for project-domain jargon if/when we add a
        // word_boost list — keep the wire shape ready.
        // word_boost: ['NeoLeadge', 'cahier des charges', ...],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`AssemblyAI submit failed ${response.status}: ${text.slice(0, 200)}`)
    }
    const data = (await response.json()) as { id?: string }
    if (!data.id) throw new Error('AssemblyAI submit returned no transcript id')
    return data.id
  }

  private async pollUntilDone(
    transcriptId: string,
    apiKey: string,
  ): Promise<AssemblyAiTranscript> {
    const start = Date.now()
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      const response = await fetch(`${TRANSCRIPT_URL}/${transcriptId}`, {
        headers: { authorization: apiKey },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`AssemblyAI poll failed ${response.status}: ${text.slice(0, 200)}`)
      }
      const data = (await response.json()) as AssemblyAiTranscript
      if (data.status === 'completed') return data
      if (data.status === 'error') {
        throw new Error(`AssemblyAI job error: ${data.error ?? 'unknown'}`)
      }
    }
    throw new Error('AssemblyAI timed out waiting for transcript')
  }

  private toResponse(data: AssemblyAiTranscript): AssemblyAiResponse {
    const utterances = Array.isArray(data.utterances) ? data.utterances : []
    const language = data.language_code ?? 'fr'
    const segments: AssemblyAiSegment[] = utterances
      .filter((u) => (u.text ?? '').trim().length > 0)
      .map((u) => ({
        // AssemblyAI labels speakers "A", "B", … — convert to numeric so the
        // existing TranscriptViewer renders "Intervenant 1", "Intervenant 2".
        speaker: this.speakerLabel(u.speaker),
        text: (u.text ?? '').trim(),
        start_time: Math.max(0, (u.start ?? 0) / 1000),
        end_time: Math.max(0, (u.end ?? 0) / 1000),
        language,
        confidence: typeof u.confidence === 'number' ? u.confidence : 0.9,
      }))

    // If diarization disabled itself (single-speaker audio) but text exists,
    // synthesise one segment so the transcript isn't lost.
    if (segments.length === 0 && data.text && data.text.trim()) {
      segments.push({
        speaker: 'Speaker 1',
        text: data.text.trim(),
        start_time: 0,
        end_time: data.audio_duration ?? 0,
        language,
        confidence: 0.85,
      })
    }

    return {
      segments,
      duration_seconds: data.audio_duration ?? 0,
      detected_languages: language ? [language] : [],
    }
  }

  private speakerLabel(raw: string | undefined): string {
    if (!raw) return 'Speaker 1'
    const trimmed = raw.trim().toUpperCase()
    if (/^[A-Z]$/.test(trimmed)) {
      return `Speaker ${trimmed.charCodeAt(0) - 64}`
    }
    // "Speaker 2" or anything numeric — pass through as-is.
    return trimmed.startsWith('SPEAKER') ? trimmed.replace(/^SPEAKER\s*/i, 'Speaker ') : `Speaker ${trimmed}`
  }
}
